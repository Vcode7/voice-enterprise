import os
import sys
import io
import time
import json
import logging
from pathlib import Path
from PIL import Image
import pymupdf as fitz
import numpy as np

# Ensure backend root and workspace root are in sys.path
BACKEND_DIR = Path(__file__).resolve().parent
WORKSPACE_DIR = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(WORKSPACE_DIR) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_DIR))

import asyncio
from app.core.logger import logger
from app.services.chandra_engine import get_chandra_engine
from app.services.ocr_engine import get_ocr_engine
from app.services.handwriting_extractor import (
    HandwritingFieldExtractor,
    DEFAULT_HANDWRITING_TEMPLATE,
)
from app.services.detection_visualizer import DetectionVisualizer
from app.services.llm_services import GroqService
from app.models.schemas import (
    HandwritingScanningTemplate,
    HandwritingFieldConfig,
    HandwritingTableColumnConfig,
)


def find_demo_pdf_path() -> Path:
    """Locates the Hourly Monitoring Sheet sample PDF in the workspace."""
    candidates = [
        WORKSPACE_DIR / "demo-sample" / "Hourly monitor sheet.pdf",
        BACKEND_DIR / "demo-sample" / "Hourly monitor sheet.pdf",
        Path(r"E:\projects\voice-entry\demo-sample\Hourly monitor sheet.pdf"),
    ]
    for p in candidates:
        if p.exists():
            return p
    raise FileNotFoundError(
        "Could not find 'Hourly monitor sheet.pdf'. Please ensure the PDF is in 'demo-sample/'."
    )


def render_first_page_as_image(pdf_path: Path, dpi: int = 200) -> Image.Image:
    """Opens the PDF and renders the first sheet (Page 1) as a PIL RGB Image."""
    logger.info(f"Loading PDF document from: {pdf_path}")
    doc = fitz.open(str(pdf_path))
    total_pages = len(doc)
    logger.info(f"PDF contains {total_pages} pages. Extracting first sheet (Page 1)...")

    page = doc[0]
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=matrix, alpha=False)
    img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    doc.close()
    logger.info(f"Rendered Page 1 successfully: dimensions={img.width}x{img.height} px, DPI={dpi}")
    return img


def get_test_template() -> HandwritingScanningTemplate:
    """Returns the handwriting template configured for the Hourly Monitoring Sheet."""
    return HandwritingScanningTemplate(
        id="hourly_monitor_template",
        name="Hourly Monitoring Sheet Template",
        description="Hourly Monitoring Sheet fields and table columns",
        fields=[
            HandwritingFieldConfig(field_name="Part No", field_type="digital", value_type="h", look_for="right"),
            HandwritingFieldConfig(field_name="Machine Name", field_type="digital", value_type="h", look_for="right"),
            HandwritingFieldConfig(field_name="Description", field_type="digital", value_type="h", look_for="right"),
            HandwritingFieldConfig(field_name="Raw Material", field_type="digital", value_type="h", look_for="right"),
            HandwritingFieldConfig(field_name="Planned Production", field_type="digital", value_type="h", look_for="right"),
            HandwritingFieldConfig(field_name="Date", field_type="digital", value_type="h", look_for="right"),
            HandwritingFieldConfig(field_name="Shift", field_type="digital", value_type="h", look_for="right"),
            HandwritingFieldConfig(field_name="Batch No", field_type="digital", value_type="h", look_for="right"),
            HandwritingFieldConfig(field_name="Opening Counter", field_type="digital", value_type="h", look_for="right"),
            HandwritingFieldConfig(field_name="Closing Counter", field_type="digital", value_type="h", look_for="right"),
            HandwritingFieldConfig(field_name="Cycle Time", field_type="digital", value_type="h", look_for="right"),
            HandwritingFieldConfig(field_name="Startup Time", field_type="digital", value_type="h", look_for="right"),
            HandwritingFieldConfig(field_name="Operator", field_type="digital", value_type="h", look_for="right"),
        ],
        table_columns=[
            HandwritingTableColumnConfig(column_name="Start Time", value_type="d"),
            HandwritingTableColumnConfig(column_name="End Time", value_type="d"),
            HandwritingTableColumnConfig(column_name="Planned Qty", value_type="h"),
            HandwritingTableColumnConfig(column_name="Produced Qty", value_type="h"),
            HandwritingTableColumnConfig(column_name="Rejection", value_type="h"),
        ],
    )


def log_banner(title: str):
    logger.info("=" * 80)
    logger.info(f"  {title}")
    logger.info("=" * 80)


def main():
    log_banner("MANUAL TEST: CHANDRA 2 OCR ON HOURLY MONITORING SHEET (PAGE 1)")

    # 1. Locate and Render PDF First Page
    pdf_path = find_demo_pdf_path()
    page_img = render_first_page_as_image(pdf_path, dpi=200)
    template = get_test_template()

    engine = get_chandra_engine()

    # 2. VRAM Metrics Before Load
    vram_init = engine.get_vram_info()
    logger.info(f"[Lifecycle] Initial GPU VRAM: Allocated={vram_init['allocated_mb']} MB, Reserved={vram_init['reserved_mb']} MB")

    try:
        # 3. Load Chandra 2 Model (Binary seek direct streaming without memory-map commit limits)
        log_banner("STEP 1: LOADING CHANDRA 2 MODEL (4-BIT BITSANDBYTES)")
        engine.load_model()
        vram_loaded = engine.get_vram_info()
        logger.info(f"[Lifecycle] Loaded GPU VRAM: Allocated={vram_loaded['allocated_mb']} MB, Reserved={vram_loaded['reserved_mb']} MB")

        # 4. Mode 1: Complete Chandra OCR -> HTML Layout
        log_banner("STEP 2: FULL IMAGE OCR (COMPLETE OCR TO HTML VIA OCR_PROMPT)")
        full_start = time.time()
        full_res = engine.extract_full_image(page_img, template=template)
        full_dur = (time.time() - full_start) * 1000.0

        logger.info(f"Chandra OCR Complete Success: {full_res.success} (Duration: {full_dur:.1f}ms)")
        logger.info("--------------------------------------------------------------------------------")
        logger.info(f"--- [CHANDRA OCR OUTPUT: HTML LAYOUT TEXT ({len(full_res.raw_text)} chars)] ---")
        logger.info("\n" + full_res.raw_text)
        logger.info("--------------------------------------------------------------------------------")

        # 4b. LLM Auto-Structuring (Chandra HTML -> Template Fields & Multi-Tables)
        log_banner("STEP 2B: LLM AUTO-STRUCTURING (CHANDRA HTML -> TEMPLATE FIELDS & TABLES)")
        llm_start = time.time()
        structured_entry = asyncio.run(
            GroqService.structure_handwritten_page(
                page_ocr_text=full_res.raw_text,
                page_number=1,
                total_pages=1,
                template=template.dict(),
                mode="template",
                document_name=pdf_path.name,
                ocr_method="chandra_2",
            )
        )
        llm_dur = (time.time() - llm_start) * 1000.0

        logger.info(f"LLM Structuring Finished in {llm_dur:.1f}ms")
        logger.info("--- [LLM EXTRACTED FIELD VALUES] ---")
        logger.info(json.dumps(structured_entry.get("fieldValues", {}), indent=2, ensure_ascii=False))
        logger.info("--- [LLM EXTRACTED TABLES] ---")
        for tbl in structured_entry.get("tables", []):
            logger.info(f"Table: {tbl.get('name')} | Headers: {tbl.get('headers')} | Rows: {len(tbl.get('rows', []))}")
            for r_idx, row in enumerate(tbl.get("rows", []), start=1):
                logger.info(f"  Row {r_idx:02d}: {row}")
        logger.info("--------------------------------------------------------------------------------")

        # 5. Method 2: Detected Region Method (PaddleOCR detection + Chandra 2 crop inference)
        log_banner("STEP 3: DETECTED REGION EXTRACTION (PADDLEOCR DETECTION + CHANDRA 2 CROPS)")
        det_start = time.time()
        ocr_engine = get_ocr_engine()

        # Run PaddleOCR for label and text box detection
        img_np = np.array(page_img.convert("RGB"))
        paddle_results = ocr_engine._paddle_ocr.ocr(img_np, cls=True)
        ocr_regions = []

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

        logger.info(f"PaddleOCR detected {len(ocr_regions)} text regions on Page 1.")

        def chandra_crop_fn(crops):
            return engine.infer_crop_batch(crops)

        det_res = HandwritingFieldExtractor.process_handwriting_extraction(
            image_pil=page_img,
            ocr_regions=ocr_regions,
            template=template,
            trocr_infer_fn=chandra_crop_fn,
        )
        det_dur = (time.time() - det_start) * 1000.0

        # Mark source for detected region results
        for fld in det_res.fields:
            if getattr(fld, "source", None) in ("trocr", "chandra_2_crop"):
                fld.source = "chandra_2_detected_region"

        # Save debug visualization image to /detection
        DetectionVisualizer.save_debug_image(
            base_image=page_img,
            ocr_regions=ocr_regions,
            extraction_result=det_res,
            filename=pdf_path.name,
            page_idx=1,
        )

        logger.info(f"Detected Region Extraction Finished in {det_dur:.1f}ms")
        logger.info("--------------------------------------------------------------------------------")
        logger.info("--- [DETECTED REGION: EXTRACTED FIELD VALUES] ---")
        logger.info(json.dumps(det_res.field_values, indent=2, ensure_ascii=False))
        logger.info("--------------------------------------------------------------------------------")
        logger.info(f"--- [DETECTED REGION: EXTRACTED TABLE ROWS - {len(det_res.table_rows)} ROWS] ---")
        if det_res.table_rows:
            logger.info(f"Columns: {' | '.join(det_res.table_headers)}")
            for idx, r in enumerate(det_res.table_rows, start=1):
                row_str = " | ".join(str(r.get(c, "")) for c in det_res.table_headers)
                logger.info(f"Row {idx:02d}: {row_str}")
        else:
            logger.info("No table rows detected.")
        logger.info("--------------------------------------------------------------------------------")
        logger.info("--- [DETECTED REGION: STRUCTURED TEXT SUMMARY] ---")
        logger.info("\n" + det_res.structured_text)

    finally:
        # 6. Unload Model & Release VRAM
        log_banner("STEP 4: UNLOADING CHANDRA 2 & VRAM RECLAMATION")
        engine.unload_model()
        vram_final = engine.get_vram_info()
        logger.info(f"[Lifecycle] Final GPU VRAM: Allocated={vram_final['allocated_mb']} MB, Reserved={vram_final['reserved_mb']} MB")
        vram_diff = vram_final["allocated_mb"] - vram_init["allocated_mb"]
        logger.info(f"[Lifecycle] VRAM Delta vs Initial Baseline: {vram_diff:.1f} MB")
        if vram_diff <= 50.0:
            logger.info(">>> SUCCESS: Model unloaded cleanly, GPU VRAM returned to baseline! <<<")
        else:
            logger.warning(f">>> WARNING: Residual VRAM detected: {vram_diff:.1f} MB <<<")

    log_banner("TEST RUN COMPLETE - ALL OUTPUTS DISPLAYED IN LOGS ABOVE")


if __name__ == "__main__":
    main()
