#!/usr/bin/env python
"""
Standalone PaddleOCR 1.6 Document & Form Field Extractor
Reuses the exact same directional spatial field extraction and table alignment logic
as the TrOCR scan flow (HandwritingFieldExtractor), with pure PaddleOCR text recognition.
"""

import sys
import os
import io
import json
import time
import argparse
from typing import List, Dict, Any, Tuple, Optional
from PIL import Image

# Ensure backend root is on sys.path
BACKEND_ROOT = os.path.dirname(os.path.abspath(__file__))
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

# Ensure pure-python protobuf to avoid Windows C++ descriptor errors
os.environ["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"

try:
    from paddleocr import PaddleOCR
    import numpy as np
except ImportError as e:
    sys.stderr.write(f"Error importing PaddleOCR: {str(e)}\n")
    sys.exit(1)

from app.services.handwriting_extractor import (
    HandwritingFieldExtractor,
    DEFAULT_HANDWRITING_TEMPLATE,
)
from app.models.schemas import (
    HandwritingScanningTemplate,
    HandwritingFieldConfig,
    HandwritingTableColumnConfig,
)
from app.services.image_preprocessor import ImagePreprocessor
from app.config import global_ocr_config


def parse_template(template_data: Any) -> HandwritingScanningTemplate:
    """Parses either HandwritingScanningTemplate or DataTemplate into HandwritingScanningTemplate."""
    if not template_data:
        return DEFAULT_HANDWRITING_TEMPLATE

    if isinstance(template_data, str):
        try:
            template_data = json.loads(template_data)
        except Exception:
            return DEFAULT_HANDWRITING_TEMPLATE

    if not isinstance(template_data, dict):
        return DEFAULT_HANDWRITING_TEMPLATE

    try:
        if "table_columns" in template_data or (
            isinstance(template_data.get("fields"), list)
            and len(template_data["fields"]) > 0
            and "value_type" in template_data["fields"][0]
        ):
            return HandwritingScanningTemplate(**template_data)

        if "tableFields" in template_data or "fields" in template_data:
            fields = [
                HandwritingFieldConfig(
                    field_name=f.get("field_name") or f.get("name", ""),
                    field_type="digital",
                    value_type=f.get("value_type", "d"),
                    look_for=f.get("look_for", "right"),
                )
                for f in template_data.get("fields", [])
                if f.get("field_name") or f.get("name")
            ]
            table_cols = [
                HandwritingTableColumnConfig(
                    column_name=c.get("column_name") or c.get("name", ""),
                    value_type=c.get("value_type", "d"),
                )
                for c in (template_data.get("table_columns") or template_data.get("tableFields") or [])
                if c.get("column_name") or c.get("name")
            ]
            return HandwritingScanningTemplate(
                id=template_data.get("id", "handwriting_default"),
                name=template_data.get("name", "Handwriting Scanning Template"),
                description=template_data.get("description", ""),
                fields=fields if fields else DEFAULT_HANDWRITING_TEMPLATE.fields,
                table_columns=table_cols if table_cols else DEFAULT_HANDWRITING_TEMPLATE.table_columns,
            )
    except Exception as e:
        sys.stderr.write(f"Warning: Failed to parse template ({str(e)}), using default template.\n")

    return DEFAULT_HANDWRITING_TEMPLATE


def process_image_with_paddle(
    image: Image.Image,
    template: HandwritingScanningTemplate,
    ocr_engine: PaddleOCR,
) -> Dict[str, Any]:
    """Runs PaddleOCR on image and uses HandwritingFieldExtractor for fields and tables."""
    processed_page, _ = ImagePreprocessor.preprocess_page(image, global_ocr_config)
    img_np = np.array(processed_page.convert("RGB"))

    # Run PaddleOCR detection & recognition
    paddle_results = ocr_engine.ocr(img_np, cls=True)

    ocr_regions: List[Dict[str, Any]] = []
    if paddle_results and len(paddle_results) > 0 and paddle_results[0] is not None:
        for item in paddle_results[0]:
            poly, (text, conf) = item
            xs = [pt[0] for pt in poly]
            ys = [pt[1] for pt in poly]
            bbox = [int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))]
            clean_text = text.strip() if text else ""
            if clean_text and (bbox[2] - bbox[0] >= 4) and (bbox[3] - bbox[1] >= 4):
                ocr_regions.append({
                    "text": clean_text,
                    "raw_text": clean_text,
                    "bbox": bbox,
                    "confidence": float(conf),
                })

    # Reuse the exact same spatial & table extraction as TrOCR scan flow
    # trocr_infer_fn is None -> uses PaddleOCR recognized text for all values
    page_res = HandwritingFieldExtractor.process_handwriting_extraction(
        image_pil=processed_page,
        ocr_regions=ocr_regions,
        template=template,
        trocr_infer_fn=None,
    )

    return {
        "fields": [f.dict() for f in page_res.fields],
        "field_values": page_res.field_values,
        "table_headers": page_res.table_headers,
        "table_rows": page_res.table_rows,
        "structured_text": page_res.structured_text,
        "raw_text": page_res.raw_text,
        "regions_count": len(ocr_regions),
    }


def main():
    parser = argparse.ArgumentParser(description="PaddleOCR 1.6 Standalone Local Document Extractor")
    parser.add_argument("--input", required=True, help="Path to input image or PDF file")
    parser.add_argument("--template", default=None, help="JSON string of template")
    parser.add_argument("--template-file", default=None, help="Path to JSON file of template")
    parser.add_argument("--mode", default="template", help="'template' or 'flexible'")
    args = parser.parse_args()

    input_path = args.input
    if not os.path.exists(input_path):
        err = {"success": False, "error": f"Input file not found: {input_path}"}
        print("__PADDLE_JSON_OUTPUT_START__")
        print(json.dumps(err))
        print("__PADDLE_JSON_OUTPUT_END__")
        sys.exit(1)

    template_obj = None
    if args.template_file and os.path.exists(args.template_file):
        try:
            with open(args.template_file, "r", encoding="utf-8") as f:
                template_obj = json.load(f)
        except Exception:
            template_obj = None
    elif args.template:
        try:
            template_obj = json.loads(args.template)
        except Exception:
            template_obj = None

    active_template = parse_template(template_obj)

    start_time = time.time()

    try:
        ocr_engine = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    except Exception as e:
        err = {"success": False, "error": f"Failed to initialize PaddleOCR: {str(e)}"}
        print("__PADDLE_JSON_OUTPUT_START__")
        print(json.dumps(err))
        print("__PADDLE_JSON_OUTPUT_END__")
        sys.exit(1)

    pages_results = []
    is_pdf = input_path.lower().endswith(".pdf")

    try:
        if is_pdf:
            import pymupdf as fitz
            try:
                fitz.TOOLS.mupdf_display_errors(False)
            except Exception:
                pass
            doc = fitz.open(input_path)
            for page_idx in range(len(doc)):
                page = doc[page_idx]
                pix = page.get_pixmap(dpi=150)
                img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
                res = process_image_with_paddle(img, active_template, ocr_engine)
                res["pageNumber"] = page_idx + 1
                pages_results.append(res)
        else:
            img = Image.open(input_path).convert("RGB")
            res = process_image_with_paddle(img, active_template, ocr_engine)
            res["pageNumber"] = 1
            pages_results.append(res)

        elapsed = round((time.time() - start_time) * 1000, 2)

        # Aggregate results across pages
        primary = pages_results[0] if pages_results else {}
        combined_field_values: Dict[str, str] = {}
        all_table_rows = []
        all_table_headers = primary.get("table_headers", [])

        for p in pages_results:
            for k, v in p.get("field_values", {}).items():
                if v and not combined_field_values.get(k):
                    combined_field_values[k] = v
                elif not combined_field_values.get(k):
                    combined_field_values[k] = ""
            all_table_rows.extend(p.get("table_rows", []))
            if p.get("table_headers"):
                all_table_headers = p.get("table_headers")

        output = {
            "success": True,
            "engineUsed": "PaddleOCR 1.6 (Local)",
            "fields": primary.get("fields", []),
            "field_values": combined_field_values,
            "table_headers": all_table_headers,
            "table_rows": all_table_rows,
            "structured_text": "\n\n".join(p.get("structured_text", "") for p in pages_results),
            "raw_text": "\n\n".join(p.get("raw_text", "") for p in pages_results),
            "total_pages": len(pages_results),
            "processing_time_ms": elapsed,
            "page_results": pages_results,
        }

        # Log complete extraction output directly to stderr for inspection
        sys.stderr.write("=" * 80 + "\n")
        sys.stderr.write("=== [PADDLEOCR 1.6 CLI EXTRACTOR COMPLETE OUTPUT] ===\n")
        sys.stderr.write(f"Total Pages: {len(pages_results)} | Processing Time: {elapsed}ms\n")
        sys.stderr.write(f"--- Extracted Fields ---\n{json.dumps(output['field_values'], indent=2, ensure_ascii=False)}\n")
        sys.stderr.write(f"--- Table Headers ---\n{json.dumps(output['table_headers'], ensure_ascii=False)}\n")
        sys.stderr.write(f"--- Table Rows ---\n{json.dumps(output['table_rows'], indent=2, ensure_ascii=False)}\n")
        sys.stderr.write(f"--- Structured Text ---\n{output['structured_text']}\n")
        sys.stderr.write("=" * 80 + "\n")
        sys.stderr.flush()

        print("__PADDLE_JSON_OUTPUT_START__")
        print(json.dumps(output, ensure_ascii=False))
        print("__PADDLE_JSON_OUTPUT_END__")

    except Exception as e:
        err_out = {"success": False, "error": f"PaddleOCR processing error: {str(e)}"}
        sys.stderr.write(f"[PaddleOCR CLI] Error: {str(e)}\n")
        print("__PADDLE_JSON_OUTPUT_START__")
        print(json.dumps(err_out))
        print("__PADDLE_JSON_OUTPUT_END__")
        sys.exit(1)


if __name__ == "__main__":
    main()
