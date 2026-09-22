import io
import json
import base64
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Request, UploadFile, File, Form, Query, HTTPException, status
from app.config import settings
from app.db.repositories import HandwritingTemplatesRepo
from app.services.llm_services import GroqService, VoiceEditService
from app.routers.ocr import process_handwriting_document

router = APIRouter(prefix="/handwritten", tags=["Handwritten OCR & Templates"])


# --------------------------------------------------------------------------
# Template Management Endpoints
# --------------------------------------------------------------------------
@router.get("/template")
async def get_handwriting_template(
    id: Optional[str] = Query(None),
    single: Optional[str] = Query(None),
):
    if id:
        tmpl = HandwritingTemplatesRepo.get_by_id(id)
        if not tmpl:
            raise HTTPException(status_code=404, detail="Template not found")
        return tmpl

    if single == "true" or single == "1":
        return HandwritingTemplatesRepo.get_active()

    return HandwritingTemplatesRepo.get_all()


@router.post("/template")
async def save_handwriting_template(request: Request):
    body = await request.json()
    if not body or not isinstance(body.get("fields"), list):
        raise HTTPException(status_code=400, detail="Invalid handwriting template data. Must include fields array.")
    return HandwritingTemplatesRepo.save(body)


@router.delete("/template")
async def delete_or_reset_template(id: Optional[str] = Query(None)):
    if id:
        success = HandwritingTemplatesRepo.delete(id)
        return {"success": success}
    return HandwritingTemplatesRepo.reset()


@router.get("/models")
async def get_handwritten_models():
    """Returns Chandra V2 engine configuration and supported modes."""
    return {
        "success": True,
        "engine": "chandra_2",
        "name": "Chandra V2 Vision OCR",
        "description": "High-precision vision-language document OCR engine (datalab-to/chandra-ocr-2)",
        "defaultMode": "full_image",
        "supportedModes": ["full_image", "detected_region"],
        "loadingMethods": ["local", "ollama"],
        "defaultLoadingMethod": getattr(settings, "CHANDRA_LOADING_METHOD", "ollama"),
        "defaultOllamaModel": getattr(settings, "CHANDRA_OLLAMA_MODEL", "chandra"),
        "quantization": "3-bit",
    }


@router.get("/ollama/models")
async def get_ollama_models():
    """
    Returns installed Ollama models and connection status.
    Used to populate the Chandra Ollama model dropdown in the UI.
    """
    base_url = (getattr(settings, "OLLAMA_BASE_URL", "http://127.0.0.1:11434") or "http://127.0.0.1:11434").rstrip("/")
    try:
        import httpx
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.get(f"{base_url}/api/tags")
            if res.status_code == 200:
                data = res.json()
                models = [m.get("name") for m in data.get("models", []) if m.get("name")]
                return {
                    "online": True,
                    "models": models,
                    "defaultModel": settings.CHANDRA_OLLAMA_MODEL,
                    "baseUrl": base_url,
                }
            return {
                "online": False,
                "models": [],
                "defaultModel": settings.CHANDRA_OLLAMA_MODEL,
                "error": f"HTTP {res.status_code}: {res.text}",
                "baseUrl": base_url,
            }
    except Exception as e:
        return {
            "online": False,
            "models": [],
            "defaultModel": settings.CHANDRA_OLLAMA_MODEL,
            "error": str(e),
            "baseUrl": base_url,
        }


# --------------------------------------------------------------------------
# Chandra V2 Handwriting OCR Processing
# --------------------------------------------------------------------------
@router.post("/ocr")
async def process_ocr(
    file: Optional[UploadFile] = File(None),
    base64Data: Optional[str] = Form(None),
    filename: Optional[str] = Form(None),
    mimeType: Optional[str] = Form(None),
    handwriting_template: Optional[str] = Form(None),
    template: Optional[str] = Form(None),
    ocr_method: Optional[str] = Form("chandra_2"),
    chandra_mode: Optional[str] = Form("full_image"),
    chandra_upscale: Optional[Any] = Form(False),
    chandra_quantization: Optional[str] = Form("3-bit"),
    chandra_loading_method: Optional[str] = Form("ollama"),
    chandra_ollama_model: Optional[str] = Form(None),
):
    """
    Dedicated Handwriting OCR endpoint powered exclusively by Chandra V2.
    Supports:
    - full_image (default): Chandra 2 full document layout OCR using OCR_PROMPT -> clean HTML.
    - detected_region: PaddleOCR bounding box detection -> Chandra 2 crop transcription.
    - loading_method: 'local' (PyTorch 3/4/8-bit) or 'ollama' (Ollama API inference).
    """
    upload_file = file
    if base64Data and not upload_file:
        clean_b64 = base64Data.split(",")[-1]
        file_bytes = base64.b64decode(clean_b64)
        fname = filename or "document.png"
        mtype = mimeType or "image/png"
        upload_file = UploadFile(file=io.BytesIO(file_bytes), filename=fname, headers={"content-type": mtype})
    elif not upload_file:
        raise HTTPException(status_code=400, detail="No image file or image data provided for OCR.")

    template_json = handwriting_template or template
    upscale_bool = str(chandra_upscale).lower() in ("true", "1")

    res = await process_handwriting_document(
        file=upload_file,
        template_json=template_json,
        model_variant="base",
        checkpoint_id=None,
        ocr_method="chandra_2",
        chandra_mode=chandra_mode or "full_image",
        chandra_upscale=upscale_bool,
        chandra_quantization=chandra_quantization or "3-bit",
        chandra_loading_method=chandra_loading_method or getattr(settings, "CHANDRA_LOADING_METHOD", "ollama"),
        chandra_ollama_model=chandra_ollama_model,
    )

    raw_fields = getattr(res, "fields", None) or []
    raw_tables = getattr(res, "tables", None) or []

    serialized_fields = [
        f.dict() if hasattr(f, "dict") else (f.model_dump() if hasattr(f, "model_dump") else f)
        for f in raw_fields
    ]
    serialized_tables = [
        t.dict() if hasattr(t, "dict") else (t.model_dump() if hasattr(t, "model_dump") else t)
        for t in raw_tables
    ]

    clean_text = getattr(res, "clean_text", "") or getattr(res, "structured_text", "") or getattr(res, "raw_text", "") or ""
    ocr_rec_id = getattr(res, "ocr_record_id", None)

    return {
        "success": getattr(res, "success", True),
        "text": clean_text,
        "clean_text": clean_text,
        "structured_text": getattr(res, "structured_text", ""),
        "raw_text": getattr(res, "raw_text", ""),
        "ocr_record_id": ocr_rec_id,
        "ocrRecordId": ocr_rec_id,
        "fields": serialized_fields,
        "field_values": getattr(res, "field_values", {}) or {},
        "table_headers": getattr(res, "table_headers", []) or [],
        "table_rows": getattr(res, "table_rows", []) or [],
        "tables": serialized_tables,
        "engineUsed": getattr(res, "device", ""),
        "processing_time_ms": getattr(res, "processing_time_ms", 0.0),
    }


# --------------------------------------------------------------------------
# LLM Auto-Structuring Endpoint (Chandra HTML -> Template Fields & Multi-Tables)
# --------------------------------------------------------------------------
@router.post("/structure")
async def structure_pages(request: Request):
    """
    Transforms reviewed OCR text (HTML generated by Chandra 2) into structured
    SessionDataEntry records with template fields, production tables, and rejection defect tables
    via LLM (Groq / Gemini fallback).
    Always runs strictly in the Python backend.
    """
    body = await request.json()
    pages = body.get("pages", [])
    template = body.get("template")
    mode = body.get("mode", "template")
    document_name = body.get("documentName", "document")
    ocr_method = body.get("ocrMethod", "chandra_2")

    if not pages:
        raise HTTPException(status_code=400, detail="No reviewed OCR pages provided.")

    entries = []
    total_pages = len(pages)

    for idx, p in enumerate(pages, start=1):
        # Prefer raw HTML if provided so LLM can leverage table structures and bounding boxes
        page_ocr_text = (
            p.get("rawOcrHtml")
            or p.get("raw_text")
            or p.get("ocrText")
            or p.get("structured_text")
            or p.get("rawTranscript")
            or ""
        )
        ocr_record_id = p.get("ocrRecordId") or p.get("ocr_record_id")
        p_num = p.get("pageNumber", idx)

        structured_entry = await GroqService.structure_handwritten_page(
            page_ocr_text=page_ocr_text,
            page_number=p_num,
            total_pages=total_pages,
            template=template,
            mode=mode,
            document_name=document_name,
            ocr_method=ocr_method,
            ocr_record_id=ocr_record_id,
        )
        entries.append(structured_entry)

    return {
        "entries": entries,
        "totalEntries": len(entries),
        "missingFieldsSummary": [],
    }


# --------------------------------------------------------------------------
# Voice-Assisted Natural Language Data Corrections
# --------------------------------------------------------------------------
@router.post("/voice-edit")
async def handle_voice_edit(request: Request):
    body = await request.json()
    instruction = body.get("instruction")
    if not instruction or not str(instruction).strip():
        raise HTTPException(status_code=400, detail="Voice instruction is required.")

    current_field_values = body.get("currentFieldValues", {})
    table_headers = body.get("tableHeaders", [])
    table_rows = body.get("tableRows", [])
    template = body.get("template")

    return await VoiceEditService.process_voice_edit(
        instruction=instruction,
        current_field_values=current_field_values,
        table_headers=table_headers,
        table_rows=table_rows,
        template=template,
    )
