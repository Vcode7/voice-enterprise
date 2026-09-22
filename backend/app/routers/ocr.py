import io
import os
import json
import time
from pathlib import Path
from typing import List, Optional, Dict, Any, Union
from PIL import Image
from fastapi import APIRouter, File, UploadFile, Form, status, HTTPException

from app.core.logger import logger
from app.config import settings, global_ocr_config, OcrConfigModel
from app.models.schemas import (
    OcrResponse,
    OcrEntry,
    ErrorResponse,
    HandwritingScanningTemplate,
    HandwritingOcrResponse,
)
from app.services.ocr_engine import get_ocr_engine
from app.services.pdf_processor import PdfProcessor
from app.services.handwriting_extractor import (
    HandwritingFieldExtractor,
    DEFAULT_HANDWRITING_TEMPLATE,
)
from app.services.image_preprocessor import ImagePreprocessor
from app.services.chandra_engine import get_chandra_engine
from app.services.detection_visualizer import DetectionVisualizer
import numpy as np
from app.core.exceptions import UnsupportedFileTypeError, FileProcessingError, OcrInferenceError
from app.db.repositories import OcrResultsRepo
from app.utils.html_cleaner import clean_html_to_text


router = APIRouter(tags=["OCR"])


@router.get(
    "/ocr/models",
    summary="Get available OCR engine information",
)
async def get_ocr_models():
    """Returns Chandra V2 engine configuration and supported modes."""
    return {
        "success": True,
        "engine": "chandra_2",
        "name": "Chandra V2 Vision OCR",
        "description": "High-precision vision-language document OCR engine (datalab-to/chandra-ocr-2)",
        "defaultMode": "full_image",
        "supportedModes": ["full_image", "detected_region"],
        "loadingMethods": ["local", "ollama"],
        "defaultLoadingMethod": "local",
        "ollamaModel": settings.CHANDRA_OLLAMA_MODEL,
        "quantization": "3-bit",
    }


@router.get(
    "/settings/ocr",
    response_model=OcrConfigModel,
    summary="Get active OCR pipeline configuration switches",
)
async def get_ocr_config():
    """
    Returns current global OCR pipeline configuration and ON/OFF switches.
    """
    return global_ocr_config


@router.post(
    "/settings/ocr",
    response_model=OcrConfigModel,
    summary="Update global OCR pipeline configuration switches",
)
async def update_ocr_config(new_config: OcrConfigModel):
    """
    Updates the runtime global OCR pipeline configuration without restarting the server.
    """
    global global_ocr_config
    global_ocr_config = new_config
    logger.info(f"Updated global OCR configuration: {new_config.model_dump()}")
    return global_ocr_config


@router.post(
    "/ocr",
    response_model=OcrResponse,
    responses={
        415: {"model": ErrorResponse, "description": "Unsupported Media Type"},
        422: {"model": ErrorResponse, "description": "Unprocessable File"},
        500: {"model": ErrorResponse, "description": "Internal Server Error"},
    },
    summary="Extract handwritten and printed text with configurable hybrid pipeline",
    description=(
        "Accepts JPG, JPEG, PNG, or PDF files. "
        "Supports optional per-request config overrides, model variant / checkpoint selection, and lookup table values."
    ),
)
async def process_document_ocr(
    file: UploadFile = File(..., description="Document file (JPG, JPEG, PNG, or PDF)"),
    config_json: Optional[str] = Form(None, description="Optional JSON string overriding OCR switches/thresholds"),
    lookup_tables_json: Optional[str] = Form(None, description="Optional JSON string with valid lookup table values: {'Part Number': ['PRT-4029', ...]}"),
    template_fields_json: Optional[str] = Form(None, description="Optional JSON list or template object defining target fields: ['Part No', 'Machine Name', 'Quantity']"),
    template_json: Optional[str] = Form(None, description="Optional JSON template object with fields schema"),
    model_variant: Optional[str] = Form("base", description="Model variant: 'base', 'finetuned', or 'checkpoint'"),
    checkpoint_id: Optional[str] = Form(None, description="Specific checkpoint ID if model_variant is 'checkpoint'"),
):
    """
    Primary OCR endpoint with modular improvements and Field-Specific Extraction:
    - Image Preprocessing (Deskew, Denoise, Contrast, Adaptive Threshold, Upscaling)
    - Form/Region Detection (PaddleOCR with label/value separation)
    - TrOCR Preprocessing Variants (Multi-variant evaluation for difficult handwriting)
    - Field-Specific Spatial Neighborhood Extraction (Searches right & below field labels)
    - Template / Table Lookup Correction (Fuzzy matching with strict table validation)
    - Automatic OCR Retry (Alternative filter retries for low-confidence regions)
    - Confidence Scoring & Classification (HIGH, MEDIUM, LOW)
    - Spatial Deduplication & Coordinate Auditing
    """
    request_start = time.time()
    filename = file.filename or "uploaded_file"
    ext = os.path.splitext(filename)[1].lower()
    content_type = file.content_type or ""

    logger.info(f"Received OCR request for file: '{filename}' | Content-Type: '{content_type}' | Ext: '{ext}'")

    # 1. Parse per-request config overrides, lookup tables, and template fields if supplied
    active_config = global_ocr_config.model_copy()
    if config_json:
        try:
            parsed_cfg = json.loads(config_json)
            active_config = OcrConfigModel(**parsed_cfg)
            logger.info("Applied per-request OCR config overrides.")
        except Exception as e:
            logger.warning(f"Failed to parse config_json: {str(e)}")

    lookup_tables_dict: Optional[Dict[str, List[str]]] = None
    if lookup_tables_json:
        try:
            lookup_tables_dict = json.loads(lookup_tables_json)
            logger.info(f"Loaded {len(lookup_tables_dict)} lookup table(s) for fuzzy matching.")
        except Exception as e:
            logger.warning(f"Failed to parse lookup_tables_json: {str(e)}")

    target_template_fields: Optional[Any] = None
    raw_template_input = template_fields_json or template_json
    if raw_template_input:
        try:
            target_template_fields = json.loads(raw_template_input)
            logger.info(f"Loaded target template fields for field-specific extraction: {target_template_fields}")
        except Exception as e:
            logger.warning(f"Failed to parse template_fields_json: {str(e)}")

    # 2. File Extension & MIME Type Validation
    is_valid_ext = ext in settings.ALLOWED_EXTENSIONS
    is_valid_mime = content_type in settings.ALLOWED_MIME_TYPES or "image/" in content_type or "pdf" in content_type

    if not is_valid_ext and not is_valid_mime:
        logger.warning(f"Rejected file '{filename}' with unsupported format '{ext}' / '{content_type}'")
        raise UnsupportedFileTypeError(
            detail=f"Unsupported file format '{ext}'. Allowed formats: JPG, JPEG, PNG, PDF."
        )

    # 3. Read File Bytes with Size Limit Check
    try:
        max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
        file_bytes = await file.read()

        if len(file_bytes) == 0:
            logger.warning(f"Empty file received: '{filename}'")
            raise FileProcessingError(detail="Uploaded file is empty (0 bytes).")

        if len(file_bytes) > max_bytes:
            logger.warning(f"File size exceeds limit: {len(file_bytes)} bytes > {max_bytes} bytes")
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File exceeds maximum allowed size of {settings.MAX_UPLOAD_SIZE_MB}MB.",
            )

        logger.info(f"Read {len(file_bytes)} bytes from '{filename}'.")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to read uploaded file '{filename}': {str(e)}", exc_info=True)
        raise FileProcessingError(detail=f"Failed to read uploaded file: {str(e)}")

    finally:
        await file.close()

    # 4. Process Document (PDF page-by-page vs Image single entry)
    ocr_engine = get_ocr_engine()
    is_pdf = ext == ".pdf" or "application/pdf" in content_type
    entries: List[OcrEntry] = []
    all_extracted_fields = []

    try:
        if is_pdf:
            logger.info(f"Processing PDF document '{filename}' page-by-page...")
            # Convert PDF pages into PIL Images
            page_images = PdfProcessor.convert_pdf_bytes_to_images(
                pdf_bytes=file_bytes,
                dpi=settings.PDF_DPI,
                max_pages=settings.MAX_PDF_PAGES,
            )

            if not page_images:
                raise FileProcessingError(detail="No readable pages found in PDF document.")

            logger.info(f"Running Hybrid OCR on {len(page_images)} PDF page(s)...")

            for idx, page_img in enumerate(page_images, start=1):
                logger.info(f"--> Processing PDF Page {idx}/{len(page_images)}...")
                page_text, blocks, duration_ms, extracted_fields, structured_text = ocr_engine.process_image(
                    image=page_img,
                    config_override=active_config,
                    lookup_tables=lookup_tables_dict,
                    template_fields=target_template_fields,
                    model_variant=model_variant,
                    checkpoint_id=checkpoint_id,
                )

                raw_reconstructed = "\n".join(b.raw_text for b in blocks if b.raw_text).strip()
                if extracted_fields:
                    all_extracted_fields.extend(extracted_fields)

                entries.append(
                    OcrEntry(
                        page=idx,
                        text=page_text,
                        raw_text=raw_reconstructed if raw_reconstructed else page_text,
                        structured_text=structured_text,
                        extracted_fields=extracted_fields,
                        blocks=blocks,
                        lines_detected=len(blocks),
                        processing_time_ms=round(duration_ms, 2),
                    )
                )

        else:
            # Single Image Document
            logger.info(f"Processing single image document '{filename}'...")
            try:
                img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
            except Exception as img_err:
                logger.error(f"Invalid image file '{filename}': {str(img_err)}")
                raise FileProcessingError(detail="Uploaded file is not a valid or readable image.")

            text, blocks, duration_ms, extracted_fields, structured_text = ocr_engine.process_image(
                image=img,
                config_override=active_config,
                lookup_tables=lookup_tables_dict,
                template_fields=target_template_fields,
                model_variant=model_variant,
                checkpoint_id=checkpoint_id,
            )

            raw_reconstructed = "\n".join(b.raw_text for b in blocks if b.raw_text).strip()
            if extracted_fields:
                all_extracted_fields.extend(extracted_fields)

            entries.append(
                OcrEntry(
                    page=1,
                    text=text,
                    raw_text=raw_reconstructed if raw_reconstructed else text,
                    structured_text=structured_text,
                    extracted_fields=extracted_fields,
                    blocks=blocks,
                    lines_detected=len(blocks),
                    processing_time_ms=round(duration_ms, 2),
                )
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"OCR processing failed for '{filename}': {str(e)}", exc_info=True)
        raise OcrInferenceError(detail=f"Hybrid OCR inference error: {str(e)}")
    finally:
        ocr_engine.unload_trocr_model()

    total_duration_ms = (time.time() - request_start) * 1000.0
    logger.info(
        f"Completed OCR request for '{filename}' | Total Pages: {len(entries)} | "
        f"Duration: {total_duration_ms:.1f}ms | Device: {ocr_engine.device_name}"
    )

    combined_all_pages_text = "\n\n".join(e.text for e in entries if e.text).strip()
    raw_all_pages_text = "\n\n".join(e.raw_text for e in entries if e.raw_text).strip()

    return OcrResponse(
        success=True,
        filename=filename,
        text=combined_all_pages_text,
        raw_combined_text=raw_all_pages_text if raw_all_pages_text else combined_all_pages_text,
        total_pages=len(entries),
        device=ocr_engine.device_name,
        model_name=ocr_engine.model_name,
        total_duration_ms=round(total_duration_ms, 2),
        config_used=active_config,
        extracted_fields=all_extracted_fields,
        entries=entries,
    )


# ---------------------------------------------------------------------------
# Dedicated Handwriting Scanning API Endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/ocr/handwriting/template",
    response_model=HandwritingScanningTemplate,
    summary="Get default Handwriting Scanning Template",
)
async def get_default_handwriting_template():
    """
    Returns the dedicated default Handwriting Scanning Template.
    Separate from Voice Entry templates.
    """
    return DEFAULT_HANDWRITING_TEMPLATE


@router.post(
    "/ocr/handwriting",
    response_model=HandwritingOcrResponse,
    responses={
        415: {"model": ErrorResponse, "description": "Unsupported Media Type"},
        422: {"model": ErrorResponse, "description": "Unprocessable File"},
        500: {"model": ErrorResponse, "description": "Internal Server Error"},
    },
    summary="Dedicated Handwriting Document OCR with Directional & Table Extraction",
    description=(
        "Processes images or PDFs using the dedicated Handwriting Scanning Template. "
        "Digital field labels and table headers are detected via PaddleOCR. "
        "Values are extracted based on configured directions ('right', 'left', 'up', 'down'). "
        "Table rows are extracted using strict horizontal X-alignment (missing values remain ''). "
        "Values with value_type='h' are cropped and inferred using Microsoft TrOCR Large. "
        "Values with value_type='d' use PaddleOCR digital text directly."
    ),
)
async def process_handwriting_document(
    file: UploadFile = File(..., description="Document file (JPG, JPEG, PNG, or PDF)"),
    template_json: Optional[str] = Form(None, description="Optional JSON string of HandwritingScanningTemplate"),
    model_variant: Optional[str] = Form("base", description="Model variant: 'base', 'finetuned', or 'checkpoint'"),
    checkpoint_id: Optional[str] = Form(None, description="Specific checkpoint ID if model_variant is 'checkpoint'"),
    ocr_method: Optional[str] = Form("trocr", description="OCR method: 'trocr' or 'chandra_2'"),
    chandra_mode: Optional[str] = Form("full_image", description="Chandra 2 mode: 'full_image' or 'detected_region'"),
    chandra_upscale: Optional[Union[bool, str]] = Form(False, description="Upscale image (1.5x) for Chandra 2 processing (default: False)"),
    chandra_quantization: Optional[str] = Form("3-bit", description="Chandra 2 quantization: '3-bit', '4-bit', or '8-bit' (default: '3-bit')"),
    chandra_loading_method: Optional[str] = Form("ollama", description="Chandra loading method: 'local' or 'ollama'"),
    chandra_ollama_model: Optional[str] = Form(None, description="Ollama model name when chandra_loading_method='ollama'"),
):
    request_start = time.time()
    filename = file.filename or "handwritten_document"
    ext = os.path.splitext(filename)[1].lower()
    content_type = file.content_type or ""

    is_chandra = bool(ocr_method and ocr_method.lower().strip() in ("chandra", "chandra_2", "chandra2"))
    active_chandra_mode = (chandra_mode or "full_image").lower().strip()
    if active_chandra_mode not in ("full_image", "detected_region"):
        active_chandra_mode = "full_image"

    default_loading = getattr(settings, "CHANDRA_LOADING_METHOD", "ollama")
    active_loading_method = (chandra_loading_method or default_loading).lower().strip()
    if active_loading_method not in ("local", "ollama"):
        active_loading_method = default_loading
    resolved_ollama_model = (
        (chandra_ollama_model or getattr(settings, "CHANDRA_OLLAMA_MODEL", "chandra")).strip()
        if active_loading_method == "ollama"
        else None
    )

    is_upscale = False
    if isinstance(chandra_upscale, bool):
        is_upscale = chandra_upscale
    elif isinstance(chandra_upscale, str):
        is_upscale = chandra_upscale.lower().strip() in ("true", "1", "yes", "on")

    active_chandra_quant = "3-bit"
    if chandra_quantization:
        cq = str(chandra_quantization).lower().strip()
        if cq in ("3", "3bit", "3-bit"):
            active_chandra_quant = "3-bit"
        elif cq in ("4", "4bit", "4-bit"):
            active_chandra_quant = "4-bit"
        elif cq in ("8", "8bit", "8-bit"):
            active_chandra_quant = "8-bit"

    logger.info(
        f"Received Handwriting OCR request for file: '{filename}' | Content-Type: '{content_type}' | "
        f"Method: '{ocr_method}' | Chandra Mode: '{active_chandra_mode if is_chandra else 'N/A'}' | "
        f"Chandra Method: {active_loading_method if is_chandra else 'N/A'} | "
        f"Chandra Ollama Model: {resolved_ollama_model if is_chandra and active_loading_method == 'ollama' else 'N/A'} | "
        f"Chandra Quant: {active_chandra_quant if is_chandra else 'N/A'} | "
        f"Chandra Upscale: {is_upscale if is_chandra else 'N/A'}"
    )

    # 1. Parse template configuration
    active_template = DEFAULT_HANDWRITING_TEMPLATE
    if template_json:
        try:
            parsed_tmpl = json.loads(template_json)
            active_template = HandwritingScanningTemplate(**parsed_tmpl)
            logger.info(f"Using custom Handwriting Scanning Template '{active_template.name}' with {len(active_template.fields)} fields and {len(active_template.table_columns)} table columns.")
        except Exception as e:
            logger.warning(f"Failed to parse template_json: {str(e)}. Falling back to default template.")
            active_template = DEFAULT_HANDWRITING_TEMPLATE

    # 2. File Format & MIME Type Validation
    is_valid_ext = ext in settings.ALLOWED_EXTENSIONS
    is_valid_mime = content_type in settings.ALLOWED_MIME_TYPES or "image/" in content_type or "pdf" in content_type

    if not is_valid_ext and not is_valid_mime:
        logger.warning(f"Rejected file '{filename}' with unsupported format '{ext}' / '{content_type}'")
        raise UnsupportedFileTypeError(
            detail=f"Unsupported file format '{ext}'. Allowed formats: JPG, JPEG, PNG, PDF."
        )

    # 3. Read File Bytes
    try:
        max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
        file_bytes = await file.read()

        if len(file_bytes) == 0:
            raise FileProcessingError(detail="Uploaded file is empty (0 bytes).")

        if len(file_bytes) > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File exceeds maximum allowed size of {settings.MAX_UPLOAD_SIZE_MB}MB.",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to read file '{filename}': {str(e)}")
        raise FileProcessingError(detail=f"Failed to read file: {str(e)}")
    finally:
        await file.close()

    is_pdf = ext == ".pdf" or "application/pdf" in content_type

    # 4. Extract Pages & Execute OCR
    try:
        page_images: List[Image.Image] = []
        if is_pdf:
            page_images = PdfProcessor.convert_pdf_bytes_to_images(
                pdf_bytes=file_bytes,
                dpi=settings.PDF_DPI,
                max_pages=settings.MAX_PDF_PAGES,
            )
            if not page_images:
                raise FileProcessingError(detail="No readable pages found in PDF document.")
        else:
            try:
                page_images = [Image.open(io.BytesIO(file_bytes)).convert("RGB")]
            except Exception as e:
                raise FileProcessingError(detail=f"Invalid image file: {str(e)}")

        all_fields: List[Any] = []
        combined_field_values: Dict[str, str] = {}
        all_table_rows: List[Dict[str, str]] = []
        all_table_headers: List[str] = [c.column_name for c in active_template.table_columns]
        structured_texts: List[str] = []
        raw_texts: List[str] = []
        all_page_results: List[Dict[str, Any]] = []
        engine_label = ""

        # -------------------------------------------------------------
        # CHANDRA 2 OCR EXECUTION (Full Image or Detected Region)
        # -------------------------------------------------------------
        logger.info(
            f"Routing task to Chandra 2 ({active_chandra_mode}, method={active_loading_method}"
            + (f", ollama_model={resolved_ollama_model}" if active_loading_method == "ollama" else f", quant={active_chandra_quant}")
            + f", upscale={is_upscale}) OCR engine..."
        )
        chandra_engine = get_chandra_engine()
        engine_label = (
            f"Chandra 2 (Ollama: {resolved_ollama_model})"
            if active_loading_method == "ollama"
            else f"Chandra 2 {active_chandra_quant} ({chandra_engine.device_name})"
        )

        chandra_ocr_config = global_ocr_config.model_copy(
            update={
                "enable_upscaling": is_upscale,
                "upscale_factor": 1.5,
            }
        )

        try:
            from starlette.concurrency import run_in_threadpool
            if active_loading_method == "local":
                await run_in_threadpool(chandra_engine.load_model, quantization=active_chandra_quant)

            for page_idx, page_img in enumerate(page_images, start=1):
                logger.info(
                    f"Processing Page {page_idx}/{len(page_images)} with Chandra 2 "
                    f"({active_chandra_mode}, method={active_loading_method}, upscale={is_upscale})..."
                )
                processed_page, _ = ImagePreprocessor.preprocess_page(page_img, chandra_ocr_config)

                if active_chandra_mode == "full_image":
                    # Full Image Mode: Entire page processed with official OCR_PROMPT -> clean HTML
                    page_res = await run_in_threadpool(
                        chandra_engine.extract_full_image,
                        image_pil=processed_page,
                        template=active_template,
                        loading_method=active_loading_method,
                        ollama_model=resolved_ollama_model,
                    )
                else:
                    # Detected Region Mode: PaddleOCR locates regions, Chandra 2 extracts handwriting crops
                    ocr_engine = get_ocr_engine()
                    img_np = np.array(processed_page.convert("RGB"))
                    paddle_results = ocr_engine._paddle_ocr.ocr(img_np, cls=True)
                    ocr_regions: List[Dict[str, Any]] = []

                    if paddle_results and len(paddle_results) > 0 and paddle_results[0] is not None:
                        for item in paddle_results[0]:
                            poly, (text, conf) = item
                            bbox = ocr_engine._polygon_to_bbox(poly)
                            clean_text = text.strip() if text else ""
                            if clean_text and (bbox[2] - bbox[0] >= 4) and (bbox[3] - bbox[1] >= 4):
                                ocr_regions.append({
                                    "text": clean_text,
                                    "raw_text": clean_text,
                                    "bbox": bbox,
                                    "confidence": float(conf),
                                })

                    def chandra_crop_fn(crops: List[Image.Image]) -> List[str]:
                        return chandra_engine.infer_crop_batch(crops)

                    page_res = HandwritingFieldExtractor.process_handwriting_extraction(
                        image_pil=processed_page,
                        ocr_regions=ocr_regions,
                        template=active_template,
                        trocr_infer_fn=chandra_crop_fn,
                    )
                    for fld in page_res.fields:
                        fld.source = "chandra_2_detected_region"

                    # Visual debugging: Save annotated debug image to /detection
                    try:
                        DetectionVisualizer.save_debug_image(
                            base_image=processed_page,
                            ocr_regions=ocr_regions,
                            extraction_result=page_res,
                            filename=filename,
                            page_idx=page_idx,
                        )
                    except Exception as vis_err:
                        logger.warning(f"Detection visualization failed: {str(vis_err)}")

                all_fields.extend(page_res.fields)
                for k, v in page_res.field_values.items():
                    if v and not combined_field_values.get(k):
                        combined_field_values[k] = v
                    elif not combined_field_values.get(k):
                        combined_field_values[k] = ""

                if page_res.table_headers:
                    all_table_headers = page_res.table_headers
                if page_res.table_rows:
                    all_table_rows.extend(page_res.table_rows)
                if getattr(page_res, "page_results", None):
                    all_page_results.extend(page_res.page_results)
                if page_res.structured_text:
                    p_text = f"--- Page {page_idx} ---\n" + page_res.structured_text if len(page_images) > 1 else page_res.structured_text
                    structured_texts.append(p_text)
                if page_res.raw_text:
                    raw_texts.append(page_res.raw_text)

        finally:
            if active_loading_method == "local":
                # Immediately unload model and release VRAM when task finishes or fails
                await run_in_threadpool(chandra_engine.unload_model)

        total_duration = (time.time() - request_start) * 1000.0
        final_structured_text = "\n\n".join(structured_texts).strip()
        final_raw_text = "\n\n".join(raw_texts).strip()
        clean_display_text = clean_html_to_text(final_raw_text or final_structured_text)

        # ---------------------------------------------------------------------
        # SQLITE PERSISTENCE: Save raw OCR output (including HTML) first
        # ---------------------------------------------------------------------
        saved_ocr_record = OcrResultsRepo.create({
            "filename": filename,
            "ocr_method": "chandra_2" if is_chandra else (ocr_method or "ocr"),
            "chandra_mode": active_chandra_mode if is_chandra else "default",
            "raw_text": final_raw_text or final_structured_text,
            "structured_text": final_structured_text,
            "clean_text": clean_display_text,
            "template_id": getattr(active_template, "id", None),
            "template_name": getattr(active_template, "name", "Handwriting Scanning Template"),
            "page_count": len(page_images),
            "status": "completed",
            "data": {
                "fields": [f.dict() if hasattr(f, "dict") else f for f in all_fields],
                "field_values": combined_field_values,
                "table_headers": all_table_headers,
                "table_rows": all_table_rows,
                "page_results": all_page_results,
            },
        })
        saved_ocr_id = saved_ocr_record["id"]

        # Log complete Raw Chandra OCR output directly to backend console
        logger.info("=" * 80)
        logger.info(f"=== [RAW CHANDRA OCR OUTPUT: {filename}] ===")
        logger.info(f"SQLite Record ID: {saved_ocr_id} | Total Pages: {len(page_images)} | Duration: {total_duration:.1f}ms | Engine: {engine_label}")
        logger.info("--- [RAW CHANDRA OCR OUTPUT (HTML / TEXT)] ---")
        logger.info(final_raw_text or final_structured_text)
        logger.info("--- [CLEAN DISPLAY TEXT (NO RAW HTML)] ---")
        logger.info(clean_display_text)
        logger.info("--- EXTRACTED FIELD VALUES (RAW REGION PASS) ---")
        logger.info(json.dumps(combined_field_values, indent=2, ensure_ascii=False))
        logger.info("--- TABLE HEADERS ---")
        logger.info(json.dumps(all_table_headers, ensure_ascii=False))
        logger.info("--- TABLE ROWS ---")
        logger.info(json.dumps(all_table_rows, indent=2, ensure_ascii=False))
        logger.info("=" * 80)

        return HandwritingOcrResponse(
            success=True,
            filename=filename,
            template_name=active_template.name,
            fields=all_fields,
            field_values=combined_field_values,
            table_headers=all_table_headers,
            table_rows=all_table_rows,
            structured_text=final_structured_text,
            raw_text=final_raw_text,
            clean_text=clean_display_text,
            ocr_record_id=saved_ocr_id,
            total_pages=len(page_images),
            processing_time_ms=round(total_duration, 2),
            device=engine_label,
            page_results=all_page_results,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Handwriting OCR failed for '{filename}': {str(e)}", exc_info=True)
        raise OcrInferenceError(detail=f"Handwriting OCR inference error: {str(e)}")


@router.post(
    "/ocr/chandra",
    response_model=HandwritingOcrResponse,
    summary="Dedicated Chandra 2 Document OCR (Full Image or Detected Region)",
)
async def process_chandra_document(
    file: UploadFile = File(..., description="Document file (JPG, JPEG, PNG, or PDF)"),
    template_json: Optional[str] = Form(None, description="Optional JSON string of HandwritingScanningTemplate"),
    mode: Optional[str] = Form("full_image", description="Mode: 'full_image' or 'detected_region'"),
    chandra_upscale: Optional[Union[bool, str]] = Form(False, description="Upscale image (1.5x) for Chandra 2 processing (default: False)"),
    chandra_loading_method: Optional[str] = Form("ollama", description="Chandra loading method: 'local' or 'ollama'"),
    chandra_ollama_model: Optional[str] = Form(None, description="Ollama model name when chandra_loading_method='ollama'"),
):
    """
    Dedicated endpoint for Chandra 2 with on-demand quantization or Ollama API execution.
    Supports 'full_image' (native HTML layout OCR) and 'detected_region' (PaddleOCR + Chandra crop extraction).
    Loads Chandra 2 on-demand and immediately frees VRAM upon completion in local mode.
    """
    return await process_handwriting_document(
        file=file,
        template_json=template_json,
        model_variant="base",
        checkpoint_id=None,
        ocr_method="chandra_2",
        chandra_mode=mode or "full_image",
        chandra_upscale=chandra_upscale,
        chandra_loading_method=chandra_loading_method or getattr(settings, "CHANDRA_LOADING_METHOD", "ollama"),
        chandra_ollama_model=chandra_ollama_model,
    )


