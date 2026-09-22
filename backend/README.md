# Voice ERP - Advanced Configurable Hybrid OCR Backend (PaddleOCR + Microsoft TrOCR Large)

A modular, high-performance **FastAPI Python backend** for handwriting and document OCR combining **PaddleOCR** (for printed text detection, form labels, and bounding boxes) and **Microsoft TrOCR Large (`microsoft/trocr-large-handwritten`)** (for handwriting transcription on candidate regions).

Every single processing step is **individually configurable with ON/OFF switches** at runtime.

---

## 🌟 8 Configurable Pipeline Improvements

```
                           Uploaded Document (PDF / Image)
                                          │
                                          ▼
                         ┌─────────────────────────────────┐
                         │ 1. Image Preprocessing (ON/OFF) │
                         │ • Deskew (Angle Correction)     │
                         │ • Denoise (Bilateral Filter)    │
                         │ • Contrast CLAHE (LAB Space)    │
                         │ • Adaptive Thresholding         │
                         │ • Upscaling (Lanczos4)          │
                         └────────────────┬────────────────┘
                                          │
                                          ▼
                         ┌─────────────────────────────────┐
                         │ 2. Form/Region Detection(ON/OFF)│
                         │ • PaddleOCR Text Polygons       │
                         │ • Label Prefix Separation       │
                         └────────────────┬────────────────┘
                                          │
                                          ▼
                         ┌─────────────────────────────────┐
                         │ 3. TrOCR Preprocessing Variants │
                         │    & Automatic Retry (ON/OFF)   │
                         │ • Multi-Variant Generation      │
                         │ • Alternative Filter Retries    │
                         │ • GPU Batched ViT + TrOCR       │
                         └────────────────┬────────────────┘
                                          │
                                          ▼
                         ┌─────────────────────────────────┐
                         │ 4. Field Validation (ON/OFF)    │
                         │ • Numeric / Float validation    │
                         │ • Date & Time format checks     │
                         └────────────────┬────────────────┘
                                          │
                                          ▼
                         ┌─────────────────────────────────┐
                         │ 5. Table Lookup Correction(ON)  │
                         │ • Fuzzy Match Auto-Correction   │
                         │ • Strict Table Rejection Flag   │
                         └────────────────┬────────────────┘
                                          │
                                          ▼
                         ┌─────────────────────────────────┐
                         │ 6. Confidence Scoring (ON/OFF)  │
                         │ • HIGH (>=0.85)                 │
                         │ • MEDIUM (0.65 - 0.85)          │
                         │ • LOW (<0.65)                   │
                         └────────────────┬────────────────┘
                                          │
                                          ▼
                         ┌─────────────────────────────────┐
                         │ 7. Spatial Deduplication &      │
                         │    Reading Order Alignment      │
                         │ • IoU overlap deduplication     │
                         │ • Top-to-bottom line grouping   │
                         └────────────────┬────────────────┘
                                          │
                                          ▼
                         ┌─────────────────────────────────┐
                         │ 8. Transparent Review Output    │
                         │ { text, raw_text, blocks: [     │
                         │   { text, raw_text, corr_text,  │
                         │     source, bbox, conf, level,  │
                         │     is_valid, val_msg } ] }     │
                         └─────────────────────────────────┘
```

---

## ⚙️ Centralized OCR Configuration Switches

| Configuration Switch | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `image_preprocessing` | `bool` | `true` | Master switch for image enhancement (deskew, denoise, contrast, upscaling) |
| `enable_deskew` | `bool` | `true` | Automatically detect and correct tilted document angles |
| `enable_denoise` | `bool` | `true` | Edge-preserving noise reduction |
| `enable_contrast_enhance` | `bool` | `true` | CLAHE adaptive contrast enhancement |
| `enable_adaptive_threshold` | `bool` | `false` | Binarize document with adaptive thresholding |
| `enable_upscaling` | `bool` | `true` | High-resolution Lanczos upscaling for small text |
| `upscale_factor` | `float` | `1.5` | Upscaling multiplier |
| `region_detection` | `bool` | `true` | Use PaddleOCR for text regions and printed label extraction |
| `separate_labels_and_values`| `bool` | `true` | Separate printed field headers from handwriting fill-in values |
| `trocr_variants` | `bool` | `true` | Generate and evaluate diverse preprocessing variants for difficult handwriting |
| `trocr_variants_count` | `int` | `3` | Number of variants to test per crop |
| `field_validation` | `bool` | `true` | Validate data formats (numeric, dates, times, text) |
| `table_lookup_correction` | `bool` | `true` | Fuzzy auto-correct against catalog lookup tables |
| `fuzzy_match_threshold` | `float` | `0.80` | Minimum fuzzy score (0.0–1.0) to auto-correct |
| `strict_lookup_validation` | `bool` | `true` | Flag values not in table as `is_valid: false` |
| `ocr_retry` | `bool` | `true` | Automatically retry low-confidence regions with alternative filters |
| `ocr_retry_conf_threshold` | `float` | `0.70` | Confidence cutoff triggering automatic retry |
| `ocr_max_retries` | `int` | `2` | Maximum retry attempts per crop |
| `confidence_scoring` | `bool` | `true` | Classify results into HIGH, MEDIUM, LOW levels |
| `high_conf_threshold` | `float` | `0.85` | Cutoff for HIGH confidence |
| `medium_conf_threshold` | `float` | `0.65` | Cutoff for MEDIUM confidence |
| `iou_deduplication_threshold`| `float` | `0.45`| IoU overlap threshold to eliminate duplicate boxes |

---

## 📡 API Endpoints

### 1. `GET /settings/ocr`
Retrieve current OCR configuration switches and parameters.

---

### 2. `POST /settings/ocr`
Update OCR configuration switches at runtime without server restart.
```json
{
  "image_preprocessing": true,
  "enable_deskew": true,
  "enable_denoise": true,
  "enable_contrast_enhance": true,
  "enable_upscaling": true,
  "upscale_factor": 1.5,
  "region_detection": true,
  "separate_labels_and_values": true,
  "trocr_variants": true,
  "trocr_variants_count": 3,
  "field_validation": true,
  "table_lookup_correction": true,
  "fuzzy_match_threshold": 0.80,
  "strict_lookup_validation": true,
  "ocr_retry": true,
  "ocr_retry_conf_threshold": 0.70,
  "confidence_scoring": true,
  "high_conf_threshold": 0.85,
  "medium_conf_threshold": 0.65
}
```

---

### 3. `POST /ocr`
Uploads a document (`.jpg`, `.jpeg`, `.png`, `.pdf`) with optional per-request overrides and lookup tables.

#### Example Request with cURL:
```bash
curl -X POST "http://localhost:8000/ocr" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@production_sheet.png" \
  -F "lookup_tables_json={\"Part Number\": [\"PRT-4029\", \"PRT-1002\", \"PRT-8821\"]}"
```

#### Example Transparent Response:
```json
{
  "success": true,
  "filename": "production_sheet.png",
  "total_pages": 1,
  "device": "cuda",
  "model_name": "PaddleOCR + microsoft/trocr-large-handwritten",
  "total_duration_ms": 940.2,
  "config_used": {
    "image_preprocessing": true,
    "region_detection": true,
    "trocr_variants": true,
    "field_validation": true,
    "table_lookup_correction": true,
    "ocr_retry": true,
    "confidence_scoring": true
  },
  "entries": [
    {
      "page": 1,
      "text": "Part No: PRT-4029\nShift: Morning\nQuantity: 150",
      "raw_text": "Part No: PRT-402O\nShift: Morning\nQuantity: 150",
      "blocks": [
        {
          "text": "Part No:",
          "raw_text": "Part No:",
          "corrected_text": null,
          "source": "paddleocr",
          "bbox": [25, 25, 110, 48],
          "confidence": 0.985,
          "confidence_level": "HIGH",
          "is_valid": true,
          "validation_message": null
        },
        {
          "text": "PRT-4029",
          "raw_text": "PRT-402O",
          "corrected_text": "PRT-4029",
          "source": "trocr",
          "bbox": [120, 24, 250, 50],
          "confidence": 0.920,
          "confidence_level": "HIGH",
          "is_valid": true,
          "validation_message": "Fuzzy corrected 'PRT-402O' -> 'PRT-4029' (93% match)",
          "variants_evaluated": 3
        },
        {
          "text": "Quantity: 150",
          "raw_text": "Quantity: 150",
          "corrected_text": null,
          "source": "paddleocr",
          "bbox": [25, 125, 160, 148],
          "confidence": 0.970,
          "confidence_level": "HIGH",
          "is_valid": true,
          "validation_message": null
        }
      ]
    }
  ]
}
```

## 🧪 Testing & Verification

### Unit and API Tests
```bash
pytest backend/tests/test_api.py -v
```

---

## 🔍 Standalone OCR Stage-by-Stage Evaluation Tool

A dedicated CLI script to inspect and debug the hybrid OCR pipeline stage by stage on any PDF document.

### Quick Start
```bash
# Process Page 1 of the demo PDF (default num_examples=1)
python evaluate_ocr.py --pdf "demo-sample/Hourly monitor sheet.pdf" --num_examples 1

# Process first 3 pages and save to custom folder
python evaluate_ocr.py -i "path/to/document.pdf" -n 3 -o "evaluation_results"
```

### CLI Options:
| Flag | Short | Default | Description |
| :--- | :--- | :--- | :--- |
| `--pdf` | `-i` | `demo-sample/Hourly monitor sheet.pdf` | Path to input PDF file |
| `--num_examples` | `-n` | `1` | Number of pages to evaluate |
| `--output_dir` | `-o` | `ocr_evaluation_results` | Output folder for evaluation artifacts |
| `--dpi` | | `200` | PDF rendering DPI resolution |
| `--device` | | `auto` | Compute device (`auto`, `cuda`, `cpu`) |
| `--save_variants`| | `True` | Generate and export 4 preprocessing variants per crop |

### Generated Artifacts per Processed Page:
For each page, an individual `page_XX` folder is created containing:
1. `01_original_page.png`: High-resolution render of the raw PDF page.
2. `02_preprocessed_page.png` & `02_preprocessing_steps/`: Deskewed, denoised, and CLAHE contrast-enhanced images.
3. `03_detected_regions.png`: Bounding box visualization with color coding for printed (green), handwritten/low-conf (orange), and fallback contours (cyan).
4. `04_crops/`: Cropped image regions used for OCR along with 4 image filter variants per crop.
5. `05_paddleocr_output.txt` & `05_paddleocr_full_document.txt`: Raw text and block coordinates recognized strictly by PaddleOCR.
6. `06_trocr_output.txt` & `06_trocr_full_document.txt`: Multi-variant handwriting transcriptions generated strictly by Microsoft TrOCR Large.
7. `07_hybrid_ocr_output.txt` & `07_engine_comparison.txt`: Merged hybrid predictions, IoU deduplication, and box-by-box engine comparison.
8. `08_final_extracted_text.txt`, `08_final_detailed_report.json`, and `08_stage_comparison.md`: Spatially reconstructed lines, field validations, and markdown comparison report.
9. `index.html`: Interactive browser-based visual inspector to view images, crops, and compare engine results side-by-side.

