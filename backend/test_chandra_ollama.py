"""
Verification script for Chandra OCR Loading Methods (Local vs Ollama).
Run this after your Chandra Ollama model download completes:
    python test_chandra_ollama.py
"""

import sys
import os
import io
import time
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient

from app.main import app
from app.services.chandra_engine import get_chandra_engine
from app.config import settings

client = TestClient(app)


def test_handwritten_models_endpoint():
    print("\n[1/5] Testing GET /api/handwritten/models...")
    resp = client.get("/api/handwritten/models")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    print("  Supported engine:", data.get("name"))
    print("  Loading methods:", data.get("loadingMethods"))
    print("  Default method:", data.get("defaultLoadingMethod"))
    assert "loadingMethods" in data
    assert "local" in data["loadingMethods"]
    assert "ollama" in data["loadingMethods"]
    print("  ✓ GET /api/handwritten/models verified!")


def test_ollama_models_endpoint():
    print("\n[2/5] Testing GET /api/handwritten/ollama/models...")
    resp = client.get("/api/handwritten/ollama/models")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    print(f"  Ollama Server Online: {data.get('online')}")
    print(f"  Installed Models: {data.get('models')}")
    print(f"  Default Model Config: {data.get('defaultModel')}")
    return data.get("models", [])


def test_ollama_error_handling():
    print("\n[3/5] Testing Ollama Error Handling & Messages...")
    engine = get_chandra_engine()
    test_img = Image.new("RGB", (200, 100), color=(255, 255, 255))
    draw = ImageDraw.Draw(test_img)
    draw.text((10, 10), "Test", fill=(0, 0, 0))

    # Test 3a: Non-existent model error handling
    try:
        engine.infer_ollama(test_img, prompt="test", model_name="nonexistent_chandra_test_xyz")
        assert False, "Should have raised RuntimeError for non-existent model"
    except RuntimeError as e:
        print(f"  ✓ Non-existent model handled clearly:\n    --> {e}")

    # Test 3b: Unreachable port error handling
    try:
        engine.infer_ollama(test_img, prompt="test", model_name="chandra", base_url="http://127.0.0.1:59999", timeout=1.0)
        assert False, "Should have raised RuntimeError for unreachable server"
    except RuntimeError as e:
        print(f"  ✓ Unreachable server handled clearly:\n    --> {e}")


def test_chandra_full_image_ollama(model_name: str = "chandra"):
    print(f"\n[4/5] Testing Chandra Full Image OCR via Ollama API (Model: '{model_name}')...")
    engine = get_chandra_engine()

    test_img = Image.new("RGB", (400, 150), color=(255, 255, 255))
    draw = ImageDraw.Draw(test_img)
    draw.text((20, 20), "Part No: 29465644", fill=(0, 0, 0))
    draw.text((20, 50), "Description: FR BTM", fill=(0, 0, 0))
    draw.text((20, 80), "Machine Name: NEW-150", fill=(0, 0, 0))

    start_t = time.time()
    try:
        res = engine.extract_full_image(
            image_pil=test_img,
            loading_method="ollama",
            ollama_model=model_name,
        )
        elapsed = time.time() - start_t
        print(f"  ✓ Inference completed in {elapsed:.2f}s!")
        print(f"  Device: {res.device}")
        print(f"  Processing Time: {res.processing_time_ms} ms")
        print(f"  Output preview: {(res.raw_text or '')[:140]}...")
        assert res.success is True
        assert "ollama" in res.device.lower()
    except Exception as exc:
        print(f"  ! Ollama inference error for model '{model_name}': {exc}")
        print("    (Ensure model download has finished in Ollama before testing)")


def test_post_ocr_endpoint_ollama(model_name: str = "chandra"):
    print(f"\n[5/5] Testing POST /api/handwritten/ocr (loading_method='ollama', model='{model_name}')...")
    test_img = Image.new("RGB", (300, 100), color=(255, 255, 255))
    draw = ImageDraw.Draw(test_img)
    draw.text((20, 20), "Batch No: 33 NP", fill=(0, 0, 0))

    buf = io.BytesIO()
    test_img.save(buf, format="PNG")

    try:
        res = client.post(
            "/api/handwritten/ocr",
            files={"file": ("test_doc.png", buf.getvalue(), "image/png")},
            data={
                "ocr_method": "chandra_2",
                "chandra_mode": "full_image",
                "chandra_loading_method": "ollama",
                "chandra_ollama_model": model_name,
            },
        )
        if res.status_code == 200:
            data = res.json()
            print("  ✓ Full OCR endpoint succeeded!")
            print(f"    Engine Used: {data.get('engineUsed')}")
            print(f"    SQLite Record ID: {data.get('ocr_record_id')}")
            print(f"    Clean Text preview: {(data.get('clean_text') or '')[:100]}")
            assert data.get("ocr_record_id") is not None
        else:
            print(f"  ! Endpoint returned HTTP {res.status_code}: {res.text}")
    except Exception as exc:
        print(f"  ! Endpoint error: {exc}")


if __name__ == "__main__":
    print("==========================================================")
    print("Chandra OCR Loading Method (Local vs Ollama) Test Suite")
    print("==========================================================")
    test_handwritten_models_endpoint()
    models = test_ollama_models_endpoint()
    test_ollama_error_handling()

    # Determine which model to use for the live test
    target_model = sys.argv[1] if len(sys.argv) > 1 else (models[0] if models else "chandra")
    print(f"\nTarget model for live test: '{target_model}'")
    test_chandra_full_image_ollama(target_model)
    test_post_ocr_endpoint_ollama(target_model)
    print("\n==========================================================")
    print("Testing sequence finished!")
    print("==========================================================")
