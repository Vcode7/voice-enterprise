from typing import Dict, Any, Optional
from fastapi import APIRouter, Request, UploadFile, File, Header, HTTPException, status
from app.services.llm_services import GroqService

router = APIRouter(prefix="/groq", tags=["Groq AI & Voice"])


@router.get("/status")
async def get_groq_status():
    return GroqService.get_key_status()


@router.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    x_custom_groq_key: Optional[str] = Header(None, alias="x-custom-groq-key"),
):
    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Audio file is empty.")
        transcript = await GroqService.transcribe_audio(
            file_bytes=file_bytes,
            filename=file.filename or "audio.webm",
            custom_key=x_custom_groq_key,
        )
        return {"text": transcript}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/intent")
async def extract_intent(
    request: Request,
    x_custom_groq_key: Optional[str] = Header(None, alias="x-custom-groq-key"),
):
    body = await request.json()
    transcript = body.get("transcript")
    if not transcript:
        raise HTTPException(status_code=400, detail="Transcript string is required.")
    return await GroqService.extract_financial_intent(transcript, x_custom_groq_key)


@router.post("/receipt")
async def extract_receipt(
    request: Request,
    x_custom_groq_key: Optional[str] = Header(None, alias="x-custom-groq-key"),
):
    body = await request.json()
    transcript = body.get("transcript")
    if not transcript:
        raise HTTPException(status_code=400, detail="Transcript string is required.")
    return await GroqService.extract_voice_receipt(transcript, x_custom_groq_key)


@router.post("/custom-data")
async def extract_custom_data(
    request: Request,
    x_custom_groq_key: Optional[str] = Header(None, alias="x-custom-groq-key"),
):
    body = await request.json()
    transcript = body.get("transcript")
    template = body.get("template")
    if not transcript or not template:
        raise HTTPException(status_code=400, detail="Transcript and template schema are required.")
    return await GroqService.extract_custom_data(transcript, template, x_custom_groq_key)


@router.post("/flexible")
async def extract_flexible_data(
    request: Request,
    x_custom_groq_key: Optional[str] = Header(None, alias="x-custom-groq-key"),
):
    body = await request.json()
    transcript = body.get("transcript")
    if not transcript:
        raise HTTPException(status_code=400, detail="Transcript string is required.")
    return await GroqService.extract_flexible_data(transcript, x_custom_groq_key)


@router.post("/query")
async def handle_financial_query(
    request: Request,
    x_custom_groq_key: Optional[str] = Header(None, alias="x-custom-groq-key"),
):
    body = await request.json()
    transcript = body.get("transcript") or body.get("query")
    if not transcript:
        raise HTTPException(status_code=400, detail="Transcript/query string is required.")
    return await GroqService.parse_financial_query(transcript, x_custom_groq_key)
