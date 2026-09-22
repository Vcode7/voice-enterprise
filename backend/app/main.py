import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

from app.config import settings
from app.core.logger import logger
from app.db.init_db import init_database
from app.services.ocr_engine import get_ocr_engine
from app.routers import (
    health,
    ocr,
    transactions,
    receipts,
    budgets,
    debts,
    data_entries,
    templates,
    lookup_tables,
    settings as settings_router,
    database_ops,
    groq,
    gemini,
    handwritten,
    sap_storage,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan context manager:
    - Initializes SQLite database schema and seeds defaults if required.
    - Preloads lightweight PaddleOCR for layout/region detection.
    - Cleans up resources on shutdown.
    """
    logger.info("=" * 70)
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    logger.info("Storage Engine: SQLite (Local, WAL mode)")
    logger.info("OCR Pipeline: Chandra V2 (On-Demand 3-bit / 4-bit) | PaddleOCR (Detected Region Detection)")
    logger.info("=" * 70)

    try:
        init_database()
        logger.info("Database initialized successfully.")
    except Exception as e:
        logger.critical(f"FATAL: Database initialization error: {str(e)}")

    try:
        engine = get_ocr_engine()
        logger.info(f"PaddleOCR detection engine ready on {engine.device_name}. Chandra 2 loads on-demand.")
    except Exception as e:
        logger.warning(f"Detection engine startup notice: {str(e)}")

    yield

    logger.info("Shutting down Voice ERP Backend Service...")



# Initialize FastAPI application
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "Dedicated Python OCR backend combining PaddleOCR for printed text & bounding boxes "
        "and Microsoft TrOCR Large (`microsoft/trocr-large-handwritten`) for handwriting recognition. "
        "Performs spatial merging and deduplication."
    ),
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Configure CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request Logging Middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    client_ip = request.client.host if request.client else "unknown"
    method = request.method
    path = request.url.path

    logger.info(f"--> Incoming Request: {method} {path} from {client_ip}")

    response = await call_next(request)

    duration_ms = (time.time() - start_time) * 1000.0
    status_code = response.status_code

    log_level = logger.info if status_code < 400 else logger.warning
    log_level(f"<-- Completed: {method} {path} | Status: {status_code} | Duration: {duration_ms:.1f}ms")

    return response


# Global Exception Handlers
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.warning(f"Validation error on {request.method} {request.url.path}: {exc.errors()}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "success": False,
            "error": "Request validation failed.",
            "details": exc.errors(),
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled Exception on {request.method} {request.url.path}: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error": f"Internal server error: {str(exc)}",
        },
    )


# Include Routers with /api prefix for frontend and direct clients
app.include_router(health.router, prefix="/api")
app.include_router(transactions.router, prefix="/api")
app.include_router(receipts.router, prefix="/api")
app.include_router(budgets.router, prefix="/api")
app.include_router(debts.router, prefix="/api")
app.include_router(data_entries.router, prefix="/api")
app.include_router(templates.router, prefix="/api")
app.include_router(lookup_tables.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
app.include_router(database_ops.router, prefix="/api")
app.include_router(groq.router, prefix="/api")
app.include_router(gemini.router, prefix="/api")
app.include_router(handwritten.router, prefix="/api")
app.include_router(ocr.router, prefix="/api")
app.include_router(sap_storage.router, prefix="/api")

# Also maintain root-level routes for health check and direct OCR clients
app.include_router(health.router)
app.include_router(ocr.router)



if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level=settings.LOG_LEVEL.lower(),
    )
