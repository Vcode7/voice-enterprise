"""
Test Full Image OCR flow directly through the FastAPI endpoint /ocr/handwriting
using TestClient and HTTP requests to verify the complete non-blocking pipeline.
"""

import sys
import io
import time
import json
from pathlib import Path
from PIL import Image

BACKEND_DIR = Path(__file__).resolve().parent
WORKSPACE_DIR = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(WORKSPACE_DIR) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_DIR))

from fastapi.testclient import TestClient
from app.main import app
from app.core.logger import logger


def main():
    print("\n" + "=" * 80)
    print("  TESTING FASTAPI /ocr/handwriting ENDPOINT (CHANDRA 2 FULL IMAGE)")
    print("=" * 80 + "\n")

    # Load demo PDF Page 1 as PNG bytes
    pdf_path = WORKSPACE_DIR / "demo-sample" / "Hourly monitor sheet.pdf"
    if not pdf_path.exists():
        pdf_path = BACKEND_DIR / "demo-sample" / "Hourly monitor sheet.pdf"

    print(f"[1] Loading PDF from {pdf_path}...")
    import pymupdf as fitz
    doc = fitz.open(str(pdf_path))
    page = doc[0]
    pix = page.get_pixmap(matrix=fitz.Matrix(200 / 72.0, 200 / 72.0), alpha=False)
    img_bytes = pix.tobytes("png")
    print(f"[1] Rendered Page 1: {len(img_bytes)} bytes")

    # Initialize FastAPI TestClient
    print("[2] Creating TestClient for FastAPI app...")
    client = TestClient(app)

    # Send POST request to /ocr/handwriting
    print("[3] Sending POST /ocr/handwriting (ocr_method='chandra_2', chandra_mode='full_image')...")
    start_t = time.time()
    response = client.post(
        "/ocr/handwriting",
        files={"file": ("hourly_sheet_page_1.png", img_bytes, "image/png")},
        data={
            "ocr_method": "chandra_2",
            "chandra_mode": "full_image",
        },
    )
    elapsed_s = time.time() - start_t
    print(f"[4] Response received in {elapsed_s:.2f}s | HTTP Status: {response.status_code}")

    if response.status_code != 200:
        print(f"[ERROR] Endpoint returned status {response.status_code}:")
        print(response.text)
        sys.exit(1)

    data = response.json()
    print("\n" + "=" * 80)
    print("  RESPONSE SUMMARY")
    print("=" * 80)
    print(f"Success: {data.get('success')}")
    print(f"Processing Time: {data.get('processing_time_ms')} ms")
    print(f"Device: {data.get('device')}")
    print(f"Raw Text Length: {len(data.get('raw_text', ''))} chars")
    print(f"Structured Text Length: {len(data.get('structured_text', ''))} chars")
    layout_blocks = data.get("page_results", [])
    print(f"Layout Blocks: {len(layout_blocks)}")
    print("-" * 80)
    print("STRUCTURED TEXT PREVIEW:")
    print(data.get("structured_text", "")[:600] + "...")
    print("=" * 80)
    print("\n>>> FASTAPI FULL IMAGE ENDPOINT TEST PASSED SUCCESSFULLY <<<\n")


if __name__ == "__main__":
    main()
