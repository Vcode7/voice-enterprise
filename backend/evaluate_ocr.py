#!/usr/bin/env python3
"""
Standalone OCR Pipeline Test & Evaluation Script
=================================================
Processes any PDF document stage-by-stage and saves all intermediate images,
bounding boxes, crop variations, and stage text outputs for detailed inspection:

Stages Preserved per Page:
  1. Original PDF page as image (01_original_page.png)
  2. Preprocessing output images (02_preprocessed_page.png + step images)
  3. Text-region detection image with highlighted bounding boxes (03_detected_regions.png)
  4. Cropped text regions & preprocessing variants (04_crops/crop_*.png)
  5. PaddleOCR output as .txt (05_paddleocr_output.txt & full document)
  6. TrOCR output as .txt (06_trocr_output.txt & full document)
  7. Hybrid OCR output as .txt (07_hybrid_ocr_output.txt & engine comparison)
  8. Final processed/extracted text as .txt (08_final_extracted_text.txt & report)

Usage:
  python backend/evaluate_ocr.py --pdf "demo-sample/Hourly monitor sheet.pdf" --num_examples 1
  python backend/evaluate_ocr.py -i "path/to/doc.pdf" -n 3 -o "eval_results"
"""

import os
import sys
import time
import json
import argparse
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
from PIL import Image, ImageDraw, ImageFont
import numpy as np
import cv2

# Set stdout/stderr encoding to utf-8 on Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Ensure backend root is in sys.path
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

# Import application components
try:
    import pymupdf as fitz
except ImportError:
    import fitz

from app.config import settings, OcrConfigModel
from app.core.logger import logger
from app.services.pdf_processor import PdfProcessor
from app.services.image_preprocessor import ImagePreprocessor
from app.services.ocr_engine import get_ocr_engine, OcrEngine
from app.services.validator import FieldValidator
from app.services.field_extractor import SpatialFieldExtractor
from app.models.schemas import ExtractedFieldMatch


def parse_args():
    parser = argparse.ArgumentParser(
        description="Standalone OCR Pipeline Test and Evaluation Tool",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--pdf",
        "-i",
        dest="pdf_path",
        type=str,
        default="demo-sample/Hourly monitor sheet.pdf",
        help="Path to input PDF file (relative or absolute).",
    )
    parser.add_argument(
        "--num_examples",
        "-n",
        dest="num_examples",
        type=int,
        default=5,
        help="Number of pages to evaluate (e.g. 1 for page 1, 3 for pages 1-3).",
    )
    parser.add_argument(
        "--output_dir",
        "-o",
        dest="output_dir",
        type=str,
        default="ocr_evaluation_results",
        help="Root directory where per-page evaluation results and artifacts are saved.",
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=settings.PDF_DPI,
        help="DPI resolution for rendering PDF pages to images.",
    )
    parser.add_argument(
        "--device",
        type=str,
        default=settings.DEVICE,
        choices=["auto", "cuda", "cpu", "mps"],
        help="Compute device for deep learning inference.",
    )
    parser.add_argument(
        "--save_variants",
        action="store_true",
        default=True,
        help="Save all TrOCR image preprocessing variants per crop.",
    )
    parser.add_argument(
        "--config_json",
        type=str,
        default=None,
        help="Optional path to a JSON file overriding OCR pipeline parameters.",
    )
    parser.add_argument(
        "--template_fields",
        type=str,
        default="Part No,Machine Name,Description,Raw Material,Planned Prodn,Quantity,Date,Shift,Opening Counter,Closing Counter,Cycle Time,Startup Time,Operator,No. of Cavities,Purge Weight,Runner Weight,Batch No",
        help="Comma-separated list of target template fields to extract specifically.",
    )
    parser.add_argument(
        "--template_json",
        type=str,
        default=None,
        help="Optional path to template JSON file defining fields schema.",
    )
    return parser.parse_args()


class StageEvaluator:
    """
    Executes each stage of the OCR pipeline sequentially, persisting all
    intermediate visual images, bounding box diagrams, crops, and text representations.
    """

    def __init__(
        self,
        pdf_path: Path,
        output_dir: Path,
        num_examples: int = 1,
        dpi: int = 200,
        device: str = "auto",
        save_variants: bool = True,
        config: Optional[OcrConfigModel] = None,
        template_fields: Optional[Any] = None,
    ):
        self.pdf_path = pdf_path
        self.output_dir = output_dir
        self.num_examples = max(1, num_examples)
        self.dpi = dpi
        self.device = device
        self.save_variants = save_variants
        self.config = config or OcrConfigModel()
        self.template_fields = template_fields

        # Update global settings device if specified
        if self.device != settings.DEVICE:
            settings.DEVICE = self.device

        self.ocr_engine: Optional[OcrEngine] = None

    def initialize_models(self):
        """Initializes PaddleOCR and TrOCR engines."""
        print("\n" + "=" * 75)
        print("  INITIALIZING OCR ENGINES (PaddleOCR + TrOCR Large)")
        print("=" * 75)
        t0 = time.time()
        self.ocr_engine = get_ocr_engine()
        elapsed = time.time() - t0
        print(f"[OK] Engines loaded onto device '{self.ocr_engine.device_name}' in {elapsed:.2f}s.\n")

    def run(self) -> Dict[str, Any]:
        """Main execution loop for all requested pages."""
        if not self.pdf_path.exists():
            raise FileNotFoundError(f"PDF file not found at: {self.pdf_path}")

        self.output_dir.mkdir(parents=True, exist_ok=True)

        print("=" * 75)
        print(f"  STARTING OCR EVALUATION RUN")
        print(f"  PDF Source:     {self.pdf_path.resolve()}")
        print(f"  Pages to Test:  {self.num_examples}")
        print(f"  DPI Resolution: {self.dpi}")
        print(f"  Output Root:    {self.output_dir.resolve()}")
        print("=" * 75)

        # ---------------------------------------------------------
        # STAGE 1: PDF Parsing & Page Conversion
        # ---------------------------------------------------------
        print("\n[STAGE 1] Rendering PDF Pages to High-Resolution Images...")
        with open(self.pdf_path, "rb") as f:
            pdf_bytes = f.read()

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        total_pdf_pages = len(doc)
        pages_to_process = min(total_pdf_pages, self.num_examples)
        print(f"PDF has {total_pdf_pages} page(s). Processing first {pages_to_process} page(s)...")

        # Convert pages
        raw_images = PdfProcessor.convert_pdf_bytes_to_images(
            pdf_bytes=pdf_bytes,
            dpi=self.dpi,
            max_pages=pages_to_process,
        )

        self.initialize_models()

        page_summaries: List[Dict[str, Any]] = []

        for page_idx, page_img in enumerate(raw_images, start=1):
            page_dir = self.output_dir / f"page_{page_idx:02d}"
            page_dir.mkdir(parents=True, exist_ok=True)

            print("\n" + "#" * 75)
            print(f"  PROCESSING PAGE {page_idx} of {len(raw_images)}")
            print(f"  Target Folder: {page_dir.resolve()}")
            print("#" * 75)

            summary = self._process_single_page(page_idx, page_img, page_dir)
            page_summaries.append(summary)

        # Generate Master HTML Report
        master_html = self._generate_master_html_report(page_summaries)
        master_html_path = self.output_dir / "index.html"
        with open(master_html_path, "w", encoding="utf-8") as f:
            f.write(master_html)

        # Save run manifest
        run_manifest = {
            "pdf_source": str(self.pdf_path),
            "total_pdf_pages": total_pdf_pages,
            "processed_pages": len(page_summaries),
            "dpi": self.dpi,
            "device": self.ocr_engine.device_name if self.ocr_engine else "unknown",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "pages": page_summaries,
        }
        with open(self.output_dir / "run_summary.json", "w", encoding="utf-8") as f:
            json.dump(run_manifest, f, indent=2)

        print("\n" + "=" * 75)
        print("  OCR EVALUATION COMPLETED SUCCESSFULLY!")
        print(f"  Processed {len(page_summaries)} page(s).")
        print(f"  Master Report: {master_html_path.resolve()}")
        print("=" * 75)

        return run_manifest

    def _process_single_page(
        self,
        page_num: int,
        orig_img: Image.Image,
        page_dir: Path,
    ) -> Dict[str, Any]:
        """Runs and captures all 8 stages for a single document page."""
        page_start = time.time()
        stage_metrics: Dict[str, Any] = {}

        # ---------------------------------------------------------
        # STAGE 1: Save Original PDF Page as Image
        # ---------------------------------------------------------
        stage1_path = page_dir / "01_original_page.png"
        orig_img.save(stage1_path, format="PNG")
        print(f"[Stage 1] Saved original page image: {stage1_path.name} ({orig_img.width}x{orig_img.height} px)")
        stage_metrics["stage_1_original_image"] = {
            "file": stage1_path.name,
            "dimensions": f"{orig_img.width}x{orig_img.height}",
        }

        # ---------------------------------------------------------
        # STAGE 2: Image Preprocessing (Deskew, Denoise, CLAHE, etc.)
        # ---------------------------------------------------------
        t0 = time.time()
        steps_dir = page_dir / "02_preprocessing_steps"
        steps_dir.mkdir(parents=True, exist_ok=True)

        orig_np = np.array(orig_img.convert("RGB"))
        preproc_steps_recorded = []

        # 2a. Deskew
        deskewed_np, angle = ImagePreprocessor.deskew(orig_np)
        if abs(angle) > 0.0:
            Image.fromarray(deskewed_np).save(steps_dir / "02a_deskewed.png")
            preproc_steps_recorded.append(f"deskew ({angle}°)")
        current_np = deskewed_np

        # 2b. Denoise
        if self.config.enable_denoise:
            denoised_np = ImagePreprocessor.denoise(current_np)
            Image.fromarray(denoised_np).save(steps_dir / "02b_denoised.png")
            preproc_steps_recorded.append("denoise")
            current_np = denoised_np

        # 2c. Contrast CLAHE
        if self.config.enable_contrast_enhance:
            clahe_np = ImagePreprocessor.enhance_contrast(current_np)
            Image.fromarray(clahe_np).save(steps_dir / "02c_contrast_clahe.png")
            preproc_steps_recorded.append("contrast_enhance_clahe")
            current_np = clahe_np

        # 2d. Adaptive Threshold (optional step inspection)
        if self.config.enable_adaptive_threshold:
            thresh_np = ImagePreprocessor.adaptive_threshold(current_np)
            Image.fromarray(thresh_np).save(steps_dir / "02d_adaptive_threshold.png")
            preproc_steps_recorded.append("adaptive_threshold")
            current_np = thresh_np

        # 2e. Upscaling
        if self.config.enable_upscaling and self.config.upscale_factor > 1.0:
            h, w = current_np.shape[:2]
            if w < 2000 and h < 2000:
                current_np = ImagePreprocessor.upscale(current_np, self.config.upscale_factor)
                preproc_steps_recorded.append(f"upscale_{self.config.upscale_factor}x")

        preprocessed_img = Image.fromarray(current_np)
        stage2_path = page_dir / "02_preprocessed_page.png"
        preprocessed_img.save(stage2_path, format="PNG")
        stage2_time = (time.time() - t0) * 1000.0

        # Save preprocessing metadata
        preproc_meta = {
            "steps_applied": preproc_steps_recorded,
            "deskew_angle": angle,
            "duration_ms": round(stage2_time, 2),
            "final_dimensions": f"{preprocessed_img.width}x{preprocessed_img.height}",
        }
        with open(page_dir / "02_preprocessing_metadata.json", "w", encoding="utf-8") as f:
            json.dump(preproc_meta, f, indent=2)

        print(f"[Stage 2] Saved preprocessed image: {stage2_path.name} (Steps: {preproc_steps_recorded or 'None'}, {stage2_time:.1f}ms)")
        stage_metrics["stage_2_preprocessing"] = preproc_meta

        # ---------------------------------------------------------
        # STAGE 3: Text-Region Detection (PaddleOCR + Morphological Fallback)
        # ---------------------------------------------------------
        t0 = time.time()
        img_np = np.array(preprocessed_img.convert("RGB"))
        height, width, _ = img_np.shape

        paddle_results = None
        try:
            paddle_results = self.ocr_engine._paddle_ocr.ocr(img_np, cls=True)
        except Exception as e:
            logger.error(f"PaddleOCR detection failed: {str(e)}")

        raw_candidates: List[Dict[str, Any]] = []
        candidate_handwriting_items: List[Dict[str, Any]] = []
        detected_regions_manifest: List[Dict[str, Any]] = []

        if paddle_results and len(paddle_results) > 0 and paddle_results[0] is not None:
            for idx, item in enumerate(paddle_results[0], start=1):
                poly, (paddle_text, paddle_conf) = item
                bbox = self.ocr_engine._polygon_to_bbox(poly)
                clean_text = paddle_text.strip() if paddle_text else ""

                if not clean_text or (bbox[2] - bbox[0] < 5) or (bbox[3] - bbox[1] < 5):
                    continue

                # Crop bounding box with padding
                pad_x = 4
                pad_y = 3
                x1 = max(0, bbox[0] - pad_x)
                y1 = max(0, bbox[1] - pad_y)
                x2 = min(width, bbox[2] + pad_x)
                y2 = min(height, bbox[3] + pad_y)
                crop_pil = preprocessed_img.crop((x1, y1, x2, y2))

                # Handle label separation if enabled
                if self.config.separate_labels_and_values and ":" in clean_text:
                    parts = clean_text.split(":", 1)
                    label_part = parts[0].strip() + ":"
                    value_part = parts[1].strip()

                    label_box = [bbox[0], bbox[1], bbox[0] + int((bbox[2] - bbox[0]) * 0.45), bbox[3]]
                    raw_candidates.append({
                        "id": len(detected_regions_manifest) + 1,
                        "raw_text": label_part,
                        "text": label_part,
                        "source": "paddleocr",
                        "bbox": label_box,
                        "confidence": 0.98,
                        "field_type": "text",
                        "routed_engine": "paddleocr (label)",
                        "polygon": poly,
                    })
                    detected_regions_manifest.append(raw_candidates[-1])

                    if value_part:
                        val_crop_x1 = bbox[0] + int((bbox[2] - bbox[0]) * 0.40)
                        val_box = [val_crop_x1, bbox[1], bbox[2], bbox[3]]
                        val_crop = preprocessed_img.crop((val_crop_x1, y1, x2, y2))
                        val_entry = {
                            "id": len(detected_regions_manifest) + 1,
                            "crop_pil": val_crop,
                            "paddle_text": value_part,
                            "bbox": val_box,
                            "conf": float(paddle_conf),
                            "routed_engine": "trocr (value)",
                            "polygon": poly,
                        }
                        candidate_handwriting_items.append(val_entry)
                        detected_regions_manifest.append(val_entry)
                    continue

                # Route: TrOCR vs PaddleOCR
                if paddle_conf < self.config.handwriting_conf_threshold:
                    entry = {
                        "id": len(detected_regions_manifest) + 1,
                        "crop_pil": crop_pil,
                        "paddle_text": clean_text,
                        "bbox": bbox,
                        "conf": float(paddle_conf),
                        "routed_engine": "trocr (handwriting/low-conf)",
                        "polygon": poly,
                    }
                    candidate_handwriting_items.append(entry)
                    detected_regions_manifest.append(entry)
                else:
                    entry = {
                        "id": len(detected_regions_manifest) + 1,
                        "raw_text": clean_text,
                        "text": clean_text,
                        "source": "paddleocr",
                        "bbox": bbox,
                        "confidence": round(float(paddle_conf), 4),
                        "field_type": "text",
                        "routed_engine": "paddleocr (high-conf printed)",
                        "polygon": poly,
                        "crop_pil": crop_pil,
                        "paddle_text": clean_text,
                        "conf": float(paddle_conf),
                    }
                    raw_candidates.append(entry)
                    detected_regions_manifest.append(entry)

        # Morphological Fallback for faint handwriting
        try:
            gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
            binary = cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 15
            )
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, int(width * 0.035)), 3))
            dilated = cv2.dilate(binary, kernel, iterations=2)
            contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            existing_bboxes = [b["bbox"] for b in detected_regions_manifest]
            for cnt in contours:
                cx, cy, cw, ch = cv2.boundingRect(cnt)
                if cw >= int(width * 0.05) and ch >= 8 and ch < int(height * 0.4):
                    candidate_bbox = [cx, cy, cx + cw, cy + ch]
                    overlaps = any(self.ocr_engine._calculate_iou(candidate_bbox, eb) > 0.25 for eb in existing_bboxes)
                    if not overlaps:
                        crop_pil = preprocessed_img.crop((cx, cy, cx + cw, cy + ch))
                        fallback_entry = {
                            "id": len(detected_regions_manifest) + 1,
                            "crop_pil": crop_pil,
                            "paddle_text": "",
                            "bbox": candidate_bbox,
                            "conf": 0.70,
                            "routed_engine": "trocr (morphology fallback)",
                            "polygon": None,
                        }
                        candidate_handwriting_items.append(fallback_entry)
                        detected_regions_manifest.append(fallback_entry)
                        existing_bboxes.append(candidate_bbox)
        except Exception as e:
            logger.debug(f"Morphological fallback contour error: {str(e)}")

        stage3_time = (time.time() - t0) * 1000.0

        # Draw Detected Regions Image
        annotated_img = self._draw_detected_regions(preprocessed_img, detected_regions_manifest)
        stage3_img_path = page_dir / "03_detected_regions.png"
        annotated_img.save(stage3_img_path, format="PNG")

        # Save Regions Table & JSON
        regions_json_data = [
            {
                "id": r["id"],
                "bbox": r["bbox"],
                "initial_paddle_text": r.get("paddle_text", r.get("raw_text", "")),
                "initial_confidence": round(float(r.get("conf", r.get("confidence", 0.0))), 3),
                "routed_engine": r["routed_engine"],
            }
            for r in detected_regions_manifest
        ]
        with open(page_dir / "03_detected_regions.json", "w", encoding="utf-8") as f:
            json.dump(regions_json_data, f, indent=2)

        with open(page_dir / "03_detected_regions_table.txt", "w", encoding="utf-8") as f:
            f.write(f"Detected Regions for Page {page_num} ({len(detected_regions_manifest)} total regions):\n")
            f.write(f"{'ID':<5} | {'Engine Route':<28} | {'Conf':<6} | {'Bounding Box (x1, y1, x2, y2)':<25} | {'Initial Text'}\n")
            f.write("-" * 95 + "\n")
            for r in regions_json_data:
                f.write(f"{r['id']:<5} | {r['routed_engine']:<28} | {r['initial_confidence']:<6.3f} | {str(r['bbox']):<25} | {r['initial_paddle_text']}\n")

        print(f"[Stage 3] Saved detected regions: {stage3_img_path.name} ({len(detected_regions_manifest)} regions found in {stage3_time:.1f}ms)")
        stage_metrics["stage_3_detection"] = {
            "total_regions": len(detected_regions_manifest),
            "handwriting_candidates": len(candidate_handwriting_items),
            "printed_candidates": len(raw_candidates),
            "duration_ms": round(stage3_time, 2),
        }

        # ---------------------------------------------------------
        # STAGE 4: Cropped Text Regions and Preprocessing Variants
        # ---------------------------------------------------------
        t0 = time.time()
        crops_dir = page_dir / "04_crops"
        crops_dir.mkdir(parents=True, exist_ok=True)

        crops_manifest = []
        for r in detected_regions_manifest:
            crop_id = r["id"]
            bbox = r["bbox"]

            # Crop if not already present
            if "crop_pil" in r and r["crop_pil"] is not None:
                crop_pil = r["crop_pil"]
            else:
                crop_pil = preprocessed_img.crop((bbox[0], bbox[1], bbox[2], bbox[3]))

            # Save primary crop
            crop_filename = f"crop_{crop_id:03d}.png"
            crop_path = crops_dir / crop_filename
            crop_pil.save(crop_path, format="PNG")

            manifest_entry = {
                "id": crop_id,
                "crop_file": crop_filename,
                "bbox": bbox,
                "dimensions": f"{crop_pil.width}x{crop_pil.height}",
                "routed_engine": r["routed_engine"],
                "variants": [],
            }

            # Generate and save variants if requested
            if self.save_variants and crop_pil.width >= 5 and crop_pil.height >= 5:
                variants = ImagePreprocessor.generate_variants(crop_pil, count=4)
                variant_names = [
                    "var1_clahe_contrast",
                    "var2_otsu_binary",
                    "var3_adaptive_dilate",
                    "var4_sharpness_boost",
                ]
                for v_idx, (v_img, v_name) in enumerate(zip(variants, variant_names), start=1):
                    v_filename = f"crop_{crop_id:03d}_{v_name}.png"
                    v_img.save(crops_dir / v_filename, format="PNG")
                    manifest_entry["variants"].append(v_filename)

            crops_manifest.append(manifest_entry)

        with open(crops_dir / "crops_manifest.json", "w", encoding="utf-8") as f:
            json.dump(crops_manifest, f, indent=2)

        stage4_time = (time.time() - t0) * 1000.0
        print(f"[Stage 4] Saved {len(crops_manifest)} text crops and preprocessing variants to: {crops_dir.name}/ ({stage4_time:.1f}ms)")
        stage_metrics["stage_4_crops"] = {
            "total_crops": len(crops_manifest),
            "directory": str(crops_dir.name),
            "duration_ms": round(stage4_time, 2),
        }

        # ---------------------------------------------------------
        # STAGE 5: PaddleOCR Stage Output (.txt)
        # ---------------------------------------------------------
        print("[Stage 5] Generating Pure PaddleOCR Output...")
        paddle_blocks: List[Dict[str, Any]] = []
        for r in detected_regions_manifest:
            p_text = r.get("paddle_text", r.get("raw_text", "")).strip()
            p_conf = float(r.get("conf", r.get("confidence", 0.0)))
            paddle_blocks.append({
                "id": r["id"],
                "bbox": r["bbox"],
                "text": p_text,
                "confidence": round(p_conf, 4),
            })

        # Sort PaddleOCR blocks top-to-bottom for readable document output
        paddle_blocks_sorted = sorted(paddle_blocks, key=lambda b: (b["bbox"][1], b["bbox"][0]))
        paddle_lines = [b["text"] for b in paddle_blocks_sorted if b["text"]]
        paddle_full_doc = "\n".join(paddle_lines)

        # 1. Full document text
        with open(page_dir / "05_paddleocr_full_document.txt", "w", encoding="utf-8") as f:
            f.write(paddle_full_doc)

        # 2. Detailed PaddleOCR block report
        with open(page_dir / "05_paddleocr_output.txt", "w", encoding="utf-8") as f:
            f.write(f"=== STAGE 5: PADDLEOCR OUTPUT (PAGE {page_num}) ===\n\n")
            f.write(f"Total Text Blocks Recognized: {len(paddle_blocks)}\n\n")
            f.write(f"{'ID':<5} | {'Conf':<6} | {'Bounding Box [x1,y1,x2,y2]':<25} | {'Recognized Text'}\n")
            f.write("-" * 90 + "\n")
            for b in paddle_blocks_sorted:
                f.write(f"{b['id']:<5} | {b['confidence']:<6.3f} | {str(b['bbox']):<25} | {b['text']}\n")
            f.write("\n" + "=" * 50 + "\n")
            f.write("RECONSTRUCTED DOCUMENT TEXT (PADDLEOCR ONLY):\n")
            f.write("=" * 50 + "\n")
            f.write(paddle_full_doc + "\n")

        print(f"[Stage 5] Saved PaddleOCR output: 05_paddleocr_output.txt ({len(paddle_lines)} lines)")

        # ---------------------------------------------------------
        # STAGE 6: TrOCR Stage Output (.txt)
        # ---------------------------------------------------------
        print("[Stage 6] Running TrOCR Large Inference with Multi-Variant Evaluation...")
        t0 = time.time()
        trocr_results: List[Dict[str, Any]] = []

        for r in detected_regions_manifest:
            crop_id = r["id"]
            bbox = r["bbox"]
            crop_pil = r.get("crop_pil")
            if crop_pil is None:
                crop_pil = preprocessed_img.crop((bbox[0], bbox[1], bbox[2], bbox[3]))

            # Run TrOCR with variants
            best_text, est_conf, v_count = self.ocr_engine._infer_crop_with_variants(
                crop_pil, self.config
            )

            # Retry if low confidence
            retried = False
            if self.config.ocr_retry and (not best_text or est_conf < self.config.ocr_retry_conf_threshold):
                retry_np = ImagePreprocessor.enhance_contrast(np.array(crop_pil.convert("RGB")))
                retry_pil = Image.fromarray(retry_np)
                retry_text, retry_conf, _ = self.ocr_engine._infer_crop_with_variants(retry_pil, self.config)
                if retry_text:
                    best_text = retry_text
                    est_conf = max(est_conf, 0.85)
                    retried = True

            trocr_results.append({
                "id": crop_id,
                "bbox": bbox,
                "text": best_text.strip(),
                "confidence": round(est_conf, 4),
                "variants_evaluated": v_count,
                "retried": retried,
                "crop_pil": crop_pil,
            })

        stage6_time = (time.time() - t0) * 1000.0

        # Sort TrOCR blocks top-to-bottom
        trocr_blocks_sorted = sorted(trocr_results, key=lambda b: (b["bbox"][1], b["bbox"][0]))
        trocr_lines = [b["text"] for b in trocr_blocks_sorted if b["text"]]
        trocr_full_doc = "\n".join(trocr_lines)

        # 1. Full document text
        with open(page_dir / "06_trocr_full_document.txt", "w", encoding="utf-8") as f:
            f.write(trocr_full_doc)

        # 2. Detailed TrOCR block report
        with open(page_dir / "06_trocr_output.txt", "w", encoding="utf-8") as f:
            f.write(f"=== STAGE 6: TrOCR LARGE OUTPUT (PAGE {page_num}) ===\n\n")
            f.write(f"Model: {settings.TROCR_MODEL_NAME} on {self.ocr_engine.device_name}\n")
            f.write(f"Total Regions Transcribed: {len(trocr_results)} (in {stage6_time:.1f}ms)\n\n")
            f.write(f"{'ID':<5} | {'Variants':<8} | {'Retry?':<6} | {'Conf':<6} | {'Bounding Box':<25} | {'TrOCR Transcribed Text'}\n")
            f.write("-" * 100 + "\n")
            for b in trocr_blocks_sorted:
                retry_str = "YES" if b["retried"] else "NO"
                f.write(f"{b['id']:<5} | {b['variants_evaluated']:<8} | {retry_str:<6} | {b['confidence']:<6.3f} | {str(b['bbox']):<25} | {b['text']}\n")
            f.write("\n" + "=" * 50 + "\n")
            f.write("RECONSTRUCTED DOCUMENT TEXT (TrOCR ONLY):\n")
            f.write("=" * 50 + "\n")
            f.write(trocr_full_doc + "\n")

        print(f"[Stage 6] Saved TrOCR output: 06_trocr_output.txt ({len(trocr_lines)} lines, {stage6_time:.1f}ms)")
        stage_metrics["stage_6_trocr"] = {
            "transcribed_regions": len(trocr_results),
            "duration_ms": round(stage6_time, 2),
        }

        # ---------------------------------------------------------
        # STAGE 7: Hybrid OCR Stage Output (.txt)
        # ---------------------------------------------------------
        print("[Stage 7] Generating Hybrid Engine Output & Deduplication...")
        t0 = time.time()
        hybrid_candidates: List[Dict[str, Any]] = []

        # Create mapping of TrOCR results by ID
        trocr_by_id = {t["id"]: t for t in trocr_results}

        # Determine hybrid selection for each detected region
        comparison_rows: List[Dict[str, Any]] = []

        for r in detected_regions_manifest:
            r_id = r["id"]
            bbox = r["bbox"]
            p_text = r.get("paddle_text", r.get("raw_text", "")).strip()
            p_conf = float(r.get("conf", r.get("confidence", 0.0)))

            t_entry = trocr_by_id.get(r_id, {})
            t_text = t_entry.get("text", "").strip()
            t_conf = float(t_entry.get("confidence", 0.0))

            # Hybrid routing decision logic
            routed_engine = r.get("routed_engine", "")
            if "trocr" in routed_engine:
                selected_text = t_text if t_text else p_text
                selected_source = "trocr" if t_text else "paddleocr"
                selected_conf = t_conf if t_text else p_conf
            else:
                selected_text = p_text if p_text else t_text
                selected_source = "paddleocr" if p_text else "trocr"
                selected_conf = p_conf if p_text else t_conf

            hybrid_candidates.append({
                "id": r_id,
                "raw_text": selected_text,
                "text": selected_text,
                "source": selected_source,
                "bbox": bbox,
                "confidence": round(selected_conf, 4),
                "variants_evaluated": t_entry.get("variants_evaluated", 1),
            })

            comparison_rows.append({
                "id": r_id,
                "bbox": bbox,
                "route": routed_engine,
                "paddle_text": p_text,
                "paddle_conf": round(p_conf, 3),
                "trocr_text": t_text,
                "trocr_conf": round(t_conf, 3),
                "selected_source": selected_source,
                "selected_text": selected_text,
                "selected_conf": round(selected_conf, 3),
            })

        # Spatial Deduplication
        deduped_blocks: List[Dict[str, Any]] = []
        sorted_candidates = sorted(
            hybrid_candidates,
            key=lambda b: (1 if b["source"] == "trocr" else 0, b.get("confidence", 0)),
            reverse=True,
        )

        for cand in sorted_candidates:
            is_dup = False
            for existing in deduped_blocks:
                if self.ocr_engine._calculate_iou(cand["bbox"], existing["bbox"]) > self.config.iou_deduplication_threshold:
                    is_dup = True
                    break
            if not is_dup:
                deduped_blocks.append(cand)

        stage7_time = (time.time() - t0) * 1000.0

        # Save Engine Comparison Table
        with open(page_dir / "07_engine_comparison.txt", "w", encoding="utf-8") as f:
            f.write(f"=== STAGE 7: ENGINE COMPARISON (PADDLEOCR vs TrOCR vs HYBRID SELECTED) ===\n\n")
            f.write(f"{'ID':<4} | {'Routing Logic':<25} | {'PaddleOCR Recognized':<30} | {'TrOCR Transcribed':<30} | {'Chosen':<10} | {'Final Value'}\n")
            f.write("=" * 130 + "\n")
            for c in comparison_rows:
                f.write(
                    f"{c['id']:<4} | {c['route'][:25]:<25} | "
                    f"'{c['paddle_text'][:27]}' ({c['paddle_conf']})".ljust(30) + " | "
                    f"'{c['trocr_text'][:27]}' ({c['trocr_conf']})".ljust(30) + " | "
                    f"{c['selected_source']:<10} | "
                    f"'{c['selected_text']}'\n"
                )

        # Save Hybrid OCR Output .txt
        deduped_sorted = sorted(deduped_blocks, key=lambda b: (b["bbox"][1], b["bbox"][0]))
        with open(page_dir / "07_hybrid_ocr_output.txt", "w", encoding="utf-8") as f:
            f.write(f"=== STAGE 7: HYBRID OCR OUTPUT (PAGE {page_num}) ===\n\n")
            f.write(f"Candidate Blocks: {len(hybrid_candidates)} -> Deduplicated Blocks: {len(deduped_blocks)}\n\n")
            f.write(f"{'ID':<5} | {'Source':<10} | {'Conf':<6} | {'Bounding Box':<25} | {'Hybrid OCR Text'}\n")
            f.write("-" * 90 + "\n")
            for b in deduped_sorted:
                f.write(f"{b['id']:<5} | {b['source']:<10} | {b['confidence']:<6.3f} | {str(b['bbox']):<25} | {b['text']}\n")

        print(f"[Stage 7] Saved Hybrid OCR output: 07_hybrid_ocr_output.txt ({len(deduped_blocks)} blocks after dedup)")

        # ---------------------------------------------------------
        # STAGE 8: Final Processed / Extracted Text (.txt & JSON)
        # ---------------------------------------------------------
        print("[Stage 8] Final Reconstructing, Validating & Formatting...")
        t0 = time.time()

        validated_blocks = []
        for b in deduped_blocks:
            raw_txt = b["raw_text"]
            cur_txt = raw_txt
            corr_txt = None
            is_valid = True
            val_msg = None
            conf = b.get("confidence", 0.90)

            # Field validation
            if self.config.field_validation:
                f_type = b.get("field_type")
                f_valid, f_msg = FieldValidator.validate_field_type(cur_txt, f_type)
                if not f_valid:
                    is_valid = False
                    val_msg = f_msg

            # Confidence level
            conf_level = FieldValidator.classify_confidence(
                conf,
                high_thresh=self.config.high_conf_threshold,
                med_thresh=self.config.medium_conf_threshold,
            )

            validated_blocks.append({
                "id": b["id"],
                "text": cur_txt,
                "raw_text": raw_txt,
                "corrected_text": corr_txt,
                "source": b["source"],
                "bbox": b["bbox"],
                "confidence": round(float(conf), 4),
                "confidence_level": conf_level,
                "is_valid": is_valid,
                "validation_message": val_msg,
                "variants_evaluated": b.get("variants_evaluated"),
            })

        # Sort reading order (top-to-bottom, left-to-right)
        validated_blocks.sort(key=lambda b: (b["bbox"][1], b["bbox"][0]))

        lines_grouped: List[List[Dict[str, Any]]] = []
        for block in validated_blocks:
            y_center = (block["bbox"][1] + block["bbox"][3]) / 2.0
            height_box = block["bbox"][3] - block["bbox"][1]
            tolerance = max(14.0, height_box * 0.55)

            matched_line = None
            for line in lines_grouped:
                line_y_centers = [(b["bbox"][1] + b["bbox"][3]) / 2.0 for b in line]
                avg_y = sum(line_y_centers) / len(line_y_centers)
                if abs(y_center - avg_y) <= tolerance:
                    matched_line = line
                    break

            if matched_line is not None:
                matched_line.append(block)
            else:
                lines_grouped.append([block])

        reconstructed_lines: List[str] = []
        reconstructed_raw_lines: List[str] = []
        ordered_blocks: List[Dict[str, Any]] = []

        for line in lines_grouped:
            line.sort(key=lambda b: b["bbox"][0])
            line_text = " ".join(b["text"] for b in line if b["text"]).strip()
            raw_line_text = " ".join(b["raw_text"] for b in line if b["raw_text"]).strip()
            if line_text:
                reconstructed_lines.append(line_text)
            if raw_line_text:
                reconstructed_raw_lines.append(raw_line_text)
            ordered_blocks.extend(line)

        final_extracted_text = "\n".join(reconstructed_lines).strip()
        stage8_time = (time.time() - t0) * 1000.0
        total_page_time = (time.time() - page_start) * 1000.0

        # Save 08_final_extracted_text.txt (full document)
        with open(page_dir / "08_final_extracted_text.txt", "w", encoding="utf-8") as f:
            f.write(final_extracted_text + "\n")

        # ---------------------------------------------------------
        # FIELD-SPECIFIC EXTRACTION (Spatial Matching for Template Fields)
        # ---------------------------------------------------------
        field_matches: List[ExtractedFieldMatch] = []
        field_specific_text = ""

        if self.template_fields:
            # Parse template fields if passed as comma-separated string
            raw_tfields = self.template_fields
            if isinstance(raw_tfields, str) and not raw_tfields.startswith("[") and not raw_tfields.startswith("{"):
                target_fields_list = [f.strip() for f in raw_tfields.split(",") if f.strip()]
            elif isinstance(raw_tfields, str):
                try:
                    target_fields_list = json.loads(raw_tfields)
                except Exception:
                    target_fields_list = [raw_tfields]
            else:
                target_fields_list = raw_tfields

            field_matches, field_specific_text = SpatialFieldExtractor.extract_fields(
                ocr_blocks=ordered_blocks,
                template_fields=target_fields_list,
                image_width=preprocessed_img.width,
                image_height=preprocessed_img.height,
            )

            # 1. Save 08_field_specific_extracted_text.txt
            with open(page_dir / "08_field_specific_extracted_text.txt", "w", encoding="utf-8") as f:
                f.write(field_specific_text + "\n")

            # 2. Save 08_field_matches_debug.json
            field_matches_json = [f.model_dump() for f in field_matches]
            with open(page_dir / "08_field_matches_debug.json", "w", encoding="utf-8") as f:
                json.dump(field_matches_json, f, indent=2)

            # 3. Draw and save 08_field_matching_visualization.png
            field_vis_img = self._draw_field_matches(preprocessed_img, field_matches)
            field_vis_path = page_dir / "08_field_matching_visualization.png"
            field_vis_img.save(field_vis_path, format="PNG")

            print(f"[Stage 8] Field-Specific Extraction: Saved 08_field_specific_extracted_text.txt ({len(field_matches)} template fields extracted)")
            print(f"[Stage 8] Saved Field Matches Visualization: {field_vis_path.name}")

        # Save full structured JSON
        final_json_payload = {
            "page": page_num,
            "text": field_specific_text if field_specific_text else final_extracted_text,
            "field_specific_text": field_specific_text,
            "raw_text": "\n".join(reconstructed_raw_lines).strip(),
            "lines_detected": len(reconstructed_lines),
            "blocks_count": len(ordered_blocks),
            "total_page_duration_ms": round(total_page_time, 2),
            "extracted_fields": [f.model_dump() for f in field_matches],
            "blocks": ordered_blocks,
        }
        with open(page_dir / "08_final_detailed_report.json", "w", encoding="utf-8") as f:
            json.dump(final_json_payload, f, indent=2)

        # Save Markdown Stage Comparison Summary
        md_summary = self._generate_markdown_summary(
            page_num=page_num,
            paddle_lines=paddle_lines,
            trocr_lines=trocr_lines,
            reconstructed_lines=reconstructed_lines,
            ordered_blocks=ordered_blocks,
            comparison_rows=comparison_rows,
            total_duration_ms=total_page_time,
            field_matches=field_matches,
            field_specific_text=field_specific_text,
        )
        with open(page_dir / "08_stage_comparison.md", "w", encoding="utf-8") as f:
            f.write(md_summary)

        # Generate Interactive HTML Viewer for this page
        page_html = self._generate_page_html_viewer(page_num, page_dir, final_json_payload, comparison_rows)
        with open(page_dir / "index.html", "w", encoding="utf-8") as f:
            f.write(page_html)

        print(f"[Stage 8] Saved Final Extracted Text: 08_final_extracted_text.txt ({len(reconstructed_lines)} lines)")
        print(f"[OK] Page {page_num} processing completed in {total_page_time:.1f}ms total.\n")

        return {
            "page": page_num,
            "page_dir": str(page_dir.name),
            "lines_extracted": len(field_matches) if field_matches else len(reconstructed_lines),
            "blocks_count": len(ordered_blocks),
            "duration_ms": round(total_page_time, 2),
            "final_text_preview": (field_specific_text if field_specific_text else final_extracted_text)[:200] + "..." if len(field_specific_text if field_specific_text else final_extracted_text) > 200 else (field_specific_text if field_specific_text else final_extracted_text),
        }

    def _draw_detected_regions(
        self,
        base_img: Image.Image,
        regions: List[Dict[str, Any]],
    ) -> Image.Image:
        """Annotates image with bounding boxes, IDs, confidences, and routed engine colors."""
        annotated = base_img.copy().convert("RGB")
        draw = ImageDraw.Draw(annotated)

        # Attempt to load font or fallback
        try:
            font = ImageFont.truetype("arial.ttf", size=14)
        except Exception:
            font = ImageFont.load_default()

        # Color schemes:
        # Green = Printed PaddleOCR
        # Amber/Orange = Routed to TrOCR
        # Cyan = Morphology fallback
        color_map = {
            "paddleocr": (34, 197, 94),      # Green
            "trocr": (249, 115, 22),         # Orange
            "fallback": (6, 182, 212),       # Cyan
        }

        for r in regions:
            bbox = r["bbox"]
            route = r.get("routed_engine", "")
            r_id = r["id"]
            conf = float(r.get("conf", r.get("confidence", 0.0)))

            if "morphology" in route:
                color = color_map["fallback"]
                tag = f"#{r_id} [FALLBACK] {conf:.2f}"
            elif "trocr" in route:
                color = color_map["trocr"]
                tag = f"#{r_id} [TrOCR] {conf:.2f}"
            else:
                color = color_map["paddleocr"]
                tag = f"#{r_id} [Printed] {conf:.2f}"

            # Draw rectangle
            draw.rectangle(
                [(bbox[0], bbox[1]), (bbox[2], bbox[3])],
                outline=color,
                width=3,
            )

            # Draw label banner
            label_w = len(tag) * 8 + 6
            label_h = 18
            draw.rectangle(
                [(bbox[0], max(0, bbox[1] - label_h)), (bbox[0] + label_w, bbox[1])],
                fill=color,
            )
            draw.text(
                (bbox[0] + 3, max(0, bbox[1] - label_h) + 2),
                tag,
                fill=(255, 255, 255),
                font=font,
            )

        return annotated

    def _draw_field_matches(
        self,
        base_img: Image.Image,
        field_matches: List[ExtractedFieldMatch],
    ) -> Image.Image:
        """Annotates image with label bounding boxes, value bounding boxes, and connector lines."""
        annotated = base_img.copy().convert("RGB")
        draw = ImageDraw.Draw(annotated)

        try:
            font = ImageFont.truetype("arial.ttf", size=15)
            font_small = ImageFont.truetype("arial.ttf", size=12)
        except Exception:
            font = ImageFont.load_default()
            font_small = ImageFont.load_default()

        # Color scheme
        COLOR_LABEL = (59, 130, 246)    # Blue for Field Labels
        COLOR_VALUE = (16, 185, 129)    # Emerald Green for Extracted Values
        COLOR_LINE = (236, 72, 153)     # Pink/Magenta for spatial connector

        for f in field_matches:
            if not f.value:
                continue

            lbl_box = f.label_bbox
            val_box = f.value_bbox

            # Draw Label Box
            if lbl_box:
                draw.rectangle([(lbl_box[0], lbl_box[1]), (lbl_box[2], lbl_box[3])], outline=COLOR_LABEL, width=3)
                tag_lbl = f"Label: {f.field_name}"
                draw.rectangle([(lbl_box[0], max(0, lbl_box[1] - 20)), (lbl_box[0] + len(tag_lbl) * 9 + 8, lbl_box[1])], fill=COLOR_LABEL)
                draw.text((lbl_box[0] + 4, max(0, lbl_box[1] - 18)), tag_lbl, fill=(255, 255, 255), font=font_small)

            # Draw Value Box
            if val_box:
                draw.rectangle([(val_box[0], val_box[1]), (val_box[2], val_box[3])], outline=COLOR_VALUE, width=3)
                tag_val = f"Value: {f.value}"
                draw.rectangle([(val_box[0], max(0, val_box[1] - 20)), (val_box[0] + len(tag_val) * 9 + 8, val_box[1])], fill=COLOR_VALUE)
                draw.text((val_box[0] + 4, max(0, val_box[1] - 18)), tag_val, fill=(255, 255, 255), font=font_small)

            # Draw connector line from label center to value center
            if lbl_box and val_box and f.match_direction != "inline":
                lbl_center = ((lbl_box[0] + lbl_box[2]) // 2, (lbl_box[1] + lbl_box[3]) // 2)
                val_center = ((val_box[0] + val_box[2]) // 2, (val_box[1] + val_box[3]) // 2)
                draw.line([lbl_center, val_center], fill=COLOR_LINE, width=2)
                mid_x = (lbl_center[0] + val_center[0]) // 2
                mid_y = (lbl_center[1] + val_center[1]) // 2
                dist_str = f"{f.spatial_distance:.0f}px" if f.spatial_distance is not None else ""
                dir_tag = f"{f.match_direction.upper()} ({dist_str})"
                draw.rectangle([(mid_x - 30, mid_y - 10), (mid_x + len(dir_tag) * 6 + 10, mid_y + 10)], fill=(30, 41, 59))
                draw.text((mid_x - 26, mid_y - 8), dir_tag, fill=(244, 114, 182), font=font_small)

        return annotated

    def _generate_markdown_summary(
        self,
        page_num: int,
        paddle_lines: List[str],
        trocr_lines: List[str],
        reconstructed_lines: List[str],
        ordered_blocks: List[Dict[str, Any]],
        comparison_rows: List[Dict[str, Any]],
        total_duration_ms: float,
        field_matches: Optional[List[ExtractedFieldMatch]] = None,
        field_specific_text: Optional[str] = None,
    ) -> str:
        """Generates comprehensive Markdown comparison summary for the page."""
        high_conf = sum(1 for b in ordered_blocks if b.get("confidence_level") == "HIGH")
        med_conf = sum(1 for b in ordered_blocks if b.get("confidence_level") == "MEDIUM")
        low_conf = sum(1 for b in ordered_blocks if b.get("confidence_level") == "LOW")

        trocr_count = sum(1 for b in ordered_blocks if b.get("source") == "trocr")
        paddle_count = sum(1 for b in ordered_blocks if b.get("source") == "paddleocr")
        md = f"""# Stage-by-Stage OCR Evaluation Report — Page {page_num}

**Document Processing Metrics:**
- **Total Pipeline Duration:** `{total_duration_ms:.1f} ms`
- **Total Blocks Extracted:** `{len(ordered_blocks)}`
- **Engine Split:** `{paddle_count}` PaddleOCR (Printed) | `{trocr_count}` TrOCR (Handwritten/Fallbacks)
- **Confidence Distribution:** `{high_conf}` HIGH | `{med_conf}` MEDIUM | `{low_conf}` LOW

---

## 1. Field-Specific Template Extraction (Selected Fields Only)

```text
{field_specific_text if field_specific_text else "No template fields configured"}
```

| Field Name | Extracted Value | Direction | Spatial Distance | Label Text | Label BBox | Value BBox | Source | Conf |
| :--- | :--- | :---: | :---: | :--- | :---: | :---: | :---: | :---: |
"""
        if field_matches:
            for fm in field_matches:
                lbl_box_str = str(fm.label_bbox) if fm.label_bbox else "-"
                val_box_str = str(fm.value_bbox) if fm.value_bbox else "-"
                dist_str = f"{fm.spatial_distance:.0f}px" if fm.spatial_distance is not None else "-"
                md += f"| **{fm.field_name}** | `{fm.value}` | `{fm.match_direction}` | {dist_str} | {fm.label_text or '-'} | `{lbl_box_str}` | `{val_box_str}` | {fm.source or '-'} | {fm.confidence:.2f} |\n"
        else:
            md += "| *No template fields configured* | - | - | - | - | - | - | - | - |\n"

        md += """
---

## 2. Side-by-Side Extracted Text Comparison

| Pure PaddleOCR Output (Stage 5) | Pure TrOCR Output (Stage 6) | Full Spatially Reconstructed (Stage 8) |
| :--- | :--- | :--- |
"""
        max_lines = max(len(paddle_lines), len(trocr_lines), len(reconstructed_lines))
        for i in range(min(max_lines, 40)):
            p = paddle_lines[i] if i < len(paddle_lines) else ""
            t = trocr_lines[i] if i < len(trocr_lines) else ""
            f = reconstructed_lines[i] if i < len(reconstructed_lines) else ""
            p_esc = p.replace("|", "\\|")
            t_esc = t.replace("|", "\\|")
            f_esc = f.replace("|", "\\|")
            md += f"| {p_esc} | {t_esc} | **{f_esc}** |\n"

        if max_lines > 40:
            md += f"| *... and {max_lines - 40} more lines* | *...* | *...* |\n"

        md += """

---

## 3. Block-by-Block Engine Routing & Decision Table

| ID | Bounding Box | Routing Category | PaddleOCR Prediction | TrOCR Prediction | Selected Engine | Final Text | Conf Level |
| :---: | :---: | :--- | :--- | :--- | :---: | :--- | :---: |
"""
        for r in comparison_rows[:50]:
            r_id = r["id"]
            bbox_str = f"[{r['bbox'][0]},{r['bbox'][1]},{r['bbox'][2]},{r['bbox'][3]}]"
            p_txt = r["paddle_text"].replace("|", "\\|")
            t_txt = r["trocr_text"].replace("|", "\\|")
            s_txt = r["selected_text"].replace("|", "\\|")
            s_src = r["selected_source"]
            route = r["route"]
            conf_lvl = "HIGH" if r["selected_conf"] >= 0.85 else ("MED" if r["selected_conf"] >= 0.65 else "LOW")
            md += f"| {r_id} | `{bbox_str}` | {route} | `{p_txt}` | `{t_txt}` | **{s_src}** | `{s_txt}` | `{conf_lvl}` |\n"

        md += "\n---\n*Report auto-generated by Voice ERP OCR Evaluation Tool.*"
        return md

    def _generate_page_html_viewer(
        self,
        page_num: int,
        page_dir: Path,
        json_data: Dict[str, Any],
        comparison_rows: List[Dict[str, Any]],
    ) -> str:
        """Generates interactive visual inspection dashboard HTML for a single page."""
        extracted_fields = json_data.get("extracted_fields", [])
        field_specific_text = json_data.get("field_specific_text", "")

        return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>OCR Stage Evaluation - Page {page_num}</title>
  <style>
    :root {{
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --green: #22c55e;
      --amber: #f59e0b;
      --orange: #f97316;
      --pink: #ec4899;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }}
    body {{ background: var(--bg); color: var(--text); padding: 24px; }}
    .header {{ margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--card-border); }}
    .header h1 {{ font-size: 24px; color: var(--accent); }}
    .header p {{ color: var(--text-muted); font-size: 14px; margin-top: 4px; }}
    .grid-images {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; margin-bottom: 30px; }}
    .card {{ background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 10px; overflow: hidden; }}
    .card-header {{ padding: 12px 16px; background: rgba(0,0,0,0.2); border-bottom: 1px solid var(--card-border); font-weight: 600; font-size: 14px; display: flex; justify-content: space-between; }}
    .card-body {{ padding: 12px; }}
    .card-body img {{ width: 100%; height: auto; border-radius: 6px; border: 1px solid #475569; display: block; }}
    .badge {{ padding: 2px 8px; border-radius: 9999px; font-size: 12px; font-weight: 600; }}
    .badge-green {{ background: rgba(34,197,94,0.2); color: var(--green); }}
    .badge-amber {{ background: rgba(245,158,11,0.2); color: var(--amber); }}
    .badge-orange {{ background: rgba(249,115,22,0.2); color: var(--orange); }}
    .badge-blue {{ background: rgba(56,189,248,0.2); color: var(--accent); }}
    .badge-pink {{ background: rgba(236,72,153,0.2); color: var(--pink); }}
    .text-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; margin-bottom: 30px; }}
    pre.code-box {{ background: #090d16; padding: 12px; border-radius: 6px; font-size: 13px; max-height: 420px; overflow-y: auto; color: #e2e8f0; white-space: pre-wrap; font-family: monospace; border: 1px solid var(--card-border); }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }}
    th, td {{ padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--card-border); }}
    th {{ background: #111827; color: var(--text-muted); font-size: 12px; text-transform: uppercase; }}
    tr:hover {{ background: rgba(255,255,255,0.02); }}
  </style>
</head>
<body>

  <div class="header">
    <h1>Document OCR Stage Evaluation &mdash; Page {page_num}</h1>
    <p>Field-Specific Form Extraction &amp; Visual Verification. Total inference time: <strong>{json_data.get('total_page_duration_ms', 0)} ms</strong></p>
  </div>

  <h2 style="font-size: 18px; margin-bottom: 14px; color: var(--accent);">Visual Pipeline Stages &amp; Field Matching</h2>
  <div class="grid-images">
    <div class="card">
      <div class="card-header">
        <span>Stage 1: Original PDF Page</span>
        <span class="badge badge-blue">Raw Render</span>
      </div>
      <div class="card-body">
        <a href="01_original_page.png" target="_blank"><img src="01_original_page.png" alt="Original Page"></a>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span>Stage 3: Detected Regions</span>
        <span class="badge badge-orange">PaddleOCR + Fallbacks</span>
      </div>
      <div class="card-body">
        <a href="03_detected_regions.png" target="_blank"><img src="03_detected_regions.png" alt="Detected Regions"></a>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span>Stage 8: Field-to-Value Matching</span>
        <span class="badge badge-pink">Spatial Proximity</span>
      </div>
      <div class="card-body">
        <a href="08_field_matching_visualization.png" target="_blank"><img src="08_field_matching_visualization.png" alt="Field Matching Visual"></a>
      </div>
    </div>
  </div>

  <h2 style="font-size: 18px; margin-bottom: 14px; color: var(--green);">Field-Specific Extracted Output (Selected Template Fields)</h2>
  <div class="card" style="margin-bottom: 30px;">
    <div class="card-body">
      <pre class="code-box" style="color: #38bdf8; font-size: 14px; font-weight: bold; background: #020617;">{field_specific_text if field_specific_text else "No field-specific text"}</pre>
    </div>
  </div>

  <h2 style="font-size: 18px; margin-bottom: 14px; color: var(--accent);">Field-to-Value Matches &amp; Bounding Boxes (Debug Audit)</h2>
  <div class="card" style="margin-bottom: 30px;">
    <div class="card-body" style="overflow-x: auto;">
      <table>
        <thead>
          <tr>
            <th>Field Name</th>
            <th>Extracted Value</th>
            <th>Direction</th>
            <th>Spatial Distance</th>
            <th>Label Text</th>
            <th>Label Bounding Box</th>
            <th>Value Bounding Box</th>
            <th>Source</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {''.join([
            f'''<tr>
              <td><strong>{f.get('field_name')}</strong></td>
              <td><span style="color: #22c55e; font-weight: bold;">{f.get('value') or '-'}</span></td>
              <td><span class="badge {'badge-pink' if f.get('match_direction') == 'below' else ('badge-blue' if f.get('match_direction') == 'right' else 'badge-green')}">{f.get('match_direction', '-').upper()}</span></td>
              <td>{f"{f.get('spatial_distance'):.0f} px" if f.get('spatial_distance') is not None else "-"}</td>
              <td>{f.get('label_text') or '-'}</td>
              <td><code>{str(f.get('label_bbox') or '-')}</code></td>
              <td><code>{str(f.get('value_bbox') or '-')}</code></td>
              <td>{f.get('source') or '-'}</td>
              <td>{(f.get('confidence') or 0):.2f}</td>
            </tr>''' for f in extracted_fields
          ])}
        </tbody>
      </table>
    </div>
  </div>

  <h2 style="font-size: 18px; margin-bottom: 14px; color: var(--accent);">Stage-by-Stage Text Outputs</h2>
  <div class="text-grid">
    <div class="card">
      <div class="card-header">
        <span>Stage 5: PaddleOCR Output</span>
        <span class="badge badge-green">Printed Engine</span>
      </div>
      <div class="card-body">
        <pre class="code-box" id="paddle-text"></pre>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span>Stage 6: TrOCR Output</span>
        <span class="badge badge-amber">Handwriting Engine</span>
      </div>
      <div class="card-body">
        <pre class="code-box" id="trocr-text"></pre>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span>Stage 8: Full Document Text</span>
        <span class="badge badge-blue">Hybrid &amp; Validated</span>
      </div>
      <div class="card-body">
        <pre class="code-box">{json_data.get('raw_text', '')}</pre>
      </div>
    </div>
  </div>

  <h2 style="font-size: 18px; margin-bottom: 14px; color: var(--accent);">Block-by-Block Comparison &amp; Routing Decisions</h2>
  <div class="card" style="margin-bottom: 30px;">
    <div class="card-body" style="overflow-x: auto;">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Crop</th>
            <th>Routing Logic</th>
            <th>PaddleOCR Text</th>
            <th>TrOCR Text</th>
            <th>Selected Source</th>
            <th>Final Extracted Text</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {''.join([
            f'''<tr>
              <td>#{r['id']}</td>
              <td><a href="04_crops/crop_{r['id']:03d}.png" target="_blank"><img src="04_crops/crop_{r['id']:03d}.png" style="max-height: 28px; max-width: 120px; border-radius: 3px;" alt="crop"></a></td>
              <td><span class="badge {'badge-green' if 'printed' in r['route'] else 'badge-orange'}">{r['route']}</span></td>
              <td>{r['paddle_text']}</td>
              <td>{r['trocr_text']}</td>
              <td><strong>{r['selected_source']}</strong></td>
              <td>{r['selected_text']}</td>
              <td>{r['selected_conf']:.2f}</td>
            </tr>''' for r in comparison_rows
          ])}
        </tbody>
      </table>
    </div>
  </div>

  <script>
    fetch('05_paddleocr_full_document.txt').then(r => r.text()).then(t => document.getElementById('paddle-text').innerText = t);
    fetch('06_trocr_full_document.txt').then(r => r.text()).then(t => document.getElementById('trocr-text').innerText = t);
  </script>
</body>
</html>
"""

    def _generate_master_html_report(self, page_summaries: List[Dict[str, Any]]) -> str:
        """Generates master navigation index HTML dashboard."""
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>OCR Evaluation Master Dashboard</title>
  <style>
    :root {{
      --bg: #0b1120;
      --card: #1e293b;
      --border: #334155;
      --accent: #38bdf8;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, sans-serif; }}
    body {{ background: var(--bg); color: var(--text); padding: 32px; max-width: 1200px; margin: 0 auto; }}
    .header {{ margin-bottom: 30px; border-bottom: 1px solid var(--border); padding-bottom: 20px; }}
    .header h1 {{ font-size: 28px; color: var(--accent); }}
    .header p {{ color: var(--text-muted); margin-top: 6px; }}
    .pages-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 24px; }}
    .page-card {{ background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; transition: transform 0.2s; }}
    .page-card:hover {{ transform: translateY(-4px); border-color: var(--accent); }}
    .page-img-preview {{ width: 100%; height: 200px; object-fit: cover; object-position: top; background: #000; }}
    .page-info {{ padding: 18px; }}
    .page-info h3 {{ font-size: 18px; margin-bottom: 8px; }}
    .page-info p {{ font-size: 13px; color: var(--text-muted); margin-bottom: 14px; line-height: 1.5; }}
    .btn {{ display: inline-block; padding: 8px 16px; background: var(--accent); color: #000; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px; }}
  </style>
</head>
<body>

  <div class="header">
    <h1>OCR Pipeline Evaluation &amp; Diagnostics Dashboard</h1>
    <p>PDF: <strong>{self.pdf_path.name}</strong> | Processed Pages: <strong>{len(page_summaries)}</strong> | Device: <strong>{self.ocr_engine.device_name if self.ocr_engine else 'auto'}</strong></p>
  </div>

  <div class="pages-grid">
    {''.join([
      f'''<div class="page-card">
        <a href="{p['page_dir']}/index.html"><img class="page-img-preview" src="{p['page_dir']}/08_field_matching_visualization.png" onerror="this.src='{p['page_dir']}/03_detected_regions.png'" alt="Page {p['page']}"></a>
        <div class="page-info">
          <h3>Page {p['page']} Evaluation</h3>
          <p><strong>{p['lines_extracted']}</strong> fields/lines &bull; <strong>{p['blocks_count']}</strong> blocks &bull; {p['duration_ms']:.0f} ms</p>
          <p style="font-style: italic; color: #cbd5e1; white-space: pre-line;">"{p['final_text_preview'][:120]}..."</p>
          <a class="btn" href="{p['page_dir']}/index.html">Inspect Stage Artifacts &rarr;</a>
        </div>
      </div>''' for p in page_summaries
    ])}
  </div>

</body>
</html>
"""


def main():
    args = parse_args()
    pdf_file = Path(args.pdf_path)

    # Handle relative path resolution
    if not pdf_file.is_absolute():
        if (Path.cwd() / pdf_file).exists():
            pdf_file = Path.cwd() / pdf_file
        elif (SCRIPT_DIR.parent / pdf_file).exists():
            pdf_file = SCRIPT_DIR.parent / pdf_file

    out_dir = Path(args.output_dir)
    if not out_dir.is_absolute():
        out_dir = Path.cwd() / out_dir

    custom_cfg = None
    if args.config_json and Path(args.config_json).exists():
        with open(args.config_json, "r", encoding="utf-8") as f:
            cfg_dict = json.load(f)
            custom_cfg = OcrConfigModel(**cfg_dict)

    target_fields = args.template_fields
    if args.template_json and Path(args.template_json).exists():
        with open(args.template_json, "r", encoding="utf-8") as f:
            target_fields = json.load(f)

    evaluator = StageEvaluator(
        pdf_path=pdf_file,
        output_dir=out_dir,
        num_examples=args.num_examples,
        dpi=args.dpi,
        device=args.device,
        save_variants=args.save_variants,
        config=custom_cfg,
        template_fields=target_fields,
    )

    evaluator.run()


if __name__ == "__main__":
    main()
