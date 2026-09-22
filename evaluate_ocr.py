#!/usr/bin/env python3
"""
Root launcher for OCR Pipeline Evaluation Script
================================================
Passes all arguments through to backend/evaluate_ocr.py.
"""
import sys
import runpy
from pathlib import Path

backend_script = Path(__file__).resolve().parent / "backend" / "evaluate_ocr.py"

if __name__ == "__main__":
    runpy.run_path(str(backend_script), run_name="__main__")

