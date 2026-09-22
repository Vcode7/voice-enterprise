#!/usr/bin/env python3
"""
Launcher for Streamlit TrOCR Training Studio
===========================================
Usage:
    python run_training_ui.py
"""

import sys
import subprocess
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
APP_SCRIPT = ROOT_DIR / "trocr_training_app.py"


def main():
    print("=" * 70)
    print("  STARTING TrOCR TRAINING STUDIO (Streamlit)")
    print(f"  App Script: {APP_SCRIPT}")
    print("=" * 70)

    cmd = [
        sys.executable,
        "-m",
        "streamlit",
        "run",
        str(APP_SCRIPT),
        "--server.headless=false",
        "--server.port=8501",
        "--theme.base=dark",
    ]

    try:
        subprocess.run(cmd, check=True)
    except KeyboardInterrupt:
        print("\nTrOCR Training Studio stopped.")
    except Exception as e:
        print(f"Error launching Streamlit app: {str(e)}")


if __name__ == "__main__":
    main()
