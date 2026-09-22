import time
import re
import json
import gc
from pathlib import Path
from typing import List, Tuple, Optional, Dict, Any
import numpy as np
import cv2
from PIL import Image
import torch
from transformers import TrOCRProcessor, VisionEncoderDecoderModel
from paddleocr import PaddleOCR

from app.core.logger import logger
from app.config import settings, global_ocr_config, OcrConfigModel
from app.models.schemas import OcrBlock, ExtractedFieldMatch
from app.services.image_preprocessor import ImagePreprocessor
from app.services.validator import FieldValidator
from app.services.field_extractor import SpatialFieldExtractor


class OcrEngine:
    """
    Modular, Configurable Hybrid OCR Engine combining PaddleOCR and Microsoft TrOCR Large:
    1. Image Preprocessing (Deskew, Denoise, Contrast CLAHE, Adaptive Threshold, Upscaling)
    2. Form / Region Detection (PaddleOCR detection with printed prefix/label separation)
    3. TrOCR Preprocessing Variants (Multi-variant generation and selection for difficult handwriting)
    4. Field-Specific Validation (Numeric, Date, Time, Text structure checks)
    5. Template / Table Lookup Correction (Fuzzy matching with strict table validation)
    6. OCR Automatic Retry (Retries low-confidence regions with alternative filters)
    7. Confidence Scoring & Classification (HIGH, MEDIUM, LOW)
    8. Spatial Merging & Deduplication (IoU deduplication and top-to-bottom reading order alignment)
    """

    _instance: Optional["OcrEngine"] = None
    _trocr_processor: Optional[TrOCRProcessor] = None
    _trocr_model: Optional[VisionEncoderDecoderModel] = None
    _paddle_ocr: Optional[PaddleOCR] = None
    _device: Optional[torch.device] = None
    _use_cuda_paddle: bool = False
    _current_model_identifier: str = "base"
    _current_model_path: str = settings.TROCR_MODEL_NAME
    _current_model_display_name: str = "Base Model (microsoft/trocr-large-handwritten)"

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(OcrEngine, cls).__new__(cls)
            cls._instance._initialize()
        return cls._instance

    def _initialize(self):
        """Initializes compute devices and loads PaddleOCR (TrOCR is loaded on-demand to save VRAM)."""
        self._device, self._use_cuda_paddle = self._determine_device()
        self._load_paddle_ocr()
        logger.info("[OcrEngine] Initialized. PaddleOCR ready. TrOCR will load on-demand when an OCR task starts.")

    @staticmethod
    def get_vram_info() -> Dict[str, float]:
        """Returns currently allocated and reserved GPU memory in MB."""
        if torch.cuda.is_available():
            return {
                "allocated_mb": round(torch.cuda.memory_allocated() / (1024 ** 2), 2),
                "reserved_mb": round(torch.cuda.memory_reserved() / (1024 ** 2), 2),
            }
        return {"allocated_mb": 0.0, "reserved_mb": 0.0}

    @property
    def device_name(self) -> str:
        if self._device.type == "cuda" and torch.cuda.is_available():
            return f"CUDA ({torch.cuda.get_device_name(0)})"
        return str(self._device).upper()

    @property
    def device(self) -> torch.device:
        return self._device

    def _determine_device(self) -> Tuple[torch.device, bool]:
        """Determines best available compute device (CUDA -> MPS -> CPU)."""
        requested = settings.DEVICE.lower()
        use_cuda = False

        if requested == "cuda" and torch.cuda.is_available():
            device = torch.device("cuda")
            use_cuda = True
        elif requested == "mps" and hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = torch.device("mps")
        elif requested == "cpu":
            device = torch.device("cpu")
        else:
            if torch.cuda.is_available():
                device = torch.device("cuda")
                use_cuda = True
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                device = torch.device("mps")
            else:
                device = torch.device("cpu")

        logger.info(f"Target compute device selected: {device} (Paddle CUDA: {use_cuda})")
        if device.type == "cuda":
            logger.info(f"CUDA GPU Device: {torch.cuda.get_device_name(0)}")
        return device, use_cuda

    def list_checkpoints(self) -> List[Dict[str, Any]]:
        """
        Lists all available saved checkpoints in the models directory with their metadata.
        """
        backend_root = Path(__file__).resolve().parent.parent.parent
        finetuned_dir = backend_root / "models" / "trocr_finetuned"
        checkpoints: List[Dict[str, Any]] = []

        if not finetuned_dir.exists():
            return checkpoints

        # Scan for versioned checkpoint directories (checkpoint_*)
        for d in sorted(finetuned_dir.glob("checkpoint_*"), reverse=True):
            if d.is_dir() and (d / "config.json").exists():
                info_file = d / "training_info.json"
                info = {}
                if info_file.exists():
                    try:
                        with open(info_file, "r", encoding="utf-8") as f:
                            info = json.load(f)
                    except Exception as e:
                        logger.warning(f"Failed to read training info for {d.name}: {str(e)}")

                checkpoints.append({
                    "id": d.name,
                    "name": d.name,
                    "path": str(d.resolve()),
                    "is_base": False,
                    "timestamp": info.get("timestamp", ""),
                    "trained_samples_count": info.get("trained_samples_count", 0),
                    "final_loss": info.get("final_loss", None),
                    "epochs": info.get("epochs", None),
                    "device": info.get("device", ""),
                    "description": f"Trained on {info.get('trained_samples_count', '?')} samples | Loss: {info.get('final_loss', '-')} | Date: {info.get('timestamp', '-')}",
                    "training_info": info,
                })

        return checkpoints

    def ensure_model_variant(self, model_variant: Optional[str] = "base", checkpoint_id: Optional[str] = None):
        """
        Ensures the requested model variant (Base, Fine-tuned, or Checkpoint) is active in memory.
        Reuses currently loaded model if variant hasn't changed.
        """
        variant = (model_variant or "base").lower().strip()
        backend_root = Path(__file__).resolve().parent.parent.parent
        finetuned_dir = backend_root / "models" / "trocr_finetuned"

        target_identifier = "base"
        target_path = settings.TROCR_MODEL_NAME
        target_display = f"Base Model ({settings.TROCR_MODEL_NAME})"

        if variant in ("finetuned", "fine-tuned", "latest"):
            latest_dir = finetuned_dir / "latest"
            if latest_dir.exists() and (latest_dir / "config.json").exists():
                target_identifier = "finetuned"
                target_path = str(latest_dir)
                target_display = "Fine-tuned Model (Latest Checkpoint)"
            elif finetuned_dir.exists():
                chk_dirs = sorted(finetuned_dir.glob("checkpoint_*"), reverse=True)
                valid_chk = [c for c in chk_dirs if (c / "config.json").exists()]
                if valid_chk:
                    chosen = valid_chk[0]
                    target_identifier = f"checkpoint:{chosen.name}"
                    target_path = str(chosen)
                    target_display = f"Fine-tuned Model ({chosen.name})"
                else:
                    logger.warning("Fine-tuned latest model requested but not found. Falling back to Base Model.")
            else:
                logger.warning("Fine-tuned latest model requested but not found. Falling back to Base Model.")
        elif variant == "checkpoint" and checkpoint_id:
            chk_dir = finetuned_dir / checkpoint_id
            if chk_dir.exists() and (chk_dir / "config.json").exists():
                target_identifier = f"checkpoint:{checkpoint_id}"
                target_path = str(chk_dir)
                target_display = f"Checkpoint ({checkpoint_id})"
            else:
                logger.warning(f"Requested checkpoint '{checkpoint_id}' not found. Falling back to Base Model.")

        if self._current_model_identifier == target_identifier and self._trocr_model is not None:
            return

        logger.info(f"Switching TrOCR model variant to '{target_identifier}' ({target_path})...")
        self._load_trocr_model(target_path, target_identifier, target_display)

    def _load_trocr_model(
        self,
        model_path: Optional[str] = None,
        identifier: str = "base",
        display_name: Optional[str] = None,
    ):
        """Loads TrOCR model and processor into GPU/CPU memory with auto CPU fallback on OOM."""
        if model_path is None:
            backend_root = Path(__file__).resolve().parent.parent.parent
            finetuned_dir = backend_root / "models" / "trocr_finetuned"
            latest_checkpoint = finetuned_dir / "latest"
            if latest_checkpoint.exists() and (latest_checkpoint / "config.json").exists():
                model_name = str(latest_checkpoint)
                identifier = "finetuned"
                display_name = "Fine-tuned Model (Latest Checkpoint)"
                logger.info(f"Auto-detected fine-tuned TrOCR weights at '{model_name}'. Loading fine-tuned model...")
            elif finetuned_dir.exists():
                chk_dirs = sorted(finetuned_dir.glob("checkpoint_*"), reverse=True)
                valid_chk = [c for c in chk_dirs if (c / "config.json").exists()]
                if valid_chk:
                    chosen = valid_chk[0]
                    model_name = str(chosen)
                    identifier = f"checkpoint:{chosen.name}"
                    display_name = f"Fine-tuned Model ({chosen.name})"
                    logger.info(f"Auto-detected fine-tuned TrOCR weights at '{model_name}'. Loading fine-tuned model...")
                else:
                    model_name = settings.TROCR_MODEL_NAME
                    identifier = "base"
                    display_name = f"Base Model ({settings.TROCR_MODEL_NAME})"
                    logger.info(f"Loading base TrOCR model '{model_name}' on device '{self._device}'...")
            else:
                model_name = settings.TROCR_MODEL_NAME
                identifier = "base"
                display_name = f"Base Model ({settings.TROCR_MODEL_NAME})"
                logger.info(f"Loading base TrOCR model '{model_name}' on device '{self._device}'...")
        else:
            model_name = model_path
            if display_name is None:
                display_name = model_name

        start_time = time.time()

        # Proactively release existing model from VRAM before allocating new model
        if self._trocr_model is not None:
            del self._trocr_model
            self._trocr_model = None
        if self._trocr_processor is not None:
            del self._trocr_processor
            self._trocr_processor = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        try:
            self._trocr_processor = TrOCRProcessor.from_pretrained(model_name, use_fast=False)
            try:
                self._trocr_model = VisionEncoderDecoderModel.from_pretrained(model_name).to(self._device)
            except Exception as cuda_err:
                if self._device.type == "cuda":
                    logger.warning(f"CUDA memory allocation failed ({str(cuda_err)}); falling back to CPU for TrOCR...")
                    self._device = torch.device("cpu")
                    if self._trocr_model is not None:
                        del self._trocr_model
                        self._trocr_model = None
                    gc.collect()
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                    self._trocr_model = VisionEncoderDecoderModel.from_pretrained(model_name).to(self._device)
                else:
                    raise
            self._trocr_model.eval()

            self._current_model_identifier = identifier
            self._current_model_path = model_name
            self._current_model_display_name = display_name or model_name

            elapsed = time.time() - start_time
            vram_after = self.get_vram_info()
            logger.info(
                f"[TrOCR] Loaded TrOCR ({self._current_model_display_name}) in {elapsed:.2f}s onto {self._device}. "
                f"GPU Allocated: {vram_after['allocated_mb']} MB, Reserved: {vram_after['reserved_mb']} MB"
            )
        except Exception as e:
            logger.error(f"Failed to load TrOCR model '{model_name}': {str(e)}", exc_info=True)
            raise RuntimeError(f"Could not load TrOCR model: {str(e)}")

    def unload_trocr_model(self):
        """Immediately unloads TrOCR model and processor from memory/GPU and releases VRAM."""
        if self._trocr_model is None and self._trocr_processor is None:
            return

        vram_before = self.get_vram_info()
        logger.info(f"[TrOCR] Unloading model '{self._current_model_display_name}' from VRAM/RAM...")

        if self._trocr_model is not None:
            del self._trocr_model
            self._trocr_model = None
        if self._trocr_processor is not None:
            del self._trocr_processor
            self._trocr_processor = None

        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            if hasattr(torch.cuda, "ipc_collect"):
                torch.cuda.ipc_collect()

        vram_after = self.get_vram_info()
        freed_mb = max(0.0, vram_before["allocated_mb"] - vram_after["allocated_mb"])
        logger.info(
            f"[TrOCR] Model unloaded & VRAM freed. Released ~{freed_mb:.1f} MB "
            f"(Current GPU Allocated: {vram_after['allocated_mb']} MB, Reserved: {vram_after['reserved_mb']} MB)"
        )

    def _load_paddle_ocr(self):
        """Loads PaddleOCR detection and recognition engine."""
        logger.info(f"Loading PaddleOCR (lang='{settings.PADDLE_LANG}')...")
        start_time = time.time()

        try:
            self._paddle_ocr = PaddleOCR(
                use_angle_cls=settings.PADDLE_USE_ANGLE_CLS,
                lang=settings.PADDLE_LANG,
                use_gpu=self._use_cuda_paddle,
                show_log=False,
            )
            elapsed = time.time() - start_time
            logger.info(f"Loaded PaddleOCR in {elapsed:.2f}s.")
        except Exception as e:
            logger.error(f"Failed to initialize PaddleOCR: {str(e)}", exc_info=True)
            raise RuntimeError(f"Could not load PaddleOCR: {str(e)}")

    @property
    def is_loaded(self) -> bool:
        return self._paddle_ocr is not None

    @property
    def is_trocr_loaded(self) -> bool:
        return self._trocr_model is not None

    @property
    def is_paddle_loaded(self) -> bool:
        return self._paddle_ocr is not None

    @property
    def device_name(self) -> str:
        return str(self._device) if self._device else "unknown"

    @property
    def current_model_identifier(self) -> str:
        return self._current_model_identifier

    @property
    def current_model_display_name(self) -> str:
        return self._current_model_display_name

    @property
    def model_name(self) -> str:
        return f"PaddleOCR + {self._current_model_display_name}"

    @staticmethod
    def _polygon_to_bbox(points: List[List[float]]) -> List[int]:
        """Converts 4-point polygon [[x1,y1],[x2,y1],[x2,y2],[x1,y2]] to [x1, y1, x2, y2]."""
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        return [int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))]

    @staticmethod
    def _calculate_iou(box1: List[int], box2: List[int]) -> float:
        """Calculates Intersection over Union (IoU) between two bounding boxes."""
        x1 = max(box1[0], box2[0])
        y1 = max(box1[1], box2[1])
        x2 = min(box1[2], box2[2])
        y2 = min(box1[3], box2[3])

        intersection = max(0, x2 - x1) * max(0, y2 - y1)
        area1 = max(0, box1[2] - box1[0]) * max(0, box1[3] - box1[1])
        area2 = max(0, box2[2] - box2[0]) * max(0, box2[3] - box2[1])
        union = area1 + area2 - intersection

        if union == 0:
            return 0.0
        return intersection / union

    def _infer_trocr_batch(self, crop_images: List[Image.Image]) -> List[str]:
        """
        Runs batched TrOCR Large inference on a list of cropped PIL image regions.
        """
        if not crop_images:
            return []

        results: List[str] = []
        batch_size = max(1, settings.BATCH_SIZE)

        for i in range(0, len(crop_images), batch_size):
            batch = crop_images[i : i + batch_size]
            valid_batch = [img.convert("RGB") for img in batch if img.width >= 5 and img.height >= 5]

            if not valid_batch:
                results.extend([""] * len(batch))
                continue

            try:
                pixel_values = self._trocr_processor(valid_batch, return_tensors="pt").pixel_values.to(self._device)

                with torch.no_grad():
                    generated_ids = self._trocr_model.generate(
                        pixel_values,
                        max_new_tokens=48,
                        early_stopping=True,
                    )

                decoded_texts = self._trocr_processor.batch_decode(generated_ids, skip_special_tokens=True)
                results.extend([t.strip() for t in decoded_texts])
            except Exception as e:
                logger.error(f"TrOCR batch inference error: {str(e)}")
                results.extend([""] * len(batch))

        return results

    def _infer_crop_with_variants(
        self,
        crop_image: Image.Image,
        cfg: OcrConfigModel,
        expected_type: Optional[str] = None,
    ) -> Tuple[str, float, int]:
        """
        Evaluates multiple preprocessing variants of a crop through TrOCR Large,
        selecting the highest-quality candidate based on length and validation score.

        Returns:
            Tuple of (best_text, estimated_confidence, variants_evaluated_count)
        """
        if not cfg.trocr_variants or cfg.trocr_variants_count <= 1:
            # Single variant standard inference
            res = self._infer_trocr_batch([crop_image])
            text = res[0] if res else ""
            return text, 0.88 if text else 0.0, 1

        variants = ImagePreprocessor.generate_variants(crop_image, count=cfg.trocr_variants_count)
        texts = self._infer_trocr_batch(variants)

        # Select best text candidate
        best_text = ""
        best_score = -1.0

        for t in texts:
            if not t:
                continue
            score = float(len(t))
            # Bonus if matches expected field format
            if expected_type and cfg.field_validation:
                is_valid, _ = FieldValidator.validate_field_type(t, expected_type)
                if is_valid:
                    score += 10.0
            if score > best_score:
                best_score = score
                best_text = t

        confidence = 0.90 if best_text else 0.0
        return best_text, confidence, len(variants)

    def process_image(
        self,
        image: Image.Image,
        config_override: Optional[OcrConfigModel] = None,
        lookup_tables: Optional[Dict[str, List[str]]] = None,
        field_type_hints: Optional[Dict[str, str]] = None,
        template_fields: Optional[Any] = None,
        model_variant: Optional[str] = None,
        checkpoint_id: Optional[str] = None,
    ) -> Tuple[str, List[OcrBlock], float, List[ExtractedFieldMatch], Optional[str]]:
        """
        Main OCR Pipeline with 8 modular, individually configurable improvements:
        1. Image Preprocessing (Deskew, Denoise, CLAHE, Adaptive Threshold, Upscale)
        2. Form / Region Detection (PaddleOCR text polygons & prefix label separation)
        3. TrOCR Preprocessing Variants (Multi-variant handwriting evaluation)
        4. Field-Specific Validation (Numeric, Date, Time format checks)
        5. Template / Table Lookup Correction (Fuzzy auto-correction & strict validation)
        6. Automatic OCR Retry (Alternative filter retries for low-confidence regions)
        7. Confidence Scoring (HIGH, MEDIUM, LOW classification)
        8. Spatial Deduplication & Field-Specific Neighborhood Extraction
        """
        start_time = time.time()
        cfg = config_override or global_ocr_config

        # Ensure requested model variant / checkpoint is active and loaded
        if self._trocr_model is None or model_variant or checkpoint_id:
            self.ensure_model_variant(model_variant, checkpoint_id)

        if not self.is_loaded:
            raise RuntimeError("OCR models are not initialized.")

        logger.info("=" * 70)
        logger.info(f"Starting OCR Pipeline on document image ({image.width}x{image.height} px)")
        logger.info(f"Active TrOCR Model Variant: {self._current_model_display_name} (ID: {self._current_model_identifier})")
        logger.info(
            f"Active Switches: Preprocess={cfg.image_preprocessing} | Regions={cfg.region_detection} | "
            f"Variants={cfg.trocr_variants} | Validation={cfg.field_validation} | "
            f"Lookup={cfg.table_lookup_correction} | Retry={cfg.ocr_retry} | Confidence={cfg.confidence_scoring}"
        )
        logger.info("=" * 70)

        # ---------------------------------------------------------
        # STEP 1: Image Preprocessing
        # ---------------------------------------------------------
        processed_image, preproc_meta = ImagePreprocessor.preprocess_page(image, cfg)
        img_np = np.array(processed_image.convert("RGB"))
        height, width, _ = img_np.shape

        raw_candidates: List[Dict[str, Any]] = []

        # ---------------------------------------------------------
        # STEP 2: Form / Region Detection (PaddleOCR)
        # ---------------------------------------------------------
        paddle_results = None
        if cfg.region_detection:
            paddle_start = time.time()
            try:
                paddle_results = self._paddle_ocr.ocr(img_np, cls=True)
                paddle_dur = (time.time() - paddle_start) * 1000.0
                num_found = len(paddle_results[0]) if (paddle_results and paddle_results[0]) else 0
                logger.info(f"--- [STAGE 1: PADDLEOCR DETECTION] Found {num_found} text region(s) in {paddle_dur:.1f}ms ---")
            except Exception as e:
                logger.error(f"PaddleOCR detection failed: {str(e)}", exc_info=True)
                paddle_results = None

        candidate_handwriting_items: List[Dict[str, Any]] = []

        if paddle_results and len(paddle_results) > 0 and paddle_results[0] is not None:
            for idx, item in enumerate(paddle_results[0], start=1):
                poly, (text, conf) = item
                bbox = self._polygon_to_bbox(poly)
                clean_text = text.strip() if text else ""

                if not clean_text or (bbox[2] - bbox[0] < 5) or (bbox[3] - bbox[1] < 5):
                    continue

                # Crop bounding box with padding
                pad_x = 4
                pad_y = 3
                x1 = max(0, bbox[0] - pad_x)
                y1 = max(0, bbox[1] - pad_y)
                x2 = min(width, bbox[2] + pad_x)
                y2 = min(height, bbox[3] + pad_y)
                crop_pil = processed_image.crop((x1, y1, x2, y2))

                # If separate_labels_and_values is enabled, check for label prefixes (e.g. "Part No: PRT-4029")
                if cfg.separate_labels_and_values and ":" in clean_text:
                    parts = clean_text.split(":", 1)
                    label_part = parts[0].strip() + ":"
                    value_part = parts[1].strip()

                    # Keep label as high-confidence printed
                    raw_candidates.append({
                        "raw_text": label_part,
                        "text": label_part,
                        "source": "paddleocr",
                        "bbox": [bbox[0], bbox[1], bbox[0] + int((bbox[2]-bbox[0]) * 0.45), bbox[3]],
                        "confidence": 0.98,
                        "field_type": "text",
                    })

                    if value_part:
                        val_crop_x1 = bbox[0] + int((bbox[2]-bbox[0]) * 0.40)
                        val_crop = processed_image.crop((val_crop_x1, y1, x2, y2))
                        candidate_handwriting_items.append({
                            "crop_pil": val_crop,
                            "paddle_text": value_part,
                            "bbox": [val_crop_x1, bbox[1], bbox[2], bbox[3]],
                            "conf": float(conf),
                        })
                    continue

                # Routing decision: TrOCR vs Printed
                if conf < cfg.handwriting_conf_threshold:
                    logger.info(f"  [PADDLEOCR -> TROCR] Box #{idx}: '{clean_text}' (conf: {conf:.3f}, bbox: {bbox})")
                    candidate_handwriting_items.append({
                        "crop_pil": crop_pil,
                        "paddle_text": clean_text,
                        "bbox": bbox,
                        "conf": float(conf),
                    })
                else:
                    logger.info(f"  [PADDLEOCR PRINTED]  Box #{idx}: '{clean_text}' (conf: {conf:.3f}, bbox: {bbox})")
                    raw_candidates.append({
                        "raw_text": clean_text,
                        "text": clean_text,
                        "source": "paddleocr",
                        "bbox": bbox,
                        "confidence": round(float(conf), 4),
                        "field_type": "text",
                    })

        # Morphological Line Detection Fallback for faint handwriting
        try:
            gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
            binary = cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 15
            )
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, int(width * 0.035)), 3))
            dilated = cv2.dilate(binary, kernel, iterations=2)
            contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            existing_bboxes = [b["bbox"] for b in raw_candidates] + [item["bbox"] for item in candidate_handwriting_items]

            fallback_count = 0
            for cnt in contours:
                cx, cy, cw, ch = cv2.boundingRect(cnt)
                if cw >= int(width * 0.05) and ch >= 8 and ch < int(height * 0.4):
                    candidate_bbox = [cx, cy, cx + cw, cy + ch]
                    overlaps = any(self._calculate_iou(candidate_bbox, eb) > 0.25 for eb in existing_bboxes)
                    if not overlaps:
                        fallback_count += 1
                        crop_pil = processed_image.crop((cx, cy, cx + cw, cy + ch))
                        logger.info(f"  [FALLBACK CONTOUR] Box #{fallback_count}: bbox: {candidate_bbox}")
                        candidate_handwriting_items.append({
                            "crop_pil": crop_pil,
                            "paddle_text": "",
                            "bbox": candidate_bbox,
                            "conf": 0.75,
                        })
                        existing_bboxes.append(candidate_bbox)
        except Exception as e:
            logger.debug(f"Fallback line detection note: {str(e)}")

        # ---------------------------------------------------------
        # STEP 3: TrOCR Preprocessing Variants & Batched Inference
        # ---------------------------------------------------------
        if candidate_handwriting_items:
            logger.info(f"--- [STAGE 2: TROCR INFERENCE (VARIANTS={cfg.trocr_variants})] Transcribing {len(candidate_handwriting_items)} crop(s) ---")
            trocr_start = time.time()

            for idx, item in enumerate(candidate_handwriting_items, start=1):
                crop_pil = item["crop_pil"]
                best_text, est_conf, v_count = self._infer_crop_with_variants(crop_pil, cfg)

                # ---------------------------------------------------------
                # STEP 6: Automatic OCR Retry for Low Confidence
                # ---------------------------------------------------------
                if cfg.ocr_retry and (not best_text or est_conf < cfg.ocr_retry_conf_threshold):
                    logger.info(f"  [OCR RETRY] Retrying low-confidence crop #{idx} with alternative filters...")
                    retry_crop = ImagePreprocessor.enhance_contrast(np.array(crop_pil.convert("RGB")))
                    retry_pil = Image.fromarray(retry_crop)
                    retry_text, retry_conf, _ = self._infer_crop_with_variants(retry_pil, cfg)
                    if retry_text:
                        best_text = retry_text
                        est_conf = max(est_conf, 0.85)

                final_text = best_text if best_text else item["paddle_text"]
                source_tag = "trocr" if best_text else "paddleocr"
                conf_val = est_conf if best_text else round(float(item["conf"]), 4)

                logger.info(f"  [{source_tag.upper()} RESULT] Crop #{idx}: '{final_text}' (conf: {conf_val:.3f}, variants: {v_count})")

                raw_candidates.append({
                    "raw_text": final_text,
                    "text": final_text,
                    "source": source_tag,
                    "bbox": item["bbox"],
                    "confidence": conf_val,
                    "variants_evaluated": v_count,
                })

            trocr_dur = (time.time() - trocr_start) * 1000.0
            logger.info(f"--- TrOCR transcription completed in {trocr_dur:.1f}ms ---")

        # Full-image fallback if no regions found
        if not raw_candidates:
            logger.warning("No text blocks detected; running full-image TrOCR fallback...")
            full_text_list = self._infer_trocr_batch([processed_image])
            full_text = full_text_list[0] if full_text_list else ""
            if full_text:
                raw_candidates.append({
                    "raw_text": full_text,
                    "text": full_text,
                    "source": "trocr",
                    "bbox": [0, 0, width, height],
                    "confidence": 0.80,
                })

        # ---------------------------------------------------------
        # STEP 5: Spatial Deduplication
        # ---------------------------------------------------------
        deduped_blocks: List[Dict[str, Any]] = []
        sorted_candidates = sorted(
            raw_candidates,
            key=lambda b: (1 if b["source"] == "trocr" else 0, b.get("confidence", 0)),
            reverse=True,
        )

        for cand in sorted_candidates:
            is_dup = False
            for existing in deduped_blocks:
                if self._calculate_iou(cand["bbox"], existing["bbox"]) > cfg.iou_deduplication_threshold:
                    is_dup = True
                    break
            if not is_dup:
                deduped_blocks.append(cand)

        logger.info(f"--- [STAGE 3: SPATIAL DEDUPLICATION] Retained {len(deduped_blocks)} unique block(s) from {len(raw_candidates)} candidate(s) ---")

        # ---------------------------------------------------------
        # STEP 4, 5, 7: Validation, Table Lookup Correction & Confidence Scoring
        # ---------------------------------------------------------
        flat_lookup_list: List[str] = []
        if lookup_tables:
            for table_name, vals in lookup_tables.items():
                flat_lookup_list.extend(vals)

        validated_blocks: List[OcrBlock] = []

        for b in deduped_blocks:
            raw_txt = b["raw_text"]
            cur_txt = raw_txt
            corr_txt = None
            is_valid = True
            val_msg = None
            conf = b.get("confidence", 0.90)

            # Table Lookup Correction (Step 5)
            if cfg.table_lookup_correction and flat_lookup_list:
                c_val, c_score, c_valid, c_msg = FieldValidator.lookup_table_correction(
                    raw_text=raw_txt,
                    lookup_values=flat_lookup_list,
                    threshold=cfg.fuzzy_match_threshold,
                    strict=cfg.strict_lookup_validation,
                )
                if c_val != raw_txt:
                    corr_txt = c_val
                    cur_txt = c_val
                is_valid = c_valid
                val_msg = c_msg
                conf = max(conf, c_score)

            # Field-Specific Validation (Step 4)
            if cfg.field_validation and is_valid:
                f_type = b.get("field_type")
                f_valid, f_msg = FieldValidator.validate_field_type(cur_txt, f_type)
                if not f_valid:
                    is_valid = False
                    val_msg = f_msg

            # Confidence Level Classification (Step 7)
            conf_level = "HIGH"
            if cfg.confidence_scoring:
                conf_level = FieldValidator.classify_confidence(
                    conf,
                    high_thresh=cfg.high_conf_threshold,
                    med_thresh=cfg.medium_conf_threshold,
                )

            validated_blocks.append(
                OcrBlock(
                    text=cur_txt,
                    raw_text=raw_txt,
                    corrected_text=corr_txt,
                    source=b["source"],
                    bbox=b["bbox"],
                    confidence=round(float(conf), 4),
                    confidence_level=conf_level,
                    is_valid=is_valid,
                    validation_message=val_msg,
                    field_type=b.get("field_type"),
                    variants_evaluated=b.get("variants_evaluated"),
                )
            )

        # ---------------------------------------------------------
        # STEP 8: Reading Order Sorting & Text Line Reconstruction
        # ---------------------------------------------------------
        # Sort blocks top-to-bottom by y1
        validated_blocks.sort(key=lambda b: (b.bbox[1], b.bbox[0]))

        lines_grouped: List[List[OcrBlock]] = []
        for block in validated_blocks:
            y_center = (block.bbox[1] + block.bbox[3]) / 2.0
            height_box = block.bbox[3] - block.bbox[1]
            tolerance = max(14.0, height_box * 0.55)

            matched_line = None
            for line in lines_grouped:
                line_y_centers = [(b.bbox[1] + b.bbox[3]) / 2.0 for b in line]
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
        final_ordered_blocks: List[OcrBlock] = []

        for line in lines_grouped:
            line.sort(key=lambda b: b.bbox[0])
            line_text = " ".join(b.text for b in line if b.text).strip()
            raw_line_text = " ".join(b.raw_text for b in line if b.raw_text).strip()
            if line_text:
                reconstructed_lines.append(line_text)
            if raw_line_text:
                reconstructed_raw_lines.append(raw_line_text)
            final_ordered_blocks.extend(line)

        reconstructed_full_text = "\n".join(reconstructed_lines).strip()

        # ---------------------------------------------------------
        # STEP 9: Field-Specific Spatial Extraction (if template_fields configured)
        # ---------------------------------------------------------
        extracted_field_matches: List[ExtractedFieldMatch] = []
        structured_field_text: Optional[str] = None

        if template_fields:
            # Convert blocks to dicts for spatial extractor
            block_dicts = [
                {
                    "text": b.text,
                    "raw_text": b.raw_text,
                    "bbox": b.bbox,
                    "confidence": b.confidence,
                    "source": b.source,
                    "field_type": b.field_type,
                    "is_valid": b.is_valid,
                }
                for b in final_ordered_blocks
            ]
            extracted_field_matches, structured_field_text = SpatialFieldExtractor.extract_fields(
                ocr_blocks=block_dicts,
                template_fields=template_fields,
                image_width=width,
                image_height=height,
                lookup_tables=lookup_tables,
            )

        combined_text = structured_field_text if (template_fields and structured_field_text) else reconstructed_full_text
        duration_ms = (time.time() - start_time) * 1000.0

        # Log Final Output
        logger.info("=" * 70)
        logger.info(
            f"[FINAL COMBINED OCR OUTPUT] ({len(final_ordered_blocks)} blocks, "
            f"{len(extracted_field_matches)} fields extracted, duration: {duration_ms:.1f}ms):"
        )
        for idx, line in enumerate(combined_text.split("\n"), start=1):
            logger.info(f"  Line {idx:02d}: {line}")
        logger.info("=" * 70)

        return combined_text, final_ordered_blocks, duration_ms, extracted_field_matches, structured_field_text


# Module-level accessor
def get_ocr_engine() -> OcrEngine:
    return OcrEngine()
