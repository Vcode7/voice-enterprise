from fastapi import APIRouter
import torch

from app.config import settings, global_ocr_config
from app.models.schemas import HealthResponse
from app.services.ocr_engine import get_ocr_engine

router = APIRouter(tags=["Health"])


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Health check endpoint returning system status, loaded model details, compute device, and OCR switches.
    """
    engine = get_ocr_engine()
    cuda_avail = torch.cuda.is_available()
    gpu_name = torch.cuda.get_device_name(0) if cuda_avail else None

    return HealthResponse(
        status="healthy",
        version=settings.APP_VERSION,
        models_loaded=engine.is_loaded,
        paddleocr_loaded=engine.is_paddle_loaded,
        trocr_loaded=engine.is_trocr_loaded,
        trocr_model_name=settings.TROCR_MODEL_NAME,
        device=engine.device_name,
        cuda_available=cuda_avail,
        gpu_device_name=gpu_name,
        config=global_ocr_config,
    )


@router.get("/", tags=["Root"])
async def root():
    """
    Root endpoint displaying service metadata.
    """
    engine = get_ocr_engine()
    return {
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "pipeline": "PaddleOCR + Microsoft TrOCR Large Handwritten",
        "device": engine.device_name,
        "models": {
            "printed_ocr_and_detector": "PaddleOCR",
            "handwriting_ocr": settings.TROCR_MODEL_NAME,
        },
        "endpoints": {
            "health": "/health",
            "ocr": "POST /ocr",
            "settings": "GET /settings/ocr",
            "docs": "/docs",
        },
    }
