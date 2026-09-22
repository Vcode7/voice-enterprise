from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from app.config import OcrConfigModel


class ExtractedFieldMatch(BaseModel):
    field_name: str = Field(..., description="Target template field name (e.g. 'Part No', 'Machine Name', 'Quantity')")
    field_key: str = Field(..., description="Normalized field key (e.g. 'part_no', 'machine_name')")
    value: str = Field(..., description="Extracted value for this field (empty string if not found)")
    raw_value: Optional[str] = Field(None, description="Raw uncorrected text before lookup table or format normalization")
    label_text: Optional[str] = Field(None, description="Matched label text found in document (e.g. 'Part No:', 'Part No.')")
    label_bbox: Optional[List[int]] = Field(None, description="Bounding box of the field label [x1, y1, x2, y2]")
    value_bbox: Optional[List[int]] = Field(None, description="Bounding box of the extracted value [x1, y1, x2, y2]")
    match_direction: Optional[str] = Field(None, description="Spatial relationship: 'inline', 'right', 'below', or 'not_found'")
    spatial_distance: Optional[float] = Field(None, description="Pixel distance from label to value region")
    confidence: float = Field(0.0, description="Confidence score for this extracted field")
    confidence_level: str = Field("HIGH", description="Confidence level: 'HIGH', 'MEDIUM', or 'LOW'")
    source: Optional[str] = Field(None, description="OCR engine source ('paddleocr', 'trocr', 'hybrid')")
    is_valid: bool = Field(True, description="Whether the extracted value passed validation checks")
    validation_message: Optional[str] = Field(None, description="Validation message or note")


class OcrBlock(BaseModel):
    text: str = Field(..., description="Final extracted text (auto-corrected if lookup matched, or raw)")
    raw_text: str = Field(..., description="Original raw OCR text before any lookup correction")
    corrected_text: Optional[str] = Field(None, description="Corrected text if lookup table/fuzzy match was applied")
    source: str = Field(..., description="OCR engine source ('paddleocr' or 'trocr')")
    bbox: List[int] = Field(..., description="Bounding box [x1, y1, x2, y2] in pixels")
    confidence: float = Field(..., description="Confidence score between 0.0 and 1.0")
    confidence_level: str = Field("HIGH", description="Confidence level: 'HIGH', 'MEDIUM', or 'LOW'")
    is_valid: bool = Field(True, description="Whether the text passed field-specific / strict lookup validation")
    validation_message: Optional[str] = Field(None, description="Validation explanation or fuzzy correction details")
    field_type: Optional[str] = Field(None, description="Detected or specified field type (number, date, time, text)")
    variants_evaluated: Optional[int] = Field(None, description="Number of preprocessing variants evaluated for this block")


class OcrEntry(BaseModel):
    page: int = Field(..., description="Page number of the document (1-indexed)")
    text: str = Field(..., description="Structured field-specific or reconstructed text for this page")
    raw_text: str = Field(..., description="Uncorrected raw reconstructed OCR text for this page")
    structured_text: Optional[str] = Field(None, description="Clean structured key-value text (e.g. 'Part No: 34125\nMachine Name: CNC Machine')")
    extracted_fields: Optional[List[ExtractedFieldMatch]] = Field(default_factory=list, description="List of template field matches with bounding boxes and coordinates")
    blocks: List[OcrBlock] = Field(default_factory=list, description="Detailed list of text blocks with source, bbox, confidence, and validation")
    lines_detected: Optional[int] = Field(None, description="Number of text lines detected and processed")
    processing_time_ms: Optional[float] = Field(None, description="Inference time in milliseconds for this page")


class OcrResponse(BaseModel):
    success: bool = Field(True, description="Indicates if the OCR operation was successful")
    filename: Optional[str] = Field(None, description="Name of the uploaded file")
    text: Optional[str] = Field(None, description="Combined extracted structured text across all pages")
    raw_combined_text: Optional[str] = Field(None, description="Combined raw extracted text across all pages")
    total_pages: int = Field(..., description="Total number of pages processed")
    device: str = Field(..., description="Device used for inference (cuda, cpu, mps)")
    model_name: str = Field(..., description="Hybrid model pipeline description")
    total_duration_ms: float = Field(..., description="Total request processing time in milliseconds")
    config_used: OcrConfigModel = Field(..., description="Active OCR pipeline configuration switches and thresholds")
    extracted_fields: Optional[List[ExtractedFieldMatch]] = Field(default_factory=list, description="Flattened or primary page template field extractions")
    entries: List[OcrEntry] = Field(..., description="List of extracted text entries per page")


class HealthResponse(BaseModel):
    status: str = Field("healthy", description="Service health status")
    version: str = Field(..., description="Service version")
    models_loaded: bool = Field(..., description="Indicates if PaddleOCR and TrOCR are loaded in memory")
    paddleocr_loaded: bool = Field(..., description="Indicates if PaddleOCR is loaded")
    trocr_loaded: bool = Field(..., description="Indicates if TrOCR Large is loaded")
    trocr_model_name: str = Field(..., description="Loaded TrOCR model name")
    device: str = Field(..., description="Inference device (cuda, cpu, mps)")
    cuda_available: bool = Field(..., description="Indicates if CUDA GPU is available")
    gpu_device_name: Optional[str] = Field(None, description="Name of GPU device if available")
    config: OcrConfigModel = Field(..., description="Current global OCR pipeline configuration")


class ErrorResponse(BaseModel):
    success: bool = Field(False, description="Always false for errors")
    error: str = Field(..., description="Error message description")
    code: Optional[str] = Field(None, description="Error code identifier")


# ---------------------------------------------------------------------------
# Dedicated Handwriting Scanning Template Schemas
# ---------------------------------------------------------------------------
class HandwritingFieldConfig(BaseModel):
    field_name: str = Field(..., description="Field label (digital / OCR-detectable via PaddleOCR)")
    field_type: str = Field("digital", description="Label detection type, always 'digital'")
    value_type: str = Field("h", description="Value extraction type: 'h' (handwriting -> TrOCR) or 'd' (digital text -> PaddleOCR)")
    look_for: str = Field("right", description="Search direction for field value: 'right', 'left', 'up', 'down'")
    data_type: Optional[str] = Field(None, description="Data type: 'string', 'number', etc.")


class HandwritingTableColumnConfig(BaseModel):
    column_name: str = Field(..., description="Table column header name (digital / OCR-detectable via PaddleOCR)")
    value_type: str = Field("h", description="Column value extraction type: 'h' (handwriting -> TrOCR) or 'd' (digital text -> PaddleOCR)")
    is_number: Optional[bool] = Field(False, description="Whether column represents numeric values")
    calculate_total: Optional[bool] = Field(False, description="Whether to calculate column sum")
    data_type: Optional[str] = Field(None, description="Data type: 'string', 'number', etc.")


class HandwritingTableConfig(BaseModel):
    id: str = Field("table_main", description="Table identifier")
    name: str = Field("Production Table", description="Table name")
    columns: List[HandwritingTableColumnConfig] = Field(default_factory=list, description="List of table column configurations")


class HandwritingScanningTemplate(BaseModel):
    id: str = Field("handwriting_default", description="Template identifier")
    name: str = Field("Handwriting Scanning Template", description="Template display name")
    description: Optional[str] = Field("Default template for handwriting scanning with direction-based extraction and table extraction", description="Template description")
    fields: List[HandwritingFieldConfig] = Field(default_factory=list, description="List of form field configurations")
    table_columns: List[HandwritingTableColumnConfig] = Field(default_factory=list, description="List of table column configurations (legacy/main table)")
    tables: Optional[List[HandwritingTableConfig]] = Field(default_factory=list, description="List of multiple tables configurations")


class HandwritingFieldExtractionResult(BaseModel):
    field_name: str
    field_type: str = "digital"
    value_type: str = "h"  # 'h' or 'd'
    look_for: str = "right"
    value: str = ""
    raw_value: Optional[str] = None
    label_bbox: Optional[List[int]] = None
    value_bbox: Optional[List[int]] = None
    confidence: float = 0.0
    source: str = "trocr"  # 'trocr' or 'paddleocr'


class HandwritingOcrResponse(BaseModel):
    success: bool = Field(True, description="Indicates if extraction was successful")
    filename: Optional[str] = Field(None, description="Document filename")
    template_name: str = Field("Handwriting Scanning Template", description="Template used")
    fields: List[HandwritingFieldExtractionResult] = Field(default_factory=list, description="Extracted field values with bounding boxes and sources")
    field_values: Dict[str, str] = Field(default_factory=dict, description="Simple key-value map of field name to extracted string")
    table_headers: List[str] = Field(default_factory=list, description="List of detected table column names")
    table_rows: List[Dict[str, str]] = Field(default_factory=list, description="List of structured table row objects")
    structured_text: str = Field("", description="Formatted text representation of extracted fields and table")
    raw_text: str = Field("", description="Raw reconstructed OCR text")
    total_pages: int = Field(1, description="Number of pages processed")
    processing_time_ms: float = Field(0.0, description="Total inference time in milliseconds")
    device: str = Field("", description="Compute device used")
    page_results: Optional[List[Dict[str, Any]]] = Field(default_factory=list, description="Per-page structured extraction results")
    tables: Optional[List[Any]] = Field(default_factory=list, description="Extracted multi-tables if present")
    ocr_record_id: Optional[str] = Field(None, description="SQLite record ID where raw OCR output was saved")
    clean_text: Optional[str] = Field("", description="Clean human-readable plain text with HTML tags stripped for UI presentation")

