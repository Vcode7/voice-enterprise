from typing import Optional, Dict, Any
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, status
from app.services.llm_services import GeminiService

router = APIRouter(prefix="/gemini", tags=["Gemini Multimodal"])


@router.get("/status")
async def get_gemini_status():
    return GeminiService.get_key_status()


@router.post("/extract")
async def extract_gemini(
    file: UploadFile = File(...),
    template_json: Optional[str] = Form(None),
    mode: str = Form("template"),
):
    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        import json
        tmpl = json.loads(template_json) if template_json else None

        result = await GeminiService.extract_from_document(
            file_bytes=file_bytes,
            mime_type=file.content_type or "image/png",
            filename=file.filename or "document.png",
            template=tmpl,
            mode=mode,
        )
        return {
            "success": True,
            "fields": result.get("fields", []),
            "field_values": result.get("field_values", {}),
            "table_headers": result.get("table_headers", []),
            "table_rows": result.get("table_rows", []),
            "tables": result.get("tables", []),
            "text": result.get("structured_text") or result.get("raw_text", ""),
            "structured_text": result.get("structured_text", ""),
            "raw_text": result.get("raw_text", ""),
            "engineUsed": "Gemini 3.5 Flash-Lite",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
