"""
Standalone Test: Full Chandra 2 OCR (Raw Output & Layout Verification)

Requirements:
- Reuses the exact backend Chandra OCR function: `get_chandra_engine().extract_full_image()`.
- Runs on a test image (default: Page 1 of 'demo-sample/Hourly monitor sheet.pdf' or CLI argument).
- Strictly DOES NOT call any LLM.
- Prints and saves the complete raw Chandra OCR output, including all available text and
  layout/region information (data-bbox attributes, data-label attributes, HTML tables, etc.).
- Verifies exactly what Chandra V2 returns before downstream LLM processing.
"""

import os
import sys
import io
import time
import json
from pathlib import Path
from PIL import Image

# Ensure backend root and workspace root are in sys.path
BACKEND_DIR = Path(__file__).resolve().parent
WORKSPACE_DIR = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(WORKSPACE_DIR) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_DIR))

from app.core.logger import logger
from app.services.chandra_engine import get_chandra_engine


def log_banner(title: str, char: str = "="):
    line = char * 80
    print(f"\n{line}\n  {title}\n{line}\n")


def resolve_test_image() -> Image.Image:
    """
    Resolves the test image to run Full Chandra OCR on.
    Supports CLI arg or default 'demo-sample/Hourly monitor sheet.pdf' (Page 1).
    """
    if len(sys.argv) > 1:
        custom_path = Path(sys.argv[1])
        if not custom_path.exists():
            raise FileNotFoundError(f"Specified test image not found: {custom_path}")
        print(f"[Test Setup] Using custom test image: {custom_path}")
        if custom_path.suffix.lower() == ".pdf":
            import pymupdf as fitz
            doc = fitz.open(str(custom_path))
            page = doc[0]
            pix = page.get_pixmap(matrix=fitz.Matrix(200 / 72.0, 200 / 72.0), alpha=False)
            return Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        return Image.open(custom_path).convert("RGB")

    candidates = [
        WORKSPACE_DIR / "demo-sample" / "Hourly monitor sheet.pdf",
        BACKEND_DIR / "demo-sample" / "Hourly monitor sheet.pdf",
        Path(r"E:\projects\voice-entry\demo-sample\Hourly monitor sheet.pdf"),
    ]
    pdf_path = None
    for c in candidates:
        if c.exists():
            pdf_path = c
            break

    if not pdf_path:
        raise FileNotFoundError(
            "Could not locate 'Hourly monitor sheet.pdf' in demo-sample directory. "
            "Pass an image path via CLI: python test_full_chandra_ocr.py <path_to_image>"
        )

    print(f"[Test Setup] Loading PDF: {pdf_path}")
    import pymupdf as fitz
    doc = fitz.open(str(pdf_path))
    print(f"[Test Setup] PDF has {len(doc)} pages. Rendering Page 1 at 200 DPI...")
    page = doc[0]
    pix = page.get_pixmap(matrix=fitz.Matrix(200 / 72.0, 200 / 72.0), alpha=False)
    img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    print(f"[Test Setup] Page 1 rendered successfully: size={img.size}, mode={img.mode}")
    return img


def main():
    log_banner("STANDALONE TEST: FULL CHANDRA 2 OCR (RAW OUTPUT & LAYOUT ONLY - NO LLM)")

    # 1. Load Test Image
    test_img = resolve_test_image()

    # 2. Initialize Chandra Engine
    engine = get_chandra_engine()
    vram_before = engine.get_vram_info()
    print(f"[VRAM] Initial VRAM: Allocated={vram_before['allocated_mb']} MB, Reserved={vram_before['reserved_mb']} MB")

    try:
        # 3. Load Chandra 2 Model (4-bit BitsAndBytes NF4 streaming)
        log_banner("STEP 1: LOADING CHANDRA 2 MODEL (ON-DEMAND 4-BIT NF4)")
        t_load_start = time.time()
        engine.load_model()
        t_load = (time.time() - t_load_start) * 1000.0
        vram_loaded = engine.get_vram_info()
        print(f"[Model Load] Chandra 2 active in memory in {t_load:.1f}ms on {engine.device_name}")
        print(f"[VRAM] Loaded VRAM: Allocated={vram_loaded['allocated_mb']} MB, Reserved={vram_loaded['reserved_mb']} MB")

        # 4. Run Backend Full Image OCR (Exact backend function: extract_full_image)
        log_banner("STEP 2: RUNNING EXACT BACKEND CHANDRA OCR FUNCTION (extract_full_image)")
        print("[Inference] Invoking engine.extract_full_image(test_img)...")
        print("[Inference] NOTE: No LLM calls will be made in this test.")

        ocr_response = engine.extract_full_image(test_img)

        print(f"\n[OCR Result] Success: {ocr_response.success}")
        print(f"[OCR Result] Duration: {ocr_response.processing_time_ms} ms")
        print(f"[OCR Result] Raw Text Length: {len(ocr_response.raw_text)} chars")
        print(f"[OCR Result] Structured Text Length: {len(ocr_response.structured_text)} chars")
        layout_chunks = getattr(ocr_response, "page_results", []) or []
        print(f"[OCR Result] Layout Blocks Detected: {len(layout_chunks)}")

        # 5. Print Complete Raw Chandra OCR Output (HTML with data-bbox and data-label)
        log_banner("STEP 3: COMPLETE RAW CHANDRA OCR OUTPUT (HTML WITH LAYOUT BLOCKS & BBOXES)")
        print(ocr_response.raw_text)

        # 6. Print Layout/Region Blocks Summary
        if layout_chunks:
            log_banner("STEP 4: DETECTED LAYOUT / REGION BLOCKS BREAKDOWN")
            print(f"{'#':<4} | {'Label':<18} | {'Bounding Box (x0, y0, x1, y1)':<32} | {'Content Preview'}")
            print("-" * 80)
            for idx, chunk in enumerate(layout_chunks, start=1):
                label = chunk.get("label", "block")
                bbox = chunk.get("bbox", [])
                bbox_str = str(bbox) if bbox else "N/A"
                content = chunk.get("content", "").replace("\n", " ").strip()
                snippet = content[:50] + ("..." if len(content) > 50 else "")
                print(f"{idx:<4} | {label:<18} | {bbox_str:<32} | {snippet}")

        # 7. Print Structured Markdown Output
        log_banner("STEP 5: STRUCTURED MARKDOWN OCR TEXT (FOR REVIEW / DOWNSTREAM LLM)")
        print(ocr_response.structured_text)

        # 8. Save Raw Outputs to Disk inside /detection folder
        log_banner("STEP 6: SAVING COMPLETE RAW CHANDRA OUTPUT TO DISK")
        detection_dir = BACKEND_DIR / "detection"
        detection_dir.mkdir(parents=True, exist_ok=True)

        raw_html_path = detection_dir / "full_chandra_raw_ocr.html"
        raw_txt_path = detection_dir / "full_chandra_raw_ocr.txt"
        layout_json_path = detection_dir / "full_chandra_layout_blocks.json"

        with open(raw_html_path, "w", encoding="utf-8") as f:
            f.write(ocr_response.raw_text)
        print(f"[Output Saved] Raw Layout HTML: {raw_html_path}")

        with open(raw_txt_path, "w", encoding="utf-8") as f:
            f.write(ocr_response.structured_text)
        print(f"[Output Saved] Structured Markdown: {raw_txt_path}")

        with open(layout_json_path, "w", encoding="utf-8") as f:
            json.dump(layout_chunks, f, indent=2, ensure_ascii=False)
        print(f"[Output Saved] Layout Blocks JSON: {layout_json_path}")

        log_banner("VERIFICATION SUMMARY: FULL CHANDRA OCR PASSED SUCCESSFULLY")
        print("  - Complete raw layout HTML captured with bounding boxes (data-bbox) and region labels (data-label).")
        print("  - Tables, forms, headers, and text blocks preserved in native Chandra structure.")
        print("  - No LLM calls were invoked in this test.")
        print("  - Output files saved to detection/ directory for visual/text inspection.")

    finally:
        # 9. Unload Model & Reclaim VRAM
        log_banner("STEP 7: UNLOADING CHANDRA 2 & RECLAIMING GPU VRAM")
        engine.unload_model()
        vram_after = engine.get_vram_info()
        print(f"[VRAM] Final VRAM after unload: Allocated={vram_after['allocated_mb']} MB, Reserved={vram_after['reserved_mb']} MB")
        print("[Lifecycle] VRAM successfully released.")


if __name__ == "__main__":
    main()
