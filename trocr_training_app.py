#!/usr/bin/env python3
"""
TrOCR Training & Fine-Tuning Studio (Streamlit)
==============================================
A lightweight, high-performance UI for:
1. Uploading images or multi-page PDF documents (processes ALL pages or selected page)
2. Instantaneous Zero-Lag Caching:
   - PDF rendering is cached with @st.cache_data (never re-renders on keystrokes/clicks)
   - Extractions & TrOCR predictions persist to disk cache (loads in <0.01s on reloads!)
3. Segmenting text regions with proper generous padding
4. Predicting initial text with ONLY TrOCR
5. Filtering by Numeric / Number fields vs. Text fields
6. Manually reviewing and correcting predictions
7. Auto-selecting ONLY samples where the user makes changes
8. Top-anchored Save Action Bar for instant saving without scrolling
9. Pagination for handling hundreds of multi-page crops smoothly
10. Fine-tuning TrOCR with VRAM optimizations (Frozen ViT encoder, gradient accumulation, gradient checkpointing)
11. Saving versioned checkpoints and incrementally retraining from latest weights
"""

import os
import sys
import io
import re
import time
import json
import hashlib
import pickle
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
from PIL import Image, ImageDraw, ImageFont
import numpy as np
import cv2

# Set backend path
ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Ensure torch is loaded before streamlit components
import torch
import streamlit as st

try:
    import pymupdf as fitz
except ImportError:
    import fitz

from app.config import settings
from app.core.logger import logger
from app.services.pdf_processor import PdfProcessor
from app.services.image_preprocessor import ImagePreprocessor
from app.services.ocr_engine import get_ocr_engine, OcrEngine
from app.services.trocr_trainer import TrOCRDatasetManager, TrOCRFineTuner


# Cache directory for persistent document extractions
DOC_CACHE_DIR = BACKEND_DIR / "cache" / "trocr_extractions"
DOC_CACHE_DIR.mkdir(parents=True, exist_ok=True)


# Set Streamlit Page Configuration
st.set_page_config(
    page_title="TrOCR Training Studio",
    page_icon="✍️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Custom CSS for clean UI styling
st.markdown("""
<style>
    .main-header {
        font-size: 2.2rem;
        font-weight: 700;
        color: #38bdf8;
        margin-bottom: 0.2rem;
    }
    .sub-header {
        font-size: 1.0rem;
        color: #94a3b8;
        margin-bottom: 1.2rem;
    }
    .cache-badge {
        background: rgba(56, 189, 248, 0.15);
        border: 1px solid #38bdf8;
        border-radius: 8px;
        padding: 10px 16px;
        margin-bottom: 12px;
        color: #e2e8f0;
    }
    .save-banner {
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 2px solid #38bdf8;
        border-radius: 10px;
        padding: 16px 20px;
        margin-bottom: 20px;
    }
    .metric-card {
        background-color: #1e293b;
        border: 1px solid #334155;
        border-radius: 8px;
        padding: 14px;
        text-align: center;
    }
    .crop-card {
        background-color: #1e293b;
        border: 1px solid #334155;
        border-radius: 8px;
        padding: 14px;
        margin-bottom: 14px;
    }
    .crop-card-modified {
        background-color: #0d2818;
        border: 2px solid #22c55e;
        border-radius: 8px;
        padding: 14px;
        margin-bottom: 14px;
    }
    .badge-modified {
        background-color: rgba(34, 197, 94, 0.25);
        color: #22c55e;
        padding: 3px 8px;
        border-radius: 6px;
        font-size: 0.8rem;
        font-weight: 700;
        border: 1px solid #22c55e;
    }
    .badge-number {
        background-color: rgba(56, 189, 248, 0.2);
        color: #38bdf8;
        padding: 3px 8px;
        border-radius: 6px;
        font-size: 0.8rem;
        font-weight: 600;
        border: 1px solid #38bdf8;
    }
    .badge-unchanged {
        background-color: rgba(148, 163, 184, 0.15);
        color: #94a3b8;
        padding: 3px 8px;
        border-radius: 6px;
        font-size: 0.8rem;
    }
    .stButton>button {
        border-radius: 6px;
        font-weight: 600;
    }
</style>
""", unsafe_allow_html=True)


# =============================================================================
# PERSISTENT & IN-MEMORY CACHE HELPERS
# =============================================================================
@st.cache_data(show_spinner=False, max_entries=5)
def get_cached_pdf_images(file_bytes: bytes, dpi: int = 200, max_pages: int = 50) -> List[Image.Image]:
    """Caches rendered PDF pages in memory to avoid redundant 10s rasterization on every rerun."""
    return PdfProcessor.convert_pdf_bytes_to_images(file_bytes, dpi=dpi, max_pages=max_pages)


def rotate_pil_image(image: Image.Image, degrees: int) -> Image.Image:
    """Rotates a PIL image clockwise by 0, 90, 180, or 270 degrees."""
    degrees = degrees % 360
    if degrees == 90:
        return image.transpose(Image.ROTATE_270)
    elif degrees == 180:
        return image.transpose(Image.ROTATE_180)
    elif degrees == 270:
        return image.transpose(Image.ROTATE_90)
    return image


def compute_doc_cache_key(
    file_bytes: bytes,
    padding_px: int,
    page_spec: str,
    model_id: str = "latest",
    rotation_spec: str = "0",
) -> str:
    """Computes a SHA256 deterministic hash for the uploaded file, settings, prediction model, and rotation."""
    hasher = hashlib.sha256()
    hasher.update(file_bytes)
    hasher.update(f"|pad:{padding_px}|page:{page_spec}|model:{model_id}|rot:{rotation_spec}".encode("utf-8"))
    return hasher.hexdigest()[:20]


def save_extraction_to_cache(cache_key: str, doc_name: str, pages_map: Dict[int, Image.Image], crops_data: List[Dict[str, Any]]):
    """Saves extracted regions and TrOCR predictions to disk cache."""
    try:
        cache_file = DOC_CACHE_DIR / f"{cache_key}.pkl"
        payload = {
            "doc_name": doc_name,
            "pages_map": pages_map,
            "crops_data": crops_data,
            "cached_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        with open(cache_file, "wb") as f:
            pickle.dump(payload, f)
        logger.info(f"Saved extraction cache for '{doc_name}' (Key: {cache_key})")
    except Exception as e:
        logger.warning(f"Failed to save extraction cache: {str(e)}")


def load_extraction_from_cache(cache_key: str) -> Optional[Dict[str, Any]]:
    """Loads cached extraction from disk if available."""
    cache_file = DOC_CACHE_DIR / f"{cache_key}.pkl"
    if cache_file.exists():
        try:
            with open(cache_file, "rb") as f:
                payload = pickle.load(f)
            logger.info(f"Loaded extraction cache for '{payload.get('doc_name')}' (Key: {cache_key})")
            return payload
        except Exception as e:
            logger.warning(f"Failed to load extraction cache: {str(e)}")
    return None


def clear_all_extraction_caches() -> int:
    """Clears all cached document extractions."""
    count = 0
    if DOC_CACHE_DIR.exists():
        for f in DOC_CACHE_DIR.glob("*.pkl"):
            try:
                f.unlink()
                count += 1
            except Exception:
                pass
    return count


@st.cache_resource(show_spinner="Initializing TrOCR and PaddleOCR detection engine...")
def load_ocr_components():
    """Initializes and caches OCR engine and Training services."""
    engine = get_ocr_engine()
    dataset_mgr = TrOCRDatasetManager()
    fine_tuner = TrOCRFineTuner(dataset_manager=dataset_mgr)
    return engine, dataset_mgr, fine_tuner


def is_numeric_candidate(text: str) -> bool:
    """Returns True if text contains digits, counters, or numerical measurements."""
    if not text:
        return False
    return any(c.isdigit() for c in text)


def draw_annotated_regions(image: Image.Image, crops_data: List[Dict[str, Any]]) -> Image.Image:
    """Draws numbered bounding box annotations over the document image."""
    annotated = image.copy().convert("RGB")
    draw = ImageDraw.Draw(annotated)

    try:
        font = ImageFont.truetype("arial.ttf", size=15)
    except Exception:
        font = ImageFont.load_default()

    for c in crops_data:
        bbox = c["bbox"]
        cid = c["id"]
        # Draw bounding box
        draw.rectangle([(bbox[0], bbox[1]), (bbox[2], bbox[3])], outline=(56, 189, 248), width=3)
        # Draw numbered tag
        tag = f"#{cid}"
        tag_w = len(tag) * 9 + 8
        tag_h = 20
        draw.rectangle([(bbox[0], max(0, bbox[1] - tag_h)), (bbox[0] + tag_w, bbox[1])], fill=(56, 189, 248))
        draw.text((bbox[0] + 3, max(0, bbox[1] - tag_h) + 2), tag, fill=(0, 0, 0), font=font)

    return annotated


def extract_crops_and_predict(
    image: Image.Image,
    ocr_engine: OcrEngine,
    fine_tuner: TrOCRFineTuner,
    padding_px: int = 14,
    page_num: int = 1,
    start_id: int = 1,
    model_choice: str = "latest",
) -> List[Dict[str, Any]]:
    """
    Extracts text regions using PaddleOCR detection with generous padding and predicts text using the selected TrOCR model.
    """
    img_np = np.array(image.convert("RGB"))
    height, width, _ = img_np.shape

    # 1. Run PaddleOCR solely to detect bounding polygons
    paddle_results = None
    try:
        paddle_results = ocr_engine._paddle_ocr.ocr(img_np, cls=False)
    except Exception as e:
        logger.warning(f"PaddleOCR detection failed on Page {page_num}: {str(e)}")

    crops_data: List[Dict[str, Any]] = []
    seen_bboxes = []

    if paddle_results and len(paddle_results) > 0 and paddle_results[0] is not None:
        for idx, item in enumerate(paddle_results[0], start=1):
            poly, _ = item
            bbox = ocr_engine._polygon_to_bbox(poly)

            # Filter tiny noise
            bw = bbox[2] - bbox[0]
            bh = bbox[3] - bbox[1]
            if bw < 8 or bh < 6:
                continue

            # Add generous padding around text region
            pad_x = max(padding_px, int(bw * 0.08))
            pad_y = max(int(padding_px * 0.75), int(bh * 0.18))
            x1 = max(0, bbox[0] - pad_x)
            y1 = max(0, bbox[1] - pad_y)
            x2 = min(width, bbox[2] + pad_x)
            y2 = min(height, bbox[3] + pad_y)

            crop_pil = image.crop((x1, y1, x2, y2))
            seen_bboxes.append(bbox)

            crops_data.append({
                "id": start_id + len(crops_data),
                "page_num": page_num,
                "bbox": bbox,
                "padded_bbox": [x1, y1, x2, y2],
                "crop_pil": crop_pil,
                "source_detection": "paddleocr",
            })

    # Fallback OpenCV morphological detection for faint text
    try:
        gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
        binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 15)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, int(width * 0.035)), 3))
        dilated = cv2.dilate(binary, kernel, iterations=2)
        contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for cnt in contours:
            cx, cy, cw, ch = cv2.boundingRect(cnt)
            if cw >= int(width * 0.05) and ch >= 10 and ch < int(height * 0.4):
                cand_bbox = [cx, cy, cx + cw, cy + ch]
                if not any(ocr_engine._calculate_iou(cand_bbox, eb) > 0.3 for eb in seen_bboxes):
                    pad_x = max(padding_px, int(cw * 0.08))
                    pad_y = max(int(padding_px * 0.75), int(ch * 0.18))
                    x1 = max(0, cx - pad_x)
                    y1 = max(0, cy - pad_y)
                    x2 = min(width, cx + cw + pad_x)
                    y2 = min(height, cy + ch + pad_y)

                    crop_pil = image.crop((x1, y1, x2, y2))
                    crops_data.append({
                        "id": start_id + len(crops_data),
                        "page_num": page_num,
                        "bbox": cand_bbox,
                        "padded_bbox": [x1, y1, x2, y2],
                        "crop_pil": crop_pil,
                        "source_detection": "morphology_fallback",
                    })
                    seen_bboxes.append(cand_bbox)
    except Exception as e:
        logger.debug(f"Morphology fallback error: {str(e)}")

    # Sort crops top-to-bottom, left-to-right
    crops_data.sort(key=lambda c: (c["bbox"][1], c["bbox"][0]))
    for idx, c in enumerate(crops_data, start=start_id):
        c["id"] = idx

    # Run inference with chosen TrOCR model in batches
    if crops_data:
        crop_pils = [c["crop_pil"] for c in crops_data]
        if model_choice == "base":
            preds = fine_tuner.predict_crops_batch(crop_pils, use_latest=False)
        elif model_choice == "latest":
            preds = fine_tuner.predict_crops_batch(crop_pils, use_latest=True)
        else:
            cand_path = fine_tuner.models_dir / model_choice
            if cand_path.exists():
                preds = fine_tuner.predict_crops_batch(crop_pils, custom_model_path=str(cand_path))
            else:
                preds = fine_tuner.predict_crops_batch(crop_pils, use_latest=True)

        for c, (pred_text, conf) in zip(crops_data, preds):
            c["trocr_prediction"] = pred_text
            c["trocr_conf"] = conf

    return crops_data


def main():
    engine, dataset_mgr, fine_tuner = load_ocr_components()

    # Sidebar: Model and Dataset Status
    st.sidebar.markdown("### ✍️ TrOCR Model & Dataset")

    model_info = fine_tuner.get_model_source_info()
    if model_info["is_finetuned"]:
        st.sidebar.success(f"**Model:** Custom Fine-Tuned\n\n`{model_info['name']}`")
        if model_info.get("training_info"):
            t_info = model_info["training_info"]
            st.sidebar.caption(
                f"Trained on {t_info.get('trained_samples_count', 0)} samples | Final Loss: {t_info.get('final_loss', '-')}"
            )
    else:
        st.sidebar.info(f"**Model:** Base Model\n\n`{model_info['name']}`")

    stats = dataset_mgr.get_stats()
    st.sidebar.markdown("---")
    st.sidebar.markdown(f"**📦 Saved Samples:** `{stats['total_samples']}`")
    st.sidebar.markdown(f"**🔤 Characters:** `{stats['total_characters']}`")
    st.sidebar.markdown(f"**📖 Words:** `{stats['total_words']}`")
    st.sidebar.markdown(f"**📄 Source Documents:** `{stats['distinct_sources']}`")

    # Document Cache Info
    cache_files = list(DOC_CACHE_DIR.glob("*.pkl"))
    st.sidebar.markdown("---")
    st.sidebar.markdown(f"**⚡ Cached Extractions:** `{len(cache_files)}`")
    if cache_files:
        if st.sidebar.button("🧹 Clear Document Cache", width="stretch"):
            c_cleared = clear_all_extraction_caches()
            st.cache_data.clear()
            st.sidebar.info(f"Cleared {c_cleared} cached document(s).")
            st.rerun()

    if stats["total_samples"] > 0:
        if st.sidebar.button("🗑️ Clear All Training Samples", width="stretch"):
            deleted = dataset_mgr.clear_dataset()
            st.sidebar.warning(f"Cleared {deleted} samples from dataset.")
            st.rerun()

    # Main Header
    st.markdown('<div class="main-header">TrOCR Training & Fine-Tuning Studio</div>', unsafe_allow_html=True)
    st.markdown(
        '<div class="sub-header">Model selection on upload, zero-lag caching, multi-page PDF support, number filtering, and VRAM-optimized fine-tuning.</div>',
        unsafe_allow_html=True,
    )

    # Navigation Tabs
    tab1, tab2, tab3, tab4 = st.tabs([
        "📝 1. Collect & Annotate Samples",
        "📂 2. Dataset Explorer",
        "🚀 3. Fine-Tune TrOCR",
        "🔬 4. Live Test / Verify",
    ])

    # =========================================================================
    # TAB 1: Collect & Annotate Samples
    # =========================================================================
    with tab1:
        st.subheader("Step 1: Upload Document & Extract Padded Text Regions")

        c_up1, c_up2, c_up3 = st.columns([2, 1, 1])
        with c_up1:
            uploaded_file = st.file_uploader(
                "Upload Document Image (PNG, JPG, JPEG) or Multi-Page PDF",
                type=["png", "jpg", "jpeg", "pdf"],
                help="Upload any form, monitor sheet, or handwritten document.",
            )
        with c_up2:
            padding_slider = st.slider(
                "Region Padding (px)",
                min_value=6,
                max_value=28,
                value=14,
                help="Adds margin around text regions to avoid cutting off pen strokes, ascenders, and descenders.",
            )
        with c_up3:
            available_upload_models = fine_tuner.list_available_checkpoints()
            upload_model_options = [c["id"] for c in available_upload_models]
            upload_model_labels = {c["id"]: c["name"] for c in available_upload_models}
            default_upload_idx = 1 if len(upload_model_options) > 1 and upload_model_options[1] == "latest" else 0

            upload_selected_model = st.selectbox(
                "Prediction Model:",
                options=upload_model_options,
                index=default_upload_idx,
                format_func=lambda x: upload_model_labels.get(x, x),
                help="Select which model (Base model or a Fine-Tuned checkpoint) will generate initial predictions.",
            )

        doc_name = ""
        rendered_images: List[Image.Image] = []
        is_pdf = False
        total_pages = 1
        page_spec = "all"
        is_cached = False
        cache_key = ""
        cached_data = None
        force_rerun_extraction = False

        if uploaded_file is not None:
            doc_name = uploaded_file.name
            file_bytes = uploaded_file.getvalue()

            if uploaded_file.name.lower().endswith(".pdf"):
                is_pdf = True
                doc = fitz.open(stream=file_bytes, filetype="pdf")
                total_pages = len(doc)
                st.info(f"📄 **PDF Document Detected:** `{doc_name}` with **{total_pages} total page(s)**.")

                # PDF Page Selection Mode
                p_opt1, p_opt2 = st.columns([2, 2])
                with p_opt1:
                    pdf_mode = st.radio(
                        "PDF Pages to Process:",
                        options=["📄 Process ALL Pages (Recommended)", "🔍 Process Single Specific Page"],
                        index=0,
                        horizontal=True,
                    )
                with p_opt2:
                    selected_page_num = 1
                    if pdf_mode == "🔍 Process Single Specific Page" and total_pages > 1:
                        selected_page_num = st.slider("Select Page:", min_value=1, max_value=total_pages, value=1)
                        page_spec = f"page_{selected_page_num}"
                    else:
                        page_spec = f"all_{total_pages}"

            else:
                page_spec = "single_image"

            # -------------------------------------------------------------
            # Orientation & Rotation Controls
            # -------------------------------------------------------------
            st.markdown("#### 🔄 Page Orientation & Rotation")
            rot_col1, rot_col2 = st.columns([2, 2])
            with rot_col1:
                global_rotation = st.selectbox(
                    "Default Rotation (All Pages):",
                    options=[0, 90, 180, 270],
                    index=0,
                    format_func=lambda deg: {
                        0: "0° (Original / Upright)",
                        90: "90° Clockwise (↻ Right)",
                        180: "180° (🔄 Upside Down)",
                        270: "270° Clockwise (↺ Left / 90° CCW)",
                    }.get(deg, f"{deg}°"),
                    help="Rotates pages clockwise before region extraction and recognition.",
                    key="tab1_global_rotation",
                )

            page_rotations = {}
            if is_pdf and total_pages > 1 and pdf_mode == "📄 Process ALL Pages (Recommended)":
                with rot_col2:
                    enable_custom_rot = st.checkbox(
                        "📐 Per-Page Rotation Overrides",
                        value=False,
                        help="Enable this if only specific pages in the PDF are vertical/sideways.",
                        key="tab1_enable_custom_rot",
                    )
                if enable_custom_rot:
                    with st.expander("🔄 Configure Individual Page Rotations", expanded=True):
                        st.caption("Select vertical or sideways pages to apply specific rotation angles:")
                        p_rot_90 = st.multiselect(
                            "Rotate 90° Clockwise (↻):",
                            options=[p for p in range(1, total_pages + 1)],
                            format_func=lambda p: f"Page {p}",
                            help="Select pages to rotate 90° clockwise.",
                            key="tab1_rot_90",
                        )
                        p_rot_270 = st.multiselect(
                            "Rotate 270° Clockwise / 90° CCW (↺):",
                            options=[p for p in range(1, total_pages + 1) if p not in p_rot_90],
                            format_func=lambda p: f"Page {p}",
                            help="Select pages to rotate 270° clockwise (90° counter-clockwise).",
                            key="tab1_rot_270",
                        )
                        p_rot_180 = st.multiselect(
                            "Rotate 180° (🔄):",
                            options=[p for p in range(1, total_pages + 1) if p not in p_rot_90 and p not in p_rot_270],
                            format_func=lambda p: f"Page {p}",
                            help="Select pages to flip upside down.",
                            key="tab1_rot_180",
                        )
                        for p in range(1, total_pages + 1):
                            if p in p_rot_90:
                                page_rotations[p] = 90
                            elif p in p_rot_270:
                                page_rotations[p] = 270
                            elif p in p_rot_180:
                                page_rotations[p] = 180
                            else:
                                page_rotations[p] = global_rotation
            else:
                for p in range(1, total_pages + 1):
                    page_rotations[p] = global_rotation

            # Compute rotation spec string for caching
            rot_parts = [f"p{p}:{page_rotations.get(p, global_rotation)}" for p in sorted(page_rotations.keys()) if page_rotations.get(p, global_rotation) != 0]
            rotation_spec = f"g{global_rotation}_" + "_".join(rot_parts) if rot_parts else f"g{global_rotation}"

            # Compute unique persistent cache key including model_id and rotation_spec
            cache_key = compute_doc_cache_key(file_bytes, padding_slider, page_spec, model_id=upload_selected_model, rotation_spec=rotation_spec)
            cached_data = load_extraction_from_cache(cache_key)
            is_cached = (cached_data is not None)

            # -------------------------------------------------------------
            # ZERO-LAG INSTANT PAGE RESOLUTION
            # -------------------------------------------------------------
            if is_cached:
                # 1. Instant load from disk cache without rendering PDF (0.00s!)
                if (
                    "current_cache_key" not in st.session_state
                    or st.session_state.get("current_cache_key") != cache_key
                    or not st.session_state.get("current_crops")
                ):
                    st.session_state["current_crops"] = cached_data["crops_data"]
                    st.session_state["current_doc_pages"] = cached_data["pages_map"]
                    st.session_state["current_doc_name"] = cached_data["doc_name"]
                    st.session_state["current_cache_key"] = cache_key
                    st.session_state["annotations"] = {c["id"]: c.get("trocr_prediction", "") for c in cached_data["crops_data"]}
                    st.session_state["initial_predictions"] = {c["id"]: c.get("trocr_prediction", "") for c in cached_data["crops_data"]}
                    st.session_state["page_number_view"] = 1

                rendered_images = list(cached_data["pages_map"].values())

            else:
                # 2. If not cached, render pages and apply rotation
                if is_pdf:
                    if pdf_mode == "📄 Process ALL Pages (Recommended)":
                        with st.spinner(f"Rendering all {total_pages} PDF pages to high-res images..."):
                            raw_pages = get_cached_pdf_images(file_bytes, dpi=200, max_pages=total_pages)
                            rendered_images = [
                                rotate_pil_image(img, page_rotations.get(idx, global_rotation))
                                for idx, img in enumerate(raw_pages, start=1)
                            ]
                    else:
                        all_p = get_cached_pdf_images(file_bytes, dpi=200, max_pages=selected_page_num)
                        if all_p and len(all_p) >= selected_page_num:
                            raw_img = all_p[selected_page_num - 1]
                            rendered_images = [rotate_pil_image(raw_img, page_rotations.get(selected_page_num, global_rotation))]
                else:
                    raw_img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
                    rendered_images = [rotate_pil_image(raw_img, global_rotation)]

        if rendered_images:
            col_img, col_info = st.columns([1, 2])
            with col_img:
                if len(rendered_images) == 1:
                    rot_applied = page_rotations.get(1, global_rotation)
                    st.image(rendered_images[0], caption=f"Uploaded: {doc_name} ({rendered_images[0].width}x{rendered_images[0].height} px - {rot_applied}°)", width="stretch")
                else:
                    preview_page = st.selectbox(
                        "🔍 Preview Page Orientation:",
                        options=list(range(1, len(rendered_images) + 1)),
                        format_func=lambda p: f"Page {p} ({rendered_images[p-1].width}x{rendered_images[p-1].height} px - {page_rotations.get(p, global_rotation)}°)",
                        key="tab1_preview_page_select",
                    )
                    st.image(rendered_images[preview_page - 1], caption=f"Page {preview_page} of {len(rendered_images)} ({rendered_images[preview_page - 1].width}x{rendered_images[preview_page - 1].height} px)", width="stretch")

            with col_info:
                st.write(f"**Document Ready:** `{doc_name}` &bull; **{len(rendered_images)} Page(s)**")
                st.caption(f"🤖 **Model for Predictions:** `{upload_model_labels.get(upload_selected_model, upload_selected_model)}`")

                if is_cached and st.session_state.get("current_crops"):
                    st.markdown(
                        f"""
                        <div class="cache-badge">
                            ⚡ <strong>Instant Cached TrOCR Extractions Active</strong><br>
                            Loaded <strong>{len(st.session_state['current_crops'])}</strong> text regions across <strong>{len(rendered_images)}</strong> page(s) using <code>{upload_model_labels.get(upload_selected_model, upload_selected_model)}</code>.<br>
                            <em>(Streamlit runs instantly without any lag on keystrokes or filters!)</em>
                        </div>
                        """,
                        unsafe_allow_html=True,
                    )
                    extract_clicked = st.button("🔄 Re-run Extraction with Selected Model", width="stretch")
                    if extract_clicked:
                        # Invalidate cache to force re-computation
                        if (DOC_CACHE_DIR / f"{cache_key}.pkl").exists():
                            (DOC_CACHE_DIR / f"{cache_key}.pkl").unlink(missing_ok=True)
                        if is_pdf:
                            if pdf_mode == "📄 Process ALL Pages (Recommended)":
                                rendered_images = get_cached_pdf_images(file_bytes, dpi=200, max_pages=total_pages)
                            else:
                                all_p = get_cached_pdf_images(file_bytes, dpi=200, max_pages=selected_page_num)
                                rendered_images = [all_p[selected_page_num - 1]] if all_p else []
                        else:
                            rendered_images = [Image.open(io.BytesIO(file_bytes)).convert("RGB")]
                        force_rerun_extraction = True
                else:
                    st.write(f"Click below to detect all text regions across **all {len(rendered_images)} page(s)** with **+{padding_slider}px padding** and transcribe with **{upload_model_labels.get(upload_selected_model, upload_selected_model)}**.")
                    extract_clicked = st.button(f"🔍 Detect Regions & Predict with {upload_model_labels.get(upload_selected_model, 'TrOCR')} (All Pages)", type="primary", width="stretch")

            if extract_clicked and (not is_cached or force_rerun_extraction):
                all_extracted_crops = []
                all_page_maps = {}
                progress_bar = st.progress(0.0)
                status_box = st.empty()

                for p_idx, p_img in enumerate(rendered_images, start=1):
                    status_box.info(f"Processing Page {p_idx} of {len(rendered_images)} with {upload_model_labels.get(upload_selected_model, 'TrOCR')}...")
                    all_page_maps[p_idx] = p_img
                    page_crops = extract_crops_and_predict(
                        image=p_img,
                        ocr_engine=engine,
                        fine_tuner=fine_tuner,
                        padding_px=padding_slider,
                        page_num=p_idx,
                        start_id=len(all_extracted_crops) + 1,
                        model_choice=upload_selected_model,
                    )
                    all_extracted_crops.extend(page_crops)
                    progress_bar.progress(p_idx / len(rendered_images))

                progress_bar.progress(1.0)
                status_box.success(f"🎉 Successfully extracted **{len(all_extracted_crops)} text regions** across **{len(rendered_images)} page(s)**!")

                # Save to persistent cache so subsequent interactions are instant!
                save_extraction_to_cache(cache_key, doc_name, all_page_maps, all_extracted_crops)

                st.session_state["current_crops"] = all_extracted_crops
                st.session_state["current_doc_pages"] = all_page_maps
                st.session_state["current_doc_name"] = doc_name
                st.session_state["current_cache_key"] = cache_key
                st.session_state["annotations"] = {c["id"]: c.get("trocr_prediction", "") for c in all_extracted_crops}
                st.session_state["initial_predictions"] = {c["id"]: c.get("trocr_prediction", "") for c in all_extracted_crops}
                st.session_state["page_number_view"] = 1

        # Show Annotation Form if crops are present
        if "current_crops" in st.session_state and st.session_state["current_crops"]:
            crops = st.session_state["current_crops"]
            initial_preds = st.session_state.get("initial_predictions", {})

            # Calculate modified crops and numeric crops
            modified_crop_ids = set()
            numeric_crop_ids = set()

            for c in crops:
                cid = c["id"]
                current_text = st.session_state.get(f"text_{cid}", st.session_state["annotations"].get(cid, ""))
                initial_text = initial_preds.get(cid, "")
                if current_text.strip() != initial_text.strip() and current_text.strip() != "":
                    modified_crop_ids.add(cid)
                if is_numeric_candidate(current_text) or is_numeric_candidate(initial_text):
                    numeric_crop_ids.add(cid)

            st.markdown("---")
            st.subheader("Step 2: Review & Correct TrOCR Predictions")

            # -------------------------------------------------------------
            # TOP-ANCHORED SAVE BAR (Prominent and immediately visible)
            # -------------------------------------------------------------
            st.markdown(
                f"""
                <div class="save-banner">
                    <h3 style="margin: 0 0 8px 0; color: #38bdf8;">💾 Step 3: Save Training Samples</h3>
                    <p style="margin: 0; color: #cbd5e1; font-size: 0.95rem;">
                        <strong>{len(modified_crop_ids)}</strong> modified sample(s) ready to save &bull; 
                        <strong>{len(numeric_crop_ids)}</strong> total number fields detected
                    </p>
                </div>
                """,
                unsafe_allow_html=True,
            )

            # Recalculate save items
            only_modified_to_save = []
            only_modified_numbers_to_save = []
            selected_to_save = []

            for c in crops:
                cid = c["id"]
                current_text = st.session_state.get(f"text_{cid}", st.session_state["annotations"].get(cid, "")).strip()
                initial_text = initial_preds.get(cid, "").strip()
                p_num = c.get("page_num", 1)

                if current_text:
                    sample_meta = {
                        "bbox": c["bbox"],
                        "padded_bbox": c.get("padded_bbox"),
                        "page_num": p_num,
                        "is_numeric": is_numeric_candidate(current_text),
                    }
                    if st.session_state.get(f"chk_{cid}", False) or (current_text != initial_text):
                        selected_to_save.append((c["crop_pil"], current_text, sample_meta))
                    if current_text != initial_text:
                        only_modified_to_save.append((c["crop_pil"], current_text, sample_meta))
                        if is_numeric_candidate(current_text):
                            only_modified_numbers_to_save.append((c["crop_pil"], current_text, sample_meta))

            btn_col1, btn_col2, btn_col3 = st.columns([2, 2, 2])

            with btn_col1:
                # Primary action: Save ONLY samples where changes were made
                save_modified_clicked = st.button(
                    f"💾 Save ONLY Modified Samples ({len(only_modified_to_save)} items)",
                    type="primary",
                    width="stretch",
                    disabled=(len(only_modified_to_save) == 0),
                    key="top_save_modified",
                )

            with btn_col2:
                # Save ONLY modified number samples
                save_modified_nums_clicked = st.button(
                    f"🔢 Save ONLY Modified NUMBER Samples ({len(only_modified_numbers_to_save)} items)",
                    width="stretch",
                    disabled=(len(only_modified_numbers_to_save) == 0),
                    key="top_save_num_modified",
                )

            with btn_col3:
                # Secondary action: Save all checked samples
                save_all_checked = st.button(
                    f"💾 Save All Checked Samples ({len(selected_to_save)} items)",
                    width="stretch",
                    disabled=(len(selected_to_save) == 0),
                    key="top_save_all",
                )

            if save_modified_clicked:
                saved_count = dataset_mgr.add_batch_samples(
                    only_modified_to_save,
                    source_doc=st.session_state.get("current_doc_name", "upload"),
                )
                st.success(f"🎉 Successfully saved **{saved_count}** modified training samples! Total dataset: **{dataset_mgr.get_sample_count()}** samples.")
                st.session_state["current_crops"] = []
                st.session_state["annotations"] = {}
                st.rerun()

            elif save_modified_nums_clicked:
                saved_count = dataset_mgr.add_batch_samples(
                    only_modified_numbers_to_save,
                    source_doc=st.session_state.get("current_doc_name", "upload"),
                )
                st.success(f"🎉 Successfully saved **{saved_count}** modified NUMBER training samples! Total dataset: **{dataset_mgr.get_sample_count()}** samples.")
                st.session_state["current_crops"] = []
                st.session_state["annotations"] = {}
                st.rerun()

            elif save_all_checked:
                saved_count = dataset_mgr.add_batch_samples(
                    selected_to_save,
                    source_doc=st.session_state.get("current_doc_name", "upload"),
                )
                st.success(f"🎉 Successfully saved **{saved_count}** training samples! Total dataset: **{dataset_mgr.get_sample_count()}** samples.")
                st.session_state["current_crops"] = []
                st.session_state["annotations"] = {}
                st.rerun()

            st.markdown("<hr style='margin: 14px 0; border-color: #334155;'>", unsafe_allow_html=True)

            # Document Overview with Numbered Regions
            if "current_doc_pages" in st.session_state and st.session_state["current_doc_pages"]:
                with st.expander("🗺️ View Full Document Map with Numbered Text Regions", expanded=False):
                    doc_pages = st.session_state["current_doc_pages"]
                    if len(doc_pages) == 1:
                        p_img = list(doc_pages.values())[0]
                        st.image(draw_annotated_regions(p_img, crops), caption="Detected text regions with Region # IDs", width="stretch")
                    else:
                        page_tabs = st.tabs([f"Page {p}" for p in doc_pages.keys()])
                        for p_idx, (p_num, p_img) in enumerate(doc_pages.items()):
                            with page_tabs[p_idx]:
                                p_crops = [c for c in crops if c.get("page_num", 1) == p_num]
                                st.image(draw_annotated_regions(p_img, p_crops), caption=f"Page {p_num} &bull; {len(p_crops)} regions", width="stretch")

            # -------------------------------------------------------------
            # FILTER TOOLBAR & PAGINATION
            # -------------------------------------------------------------
            st.markdown("#### 🎯 Filter & Navigate Regions")

            f_col1, f_col2, f_col3, f_col4 = st.columns([1, 1, 1, 1])

            with f_col1:
                # Content Type Filter (Number vs Text)
                field_type_filter = st.selectbox(
                    "🔢 Filter Content Type:",
                    options=["🔢 Numbers / Numeric Only", "All Fields", "🔤 Text / Words Only"],
                    index=0,
                    help="Filter to display number fields (counters, digits, quantities, dates) vs text words.",
                )

            with f_col2:
                # Edit Status Filter
                status_filter = st.selectbox(
                    "✏️ Filter Edit Status:",
                    options=["All Statuses", "Only Modified Regions", "Only Unchanged Regions"],
                    index=0,
                )

            with f_col3:
                # Page Filter
                distinct_pages = sorted(list(set(c.get("page_num", 1) for c in crops)))
                if len(distinct_pages) > 1:
                    page_filter = st.selectbox(
                        "📄 Filter by Page:",
                        options=["All Pages"] + [f"Page {p}" for p in distinct_pages],
                        index=0,
                    )
                else:
                    page_filter = "All Pages"
                    st.caption("📄 Single Page Document")

            with f_col4:
                page_size = st.selectbox(
                    "Items Per Page View:",
                    options=[20, 50, 100, "All"],
                    index=0,
                    help="Controls how many text regions to render per page view for fast performance.",
                )

            # Filter crops based on selected criteria
            visible_crops = []
            for c in crops:
                cid = c["id"]
                p_num = c.get("page_num", 1)

                # Page filter
                if page_filter != "All Pages" and f"Page {p_num}" != page_filter:
                    continue

                initial_pred = initial_preds.get(cid, c.get("trocr_prediction", ""))
                current_val = st.session_state.get(f"text_{cid}", st.session_state["annotations"].get(cid, initial_pred))
                is_modified = (current_val.strip() != initial_pred.strip() and current_val.strip() != "")
                is_numeric = (cid in numeric_crop_ids)

                # Status filter
                if status_filter == "Only Modified Regions" and not is_modified:
                    continue
                if status_filter == "Only Unchanged Regions" and is_modified:
                    continue

                # Number / Numeric filter
                if field_type_filter == "🔢 Numbers / Numeric Only" and not is_numeric:
                    continue
                if field_type_filter == "🔤 Text / Words Only" and is_numeric:
                    continue

                visible_crops.append(c)

            # Summary Bar
            m_col1, m_col2, m_col3 = st.columns(3)
            m_col1.metric("Visible Filtered Regions", f"{len(visible_crops)} / {len(crops)}")
            m_col2.metric("Modified by You", f"{len(modified_crop_ids)}")
            m_col3.metric("Number Fields", f"{len(numeric_crop_ids)}")

            # Pagination Controls
            if page_size != "All" and len(visible_crops) > page_size:
                total_view_pages = (len(visible_crops) + page_size - 1) // page_size
                curr_view_page = st.session_state.get("page_number_view", 1)
                curr_view_page = max(1, min(curr_view_page, total_view_pages))

                pg_col1, pg_col2, pg_col3 = st.columns([1, 2, 1])
                with pg_col1:
                    if st.button("◀️ Previous View Page", disabled=(curr_view_page <= 1), width="stretch"):
                        st.session_state["page_number_view"] = curr_view_page - 1
                        st.rerun()
                with pg_col2:
                    st.markdown(f"<div style='text-align: center; padding-top: 6px;'><strong>View Page {curr_view_page} of {total_view_pages}</strong> (Items {(curr_view_page-1)*page_size + 1} to {min(curr_view_page*page_size, len(visible_crops))})</div>", unsafe_allow_html=True)
                with pg_col3:
                    if st.button("Next View Page ▶️", disabled=(curr_view_page >= total_view_pages), width="stretch"):
                        st.session_state["page_number_view"] = curr_view_page + 1
                        st.rerun()

                start_idx = (curr_view_page - 1) * page_size
                end_idx = start_idx + page_size
                page_crops_to_show = visible_crops[start_idx:end_idx]
            else:
                page_crops_to_show = visible_crops

            if not visible_crops:
                st.warning("No regions match the active filter criteria. Switch 'Filter Content Type' to 'All Fields' or adjust filters above.")

            # Display Crops in Grid
            cols_per_row = 2
            for i in range(0, len(page_crops_to_show), cols_per_row):
                row_cols = st.columns(cols_per_row)
                for j in range(cols_per_row):
                    if i + j < len(page_crops_to_show):
                        c = page_crops_to_show[i + j]
                        cid = c["id"]
                        p_num = c.get("page_num", 1)
                        initial_pred = initial_preds.get(cid, c.get("trocr_prediction", ""))

                        # Determine current text
                        current_val = st.session_state.get(f"text_{cid}", st.session_state["annotations"].get(cid, initial_pred))
                        is_modified = (current_val.strip() != initial_pred.strip() and current_val.strip() != "")
                        is_numeric = (cid in numeric_crop_ids)

                        # Default checkbox state: True if modified, otherwise user session state
                        default_checked = is_modified
                        if f"chk_{cid}" in st.session_state:
                            default_checked = st.session_state[f"chk_{cid}"]

                        card_class = "crop-card-modified" if is_modified else "crop-card"

                        with row_cols[j]:
                            with st.container():
                                # Header with badges
                                head_c1, head_c2 = st.columns([2, 1])
                                with head_c1:
                                    st.markdown(f"**Region #{cid}** &bull; `Page {p_num}` &bull; `BBox: {c['bbox']}`")
                                with head_c2:
                                    badges_html = ""
                                    if is_numeric:
                                        badges_html += '<span class="badge-number">🔢 NUMBER</span> '
                                    if is_modified:
                                        badges_html += '<span class="badge-modified">✏️ MODIFIED</span>'
                                    else:
                                        badges_html += '<span class="badge-unchanged">Unchanged</span>'
                                    st.markdown(badges_html, unsafe_allow_html=True)

                                sub_col1, sub_col2 = st.columns([1, 2])
                                with sub_col1:
                                    st.image(c["crop_pil"], caption=f"{c['crop_pil'].width}x{c['crop_pil'].height} px (Padded)", width="stretch")
                                    save_this = st.checkbox(
                                        "Choose for training",
                                        value=default_checked,
                                        key=f"chk_{cid}",
                                    )

                                with sub_col2:
                                    user_text = st.text_input(
                                        "Ground Truth Label:",
                                        value=st.session_state["annotations"].get(cid, initial_pred),
                                        key=f"text_{cid}",
                                        help="Edit this prediction to provide verified ground-truth training text.",
                                    )
                                    st.session_state["annotations"][cid] = user_text
                                    st.caption(f"TrOCR Initial: `{initial_pred}`")

                            st.markdown("<hr style='margin: 8px 0; border-color: #334155;'>", unsafe_allow_html=True)

    # =========================================================================
    # TAB 2: Dataset Explorer
    # =========================================================================
    with tab2:
        st.subheader("Collected Training Dataset")
        all_samples = dataset_mgr.get_samples()

        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Total Labeled Crops", len(all_samples))
        m2.metric("Total Characters", sum(len(s.get("text", "")) for s in all_samples))
        m3.metric("Unique Words", len(set(w.lower() for s in all_samples for w in s.get("text", "").split())))
        m4.metric("Sources", len(set(s.get("source_doc") for s in all_samples if s.get("source_doc"))))

        if not all_samples:
            st.info("No training samples collected yet. Upload documents in Tab 1 to start collecting and labeling crops!")
        else:
            exp_col1, exp_col2 = st.columns([3, 1])
            with exp_col1:
                search_query = st.text_input("🔍 Search samples by text label or source document:", "")
            with exp_col2:
                filter_num_dataset = st.checkbox("🔢 Show Only Number Samples", value=False)

            filtered_samples = all_samples
            if filter_num_dataset:
                filtered_samples = [s for s in filtered_samples if is_numeric_candidate(s.get("text", ""))]
            if search_query:
                filtered_samples = [
                    s for s in filtered_samples
                    if search_query.lower() in s.get("text", "").lower() or search_query.lower() in s.get("source_doc", "").lower()
                ]

            st.write(f"Showing **{len(filtered_samples)}** of **{len(all_samples)}** samples:")

            # Paginated or scrollable table of samples
            for s in filtered_samples[:50]:
                img_path = dataset_mgr.get_sample_image_path(s)
                col_img, col_txt, col_meta, col_del = st.columns([1, 2, 1, 1])

                with col_img:
                    if img_path.exists():
                        st.image(str(img_path), width="stretch")
                    else:
                        st.caption("Image missing")

                with col_txt:
                    new_txt = st.text_input(f"Text ({s['id']})", value=s.get("text", ""), key=f"edit_{s['id']}")
                    if new_txt != s.get("text", ""):
                        dataset_mgr.update_sample_text(s["id"], new_txt)
                        st.toast(f"Updated {s['id']}")

                with col_meta:
                    st.caption(f"Source: `{s.get('source_doc', 'upload')}`\n\nDate: `{s.get('created_at', '-')}`")

                with col_del:
                    if st.button("🗑️ Delete", key=f"del_{s['id']}"):
                        dataset_mgr.delete_sample(s["id"])
                        st.rerun()

                st.markdown("<hr style='margin: 4px 0; border-color: #334155;'>", unsafe_allow_html=True)

            if len(filtered_samples) > 50:
                st.caption(f"... and {len(filtered_samples) - 50} more samples.")

    # =========================================================================
    # TAB 3: Fine-Tune TrOCR
    # =========================================================================
    with tab3:
        st.subheader("Fine-Tune TrOCR on Custom Training Dataset")
        total_samples = dataset_mgr.get_sample_count()

        if total_samples < 1:
            st.warning("⚠️ You need at least 1 saved training sample to start fine-tuning. Collect samples in Tab 1 first!")
        else:
            st.success(f"Ready to fine-tune on **{total_samples}** labeled training samples!")

            # -------------------------------------------------------------
            # Starting Model / Checkpoint Selector
            # -------------------------------------------------------------
            st.markdown("#### 🎯 Starting Weights / Model Selection")
            available_checkpoints = fine_tuner.list_available_checkpoints()
            ckpt_options = [c["id"] for c in available_checkpoints]
            ckpt_labels = {c["id"]: c["name"] for c in available_checkpoints}
            default_idx = 1 if len(ckpt_options) > 1 and ckpt_options[1] == "latest" else 0

            selected_ckpt_id = st.selectbox(
                "Select Starting Weights:",
                options=ckpt_options,
                index=default_idx,
                format_func=lambda x: ckpt_labels.get(x, x),
                help="Choose whether to fine-tune from clean base weights or continue from a saved checkpoint.",
            )

            selected_ckpt_meta = next((c for c in available_checkpoints if c["id"] == selected_ckpt_id), None)
            if selected_ckpt_meta:
                if selected_ckpt_meta.get("is_base"):
                    st.info(f"🏛️ **Base Model Selected:** `{selected_ckpt_meta['path']}`\n\n*(Training will start fresh from clean HuggingFace pretrained weights)*")
                else:
                    st.info(f"📦 **Checkpoint Selected:** `{selected_ckpt_meta['path']}`\n\n*{selected_ckpt_meta.get('description', '')}*")

            # GPU VRAM Optimization Settings
            st.markdown("#### 🛡️ GPU VRAM & Memory Management")
            vram_col1, vram_col2 = st.columns(2)
            with vram_col1:
                freeze_encoder = st.checkbox(
                    "❄️ Freeze ViT Encoder (Recommended for 6GB GPUs)",
                    value=True,
                    help="Freezes visual encoder to save 60% VRAM (~4GB memory savings). Perfect for handwriting fine-tuning.",
                )
            with vram_col2:
                grad_checkpointing = st.checkbox(
                    "⚡ Enable Gradient Checkpointing",
                    value=True,
                    help="Slashes activation memory during backprop, ensuring smooth training on 6GB GPUs.",
                )

            # Training Hyperparameters
            st.markdown("#### Hyperparameters")
            h1, h2, h3, h4 = st.columns(4)
            with h1:
                epochs = st.slider("Training Epochs", min_value=1, max_value=30, value=5, help="Number of complete passes through training samples.")
            with h2:
                batch_size = st.selectbox(
                    "Effective Batch Size",
                    options=[1, 2, 4, 8],
                    index=2,
                    help="Target batch size (executed via gradient accumulation to keep peak VRAM low).",
                )
            with h3:
                lr = st.select_slider(
                    "Learning Rate",
                    options=[1e-5, 3e-5, 5e-5, 8e-5, 1e-4],
                    value=5e-5,
                    format_func=lambda x: f"{x:.0e}",
                    help="AdamW optimizer learning rate.",
                )
            with h4:
                device_choice = st.selectbox(
                    "Compute Device",
                    options=["auto", "cuda", "cpu"],
                    index=0,
                    help="CUDA uses NVIDIA GPU with memory optimizations.",
                )

            # Training Execution Section
            st.markdown("---")
            if st.button("🚀 Train / Fine-tune TrOCR", type="primary", width="stretch"):
                progress_bar = st.progress(0.0)
                status_text = st.empty()
                chart_placeholder = st.empty()

                loss_history = []

                def on_training_progress(data: Dict[str, Any]):
                    status = data.get("status")
                    if status == "loading_model":
                        status_text.info(data.get("message", "Loading model..."))
                        progress_bar.progress(data.get("progress", 0.05))
                    elif status == "training":
                        p = data.get("progress", 0.0)
                        progress_bar.progress(p)
                        status_text.text(data.get("message", ""))
                        if "loss" in data:
                            loss_history.append({"step": data.get("step"), "loss": data.get("loss")})
                            chart_placeholder.line_chart(
                                [x["loss"] for x in loss_history],
                                height=200,
                            )
                    elif status == "saving":
                        status_text.info(data.get("message", "Saving checkpoint..."))
                        progress_bar.progress(0.96)
                    elif status == "completed":
                        progress_bar.progress(1.0)
                        status_text.success(data.get("message", "Training complete!"))

                try:
                    summary = fine_tuner.train(
                        epochs=epochs,
                        batch_size=batch_size,
                        learning_rate=lr,
                        device_name=device_choice,
                        starting_checkpoint_id=selected_ckpt_id,
                        freeze_encoder=freeze_encoder,
                        use_gradient_checkpointing=grad_checkpointing,
                        progress_callback=on_training_progress,
                    )
                    st.balloons()
                    st.success(
                        f"🎉 Fine-tuning finished in **{summary['total_duration_seconds']}s**!\n\n"
                        f"- Checkpoint: `{summary['checkpoint_name']}`\n"
                        f"- Starting Weights: `{summary.get('base_model', selected_ckpt_id)}`\n"
                        f"- Final Loss: `{summary['final_loss']}`\n"
                        f"- Saved Location: `{fine_tuner.latest_model_dir}`"
                    )
                except Exception as e:
                    st.error(f"Training failed with error: {str(e)}")
                    logger.error("Fine-tuning exception", exc_info=True)

    # =========================================================================
    # TAB 4: Live Test & PDF Evaluation
    # =========================================================================
    with tab4:
        st.subheader("Evaluate TrOCR on Full Multi-Page PDFs & Documents")
        st.markdown("Upload any test PDF document or image to run text segmentation and evaluate recognition results **page by page**.")

        eval_model_info = fine_tuner.get_model_source_info()
        if eval_model_info["is_finetuned"]:
            st.success(f"**Evaluation Model:** Custom Fine-Tuned (`{eval_model_info['name']}`)")
        else:
            st.info(f"**Evaluation Model:** Base Model (`{eval_model_info['name']}`)")

        e_col1, e_col2 = st.columns([3, 1])
        with e_col1:
            eval_file = st.file_uploader(
                "Upload Test PDF Document or Image",
                type=["pdf", "png", "jpg", "jpeg"],
                key="eval_doc_uploader",
                help="Upload a monitor sheet, form, or document to evaluate recognition across every page.",
            )
        with e_col2:
            eval_padding = st.slider(
                "Evaluation Crop Padding (px)",
                min_value=6,
                max_value=28,
                value=14,
                key="eval_pad_slider",
                help="Padding added around text bounding boxes.",
            )

        compare_with_base = True
        eval_doc_name = ""
        eval_rendered_images: List[Image.Image] = []
        eval_is_pdf = False
        eval_total_pages = 1

        if eval_file is not None:
            eval_doc_name = eval_file.name
            eval_file_bytes = eval_file.getvalue()

            if eval_file.name.lower().endswith(".pdf"):
                eval_is_pdf = True
                eval_doc = fitz.open(stream=eval_file_bytes, filetype="pdf")
                eval_total_pages = len(eval_doc)
                st.info(f"📄 **Test PDF Detected:** `{eval_doc_name}` with **{eval_total_pages} total page(s)**.")

                # Evaluation PDF Page Selection Mode
                ep_opt1, ep_opt2 = st.columns([2, 2])
                with ep_opt1:
                    eval_pdf_mode = st.radio(
                        "PDF Pages to Evaluate:",
                        options=["📄 Process ALL Pages (Recommended)", "🔍 Process Single Specific Page"],
                        index=0,
                        horizontal=True,
                        key="eval_pdf_mode_radio",
                    )
                with ep_opt2:
                    eval_selected_page = 1
                    if eval_pdf_mode == "🔍 Process Single Specific Page" and eval_total_pages > 1:
                        eval_selected_page = st.slider("Select Evaluation Page:", min_value=1, max_value=eval_total_pages, value=1, key="eval_pg_slider")

            # -------------------------------------------------------------
            # Tab 4 Orientation & Rotation Controls
            # -------------------------------------------------------------
            st.markdown("#### 🔄 Page Orientation & Rotation")
            erot_col1, erot_col2 = st.columns([2, 2])
            with erot_col1:
                eval_global_rotation = st.selectbox(
                    "Default Rotation (All Pages):",
                    options=[0, 90, 180, 270],
                    index=0,
                    format_func=lambda deg: {
                        0: "0° (Original / Upright)",
                        90: "90° Clockwise (↻ Right)",
                        180: "180° (🔄 Upside Down)",
                        270: "270° Clockwise (↺ Left / 90° CCW)",
                    }.get(deg, f"{deg}°"),
                    help="Rotates pages before evaluation.",
                    key="tab4_global_rotation",
                )

            eval_page_rotations = {}
            if eval_is_pdf and eval_total_pages > 1 and eval_pdf_mode == "📄 Process ALL Pages (Recommended)":
                with erot_col2:
                    eval_enable_custom_rot = st.checkbox(
                        "📐 Per-Page Rotation Overrides",
                        value=False,
                        help="Enable this if only specific pages in the PDF are vertical/sideways.",
                        key="tab4_enable_custom_rot",
                    )
                if eval_enable_custom_rot:
                    with st.expander("🔄 Configure Individual Evaluation Page Rotations", expanded=True):
                        st.caption("Select vertical or sideways pages to apply specific rotation angles:")
                        ep_rot_90 = st.multiselect(
                            "Rotate 90° Clockwise (↻):",
                            options=[p for p in range(1, eval_total_pages + 1)],
                            format_func=lambda p: f"Page {p}",
                            key="tab4_rot_90",
                        )
                        ep_rot_270 = st.multiselect(
                            "Rotate 270° Clockwise / 90° CCW (↺):",
                            options=[p for p in range(1, eval_total_pages + 1) if p not in ep_rot_90],
                            format_func=lambda p: f"Page {p}",
                            key="tab4_rot_270",
                        )
                        ep_rot_180 = st.multiselect(
                            "Rotate 180° (🔄):",
                            options=[p for p in range(1, eval_total_pages + 1) if p not in ep_rot_90 and p not in ep_rot_270],
                            format_func=lambda p: f"Page {p}",
                            key="tab4_rot_180",
                        )
                        for p in range(1, eval_total_pages + 1):
                            if p in ep_rot_90:
                                eval_page_rotations[p] = 90
                            elif p in ep_rot_270:
                                eval_page_rotations[p] = 270
                            elif p in ep_rot_180:
                                eval_page_rotations[p] = 180
                            else:
                                eval_page_rotations[p] = eval_global_rotation
            else:
                for p in range(1, eval_total_pages + 1):
                    eval_page_rotations[p] = eval_global_rotation

            if eval_is_pdf:
                if eval_pdf_mode == "📄 Process ALL Pages (Recommended)":
                    with st.spinner(f"Rendering all {eval_total_pages} PDF pages..."):
                        raw_eval_pages = get_cached_pdf_images(eval_file_bytes, dpi=200, max_pages=eval_total_pages)
                        eval_rendered_images = [
                            rotate_pil_image(img, eval_page_rotations.get(idx, eval_global_rotation))
                            for idx, img in enumerate(raw_eval_pages, start=1)
                        ]
                else:
                    all_ep = get_cached_pdf_images(eval_file_bytes, dpi=200, max_pages=eval_selected_page)
                    if all_ep and len(all_ep) >= eval_selected_page:
                        raw_img = all_ep[eval_selected_page - 1]
                        eval_rendered_images = [rotate_pil_image(raw_img, eval_page_rotations.get(eval_selected_page, eval_global_rotation))]
            else:
                raw_img = Image.open(io.BytesIO(eval_file_bytes)).convert("RGB")
                eval_rendered_images = [rotate_pil_image(raw_img, eval_global_rotation)]

            # Evaluation Options
            st.markdown("#### Evaluation Settings")
            eo1, eo2 = st.columns(2)
            with eo1:
                compare_with_base = st.checkbox(
                    "⚖️ Compare Fine-Tuned vs. Base Model Side-by-Side",
                    value=True,
                    key="eval_compare_base_chk",
                    help="Runs both models to visually inspect accuracy improvements on every crop.",
                )
            with eo2:
                eval_num_only = st.checkbox(
                    "🔢 Filter Number / Digit Fields in View",
                    value=False,
                    key="eval_num_only_chk",
                    help="Highlight and filter results for counters, quantities, and numerical measurements.",
                )

            # Run Evaluation Action
            if st.button("🚀 Run Recognition Across All PDF Pages", type="primary", width="stretch", key="run_eval_btn"):
                eval_progress = st.progress(0.0)
                eval_status = st.empty()

                page_eval_results = {}
                total_crops_all_pages = 0

                for p_idx, p_img in enumerate(eval_rendered_images, start=1):
                    eval_status.info(f"Detecting & Transcribing Page {p_idx} of {len(eval_rendered_images)}...")
                    
                    # 1. Segment text regions
                    p_crops = extract_crops_and_predict(
                        image=p_img,
                        ocr_engine=engine,
                        fine_tuner=fine_tuner,
                        padding_px=eval_padding,
                        page_num=p_idx,
                        start_id=total_crops_all_pages + 1,
                    )
                    total_crops_all_pages += len(p_crops)

                    # 2. Predict with Fine-Tuned Model (Batch)
                    crop_pils = [c["crop_pil"] for c in p_crops]
                    ft_preds = fine_tuner.predict_crops_batch(crop_pils, use_latest=True, batch_size=8)
                    for c, (ft_text, ft_conf) in zip(p_crops, ft_preds):
                        c["finetuned_prediction"] = ft_text
                        c["finetuned_conf"] = ft_conf

                    # 3. Predict with Base Model if comparison requested
                    if compare_with_base and eval_model_info["is_finetuned"]:
                        base_preds = fine_tuner.predict_crops_batch(crop_pils, use_latest=False, batch_size=8)
                        for c, (b_text, b_conf) in zip(p_crops, base_preds):
                            c["base_prediction"] = b_text
                            c["base_conf"] = b_conf
                    else:
                        for c in p_crops:
                            c["base_prediction"] = c.get("trocr_prediction", "")

                    page_eval_results[p_idx] = {
                        "page_image": p_img,
                        "crops": p_crops,
                    }
                    eval_progress.progress(p_idx / len(eval_rendered_images))

                eval_progress.progress(1.0)
                eval_status.success(f"🎉 Evaluation Complete! Segmented and transcribed **{total_crops_all_pages}** text regions across **{len(eval_rendered_images)}** page(s).")
                st.session_state["eval_results"] = page_eval_results
                st.session_state["eval_doc_name"] = eval_doc_name

        # Display Per-Page Evaluation Results
        if "eval_results" in st.session_state and st.session_state["eval_results"]:
            eval_data = st.session_state["eval_results"]
            all_eval_crops = [c for p_data in eval_data.values() for c in p_data["crops"]]
            all_num_crops = [c for c in all_eval_crops if is_numeric_candidate(c.get("finetuned_prediction", ""))]

            st.markdown("---")
            st.subheader(f"Evaluation Results for `{st.session_state.get('eval_doc_name', 'Document')}`")

            em1, em2, em3, em4 = st.columns(4)
            em1.metric("Pages Evaluated", len(eval_data))
            em2.metric("Total Regions", len(all_eval_crops))
            em3.metric("Number Fields", len(all_num_crops))
            em4.metric("Text / Word Fields", len(all_eval_crops) - len(all_num_crops))

            # Filter row
            f_col1, f_col2 = st.columns([2, 2])
            with f_col1:
                eval_type_filter = st.selectbox(
                    "🔢 Filter Content Type in Results:",
                    options=["All Fields", "🔢 Numbers / Numeric Only", "🔤 Text / Words Only"],
                    index=0,
                    key="eval_type_filter_box",
                )
            with f_col2:
                eval_search = st.text_input("🔍 Search Predictions by Text:", "", key="eval_search_box")

            # Per-Page Tabs
            page_tab_labels = [f"📄 Page {p_num} ({len(p_data['crops'])} regions)" for p_num, p_data in eval_data.items()]
            page_tabs = st.tabs(page_tab_labels)

            for p_idx, (p_num, p_data) in enumerate(eval_data.items()):
                with page_tabs[p_idx]:
                    p_img = p_data["page_image"]
                    p_crops = p_data["crops"]

                    # Filter page crops
                    visible_p_crops = []
                    for c in p_crops:
                        ft_text = c.get("finetuned_prediction", "")
                        is_num = is_numeric_candidate(ft_text) or is_numeric_candidate(c.get("base_prediction", ""))

                        if eval_type_filter == "🔢 Numbers / Numeric Only" and not is_num:
                            continue
                        if eval_type_filter == "🔤 Text / Words Only" and is_num:
                            continue
                        if eval_search and (eval_search.lower() not in ft_text.lower() and eval_search.lower() not in c.get("base_prediction", "").lower()):
                            continue

                        visible_p_crops.append(c)

                    # Page Map Expander
                    with st.expander(f"🗺️ View Page {p_num} Full Annotated Map", expanded=False):
                        st.image(draw_annotated_regions(p_img, p_crops), caption=f"Page {p_num} Document Map", width="stretch")

                    st.markdown(f"**Showing {len(visible_p_crops)} of {len(p_crops)} regions on Page {p_num}:**")

                    if not visible_p_crops:
                        st.info("No regions match the active filter on this page.")

                    # Grid of Crops
                    for i in range(0, len(visible_p_crops), 2):
                        row_cols = st.columns(2)
                        for j in range(2):
                            if i + j < len(visible_p_crops):
                                c = visible_p_crops[i + j]
                                cid = c["id"]
                                ft_text = c.get("finetuned_prediction", "")
                                base_text = c.get("base_prediction", "")
                                is_num = is_numeric_candidate(ft_text)
                                is_diff = (ft_text.strip() != base_text.strip() and base_text.strip() != "")

                                with row_cols[j]:
                                    with st.container():
                                        # Header
                                        h1, h2 = st.columns([2, 1])
                                        with h1:
                                            st.markdown(f"**Region #{cid}** &bull; `BBox: {c['bbox']}`")
                                        with h2:
                                            b_html = ""
                                            if is_num:
                                                b_html += '<span class="badge-number">🔢 NUMBER</span> '
                                            if is_diff:
                                                b_html += '<span class="badge-modified">✨ IMPROVED</span>'
                                            st.markdown(b_html, unsafe_allow_html=True)

                                        # Crop Image & Predictions
                                        c_img_col, c_txt_col = st.columns([1, 2])
                                        with c_img_col:
                                            st.image(c["crop_pil"], caption=f"{c['crop_pil'].width}x{c['crop_pil'].height} px", width="stretch")

                                        with c_txt_col:
                                            st.markdown(f"**Fine-Tuned TrOCR:**")
                                            st.code(ft_text if ft_text else "[Empty]", language="text")

                                            if c.get("base_prediction") and eval_model_info["is_finetuned"]:
                                                st.markdown(f"**Base TrOCR:** `{base_text if base_text else '[Empty]'}`")

                                    st.markdown("<hr style='margin: 8px 0; border-color: #334155;'>", unsafe_allow_html=True)

            # Export Evaluation Results
            st.markdown("---")
            st.markdown("#### 📥 Export Evaluation Report")
            export_col1, export_col2 = st.columns(2)

            export_records = []
            for p_num, p_data in eval_data.items():
                for c in p_data["crops"]:
                    export_records.append({
                        "region_id": c["id"],
                        "page_num": p_num,
                        "bbox": c["bbox"],
                        "finetuned_prediction": c.get("finetuned_prediction", ""),
                        "base_prediction": c.get("base_prediction", ""),
                        "is_numeric": is_numeric_candidate(c.get("finetuned_prediction", "")),
                    })

            with export_col1:
                json_str = json.dumps(export_records, indent=2)
                st.download_button(
                    "📥 Download Results as JSON",
                    data=json_str,
                    file_name=f"{st.session_state.get('eval_doc_name', 'eval')}_results.json",
                    mime="application/json",
                    width="stretch",
                )

            with export_col2:
                import csv
                csv_buffer = io.StringIO()
                writer = csv.DictWriter(csv_buffer, fieldnames=["region_id", "page_num", "bbox", "finetuned_prediction", "base_prediction", "is_numeric"])
                writer.writeheader()
                writer.writerows(export_records)
                st.download_button(
                    "📥 Download Results as CSV",
                    data=csv_buffer.getvalue(),
                    file_name=f"{st.session_state.get('eval_doc_name', 'eval')}_results.csv",
                    mime="text/csv",
                    width="stretch",
                )

        # Quick Single Crop Test Option
        st.markdown("---")
        with st.expander("🖼️ Quick Single Crop Test", expanded=False):
            single_test_file = st.file_uploader("Upload Single Test Crop Image", type=["png", "jpg", "jpeg"], key="single_test_uploader")
            if single_test_file is not None:
                single_test_img = Image.open(single_test_file).convert("RGB")
                sc_col1, sc_col2 = st.columns([1, 2])
                with sc_col1:
                    st.image(single_test_img, caption="Test Crop Image", width="stretch")
                with sc_col2:
                    if st.button("⚡ Run Single Inference", type="primary", key="btn_single_eval"):
                        with st.spinner("Transcribing with latest model weights..."):
                            t_text, t_conf = fine_tuner.predict_crop(single_test_img, use_latest=True)
                            b_text, b_conf = fine_tuner.predict_crop(single_test_img, use_latest=False)
                        st.markdown("### Fine-Tuned Model Prediction:")
                        st.code(t_text if t_text else "[No text predicted]", language="text")
                        if eval_model_info["is_finetuned"]:
                            st.markdown(f"**Base Model Prediction:** `{b_text}`")


if __name__ == "__main__":
    main()

