import os
from typing import List, Optional
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class OcrConfigModel(BaseModel):
    """
    Centralized OCR Pipeline configuration switches and hyperparameters.
    Every step is individually configurable with ON/OFF toggles.
    """
    # 1. Image Preprocessing
    image_preprocessing: bool = Field(True, description="Enable image preprocessing (deskew, denoise, contrast, upscaling)")
    enable_deskew: bool = Field(True, description="Deskew tilted/rotated document images")
    enable_denoise: bool = Field(True, description="Remove grain and background noise")
    enable_contrast_enhance: bool = Field(True, description="CLAHE adaptive contrast enhancement")
    enable_adaptive_threshold: bool = Field(False, description="Binarize image with adaptive thresholding")
    enable_upscaling: bool = Field(True, description="Upscale low-resolution document images")
    upscale_factor: float = Field(1.5, description="Upscaling multiplier factor (1.0 to 3.0)")

    # 2. Form / Region Detection
    region_detection: bool = Field(True, description="Use PaddleOCR to detect bounding boxes and printed labels")
    separate_labels_and_values: bool = Field(True, description="Split printed field prefixes from handwriting values")

    # 3. TrOCR Preprocessing Variants
    trocr_variants: bool = Field(True, description="Generate and evaluate multiple preprocessing variants for difficult handwriting")
    trocr_variants_count: int = Field(3, description="Number of preprocessing variants to evaluate per crop (1 to 4)")

    # 4. Field-Specific Validation
    field_validation: bool = Field(True, description="Validate field types (numeric, date, time, text)")

    # 5. Template / Table Lookup Correction
    table_lookup_correction: bool = Field(True, description="Fuzzy match and correct OCR against catalog lookup tables")
    fuzzy_match_threshold: float = Field(0.80, description="Minimum similarity ratio (0.0 to 1.0) to auto-correct")
    strict_lookup_validation: bool = Field(True, description="Flag unmatched lookup fields as invalid")

    # 6. OCR Retry
    ocr_retry: bool = Field(True, description="Automatically retry low-confidence text regions with alternative filters")
    ocr_retry_conf_threshold: float = Field(0.70, description="Confidence threshold below which OCR retry is triggered")
    ocr_max_retries: int = Field(2, description="Maximum retry attempts per low-confidence region")

    # 7. Confidence Scoring
    confidence_scoring: bool = Field(True, description="Compute and classify confidence levels (HIGH, MEDIUM, LOW)")
    high_conf_threshold: float = Field(0.85, description="Threshold for HIGH confidence level")
    medium_conf_threshold: float = Field(0.65, description="Threshold for MEDIUM confidence level")

    # 8. Spatial Merging & Deduplication
    iou_deduplication_threshold: float = Field(0.45, description="Intersection-over-Union threshold to merge duplicate boxes")
    handwriting_conf_threshold: float = Field(0.88, description="PaddleOCR confidence below which crop is routed to TrOCR")


from dotenv import load_dotenv

# Load root .env.local and backend/.env so all keys are seamlessly available
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_root_dir = os.path.dirname(_backend_dir)
load_dotenv(os.path.join(_root_dir, ".env.local"))
load_dotenv(os.path.join(_root_dir, ".env"))
load_dotenv(os.path.join(_backend_dir, ".env"))
load_dotenv(os.path.join(_backend_dir, ".env.local"))


class Settings(BaseSettings):
    # Server configuration
    APP_NAME: str = "Voice ERP - FastAPI & SQLite Backend"
    APP_VERSION: str = "2.0.0"
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # SQLite Database Configuration
    SQLITE_DB_PATH: str = os.path.join(_backend_dir, "data", "voice_erp.db")

    # API Keys & LLM Service Configuration
    MONGODB_URI: Optional[str] = None
    GROQ_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_MODEL: str = "gemini-3.5-flash-lite"
    OLLAMA_BASE_URL: str = "http://127.0.0.1:11434"
    OLLAMA_VISION_MODEL: str = "qwen2.5vl:7b"

    # OCR Models Configuration
    TROCR_MODEL_NAME: str = "microsoft/trocr-large-handwritten"
    CHANDRA_MODEL_NAME: str = "datalab-to/chandra-ocr-2"
    CHANDRA_LOADING_METHOD: str = "ollama"  # 'local' or 'ollama'
    CHANDRA_OLLAMA_MODEL: str = "chandra"
    CHANDRA_OLLAMA_TIMEOUT: float = 500.0
    CHANDRA_LOAD_IN_4BIT: bool = True
    CHANDRA_QUANTIZATION: str = "3-bit"  # '3-bit', '4-bit', or '8-bit' (default: '3-bit')
    CHANDRA_MAX_NEW_TOKENS: int = 1856
    CHANDRA_NUM_CTX: int = 8192
    CHANDRA_DISABLE_THINKING: bool = True
    PADDLE_LANG: str = "en"
    PADDLE_USE_ANGLE_CLS: bool = True
    DEVICE: str = "auto"  # 'auto', 'cuda', 'cpu', 'mps'

    # Processing Limits & Tuning
    MAX_PDF_PAGES: int = 50
    PDF_DPI: int = 200
    BATCH_SIZE: int = 4
    MAX_UPLOAD_SIZE_MB: int = 25

    # Allowed File Extensions & MIME Types
    ALLOWED_EXTENSIONS: List[str] = [".jpg", ".jpeg", ".png", ".pdf"]
    ALLOWED_MIME_TYPES: List[str] = [
        "image/jpeg",
        "image/png",
        "image/jpg",
        "application/pdf",
    ]

    # CORS
    CORS_ORIGINS: str = (
        "http://localhost:3000,http://127.0.0.1:3000,"
        "http://localhost:3001,http://127.0.0.1:3001,"
        "http://localhost:8000,http://127.0.0.1:8000"
    )

    # Default Global OCR Pipeline Config
    DEFAULT_OCR_CONFIG: OcrConfigModel = OcrConfigModel()

    @property
    def cors_origins_list(self) -> List[str]:
        if not self.CORS_ORIGINS or self.CORS_ORIGINS == "*":
            return [
                "http://localhost:3000",
                "http://127.0.0.1:3000",
                "http://localhost:3001",
                "http://127.0.0.1:3001",
                "http://localhost:8000",
                "http://127.0.0.1:8000",
            ]
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    model_config = SettingsConfigDict(
        extra="ignore",
    )


settings = Settings()
# Mutable global configuration instance that can be dynamically updated via API
global_ocr_config = OcrConfigModel()

