import os
import sys
import time
import json
import shutil
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional, Callable
from datetime import datetime
from PIL import Image

# Ensure torch is imported early
import torch
from torch.utils.data import Dataset, DataLoader
from transformers import TrOCRProcessor, VisionEncoderDecoderModel, get_linear_schedule_with_warmup

from app.core.logger import logger
from app.config import settings


# Default paths
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
DEFAULT_DATASET_DIR = BACKEND_DIR / "training_data" / "trocr_dataset"
DEFAULT_MODELS_DIR = BACKEND_DIR / "models" / "trocr_finetuned"


class TrOCRDatasetManager:
    """
    Manages collection, persistence, and querying of custom handwriting training samples.
    """

    def __init__(self, dataset_dir: Optional[Path] = None):
        self.dataset_dir = Path(dataset_dir) if dataset_dir else DEFAULT_DATASET_DIR
        self.images_dir = self.dataset_dir / "images"
        self.metadata_file = self.dataset_dir / "metadata.json"

        self.images_dir.mkdir(parents=True, exist_ok=True)
        if not self.metadata_file.exists():
            self._save_metadata([])

    def _load_metadata(self) -> List[Dict[str, Any]]:
        if not self.metadata_file.exists():
            return []
        try:
            with open(self.metadata_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading metadata: {str(e)}")
            return []

    def _save_metadata(self, data: List[Dict[str, Any]]):
        self.dataset_dir.mkdir(parents=True, exist_ok=True)
        with open(self.metadata_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def get_samples(self) -> List[Dict[str, Any]]:
        """Returns all registered dataset samples."""
        return self._load_metadata()

    def get_sample_count(self) -> int:
        """Returns total number of labeled samples."""
        return len(self.get_samples())

    def get_sample_image_path(self, sample: Dict[str, Any]) -> Path:
        """Returns absolute path to sample image file."""
        return self.images_dir / sample["image_file"]

    def add_sample(
        self,
        crop_image: Image.Image,
        text: str,
        source_doc: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Adds a single labeled crop sample to the dataset.
        """
        clean_text = text.strip() if text else ""
        samples = self._load_metadata()

        sample_id = f"sample_{len(samples) + 1:05d}_{int(time.time() * 1000) % 100000:05d}"
        filename = f"{sample_id}.png"
        img_path = self.images_dir / filename

        # Save RGB PNG
        crop_image.convert("RGB").save(img_path, format="PNG")

        entry = {
            "id": sample_id,
            "image_file": filename,
            "text": clean_text,
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "source_doc": source_doc,
            "image_width": crop_image.width,
            "image_height": crop_image.height,
            "metadata": metadata or {},
        }
        samples.append(entry)
        self._save_metadata(samples)
        return entry

    def add_batch_samples(
        self,
        items: List[Tuple[Image.Image, str, Optional[Dict[str, Any]]]],
        source_doc: str = "",
    ) -> int:
        """
        Appends multiple labeled samples to the dataset in a single operation.
        """
        samples = self._load_metadata()
        added_count = 0

        for idx, item in enumerate(items):
            if len(item) == 2:
                crop_img, text = item
                meta = {}
            else:
                crop_img, text, meta = item

            clean_text = text.strip() if text else ""
            if not clean_text or crop_img.width < 5 or crop_img.height < 5:
                continue

            sample_id = f"sample_{len(samples) + 1:05d}_{int(time.time() * 1000) % 100000:05d}_{idx:02d}"
            filename = f"{sample_id}.png"
            img_path = self.images_dir / filename

            crop_img.convert("RGB").save(img_path, format="PNG")

            entry = {
                "id": sample_id,
                "image_file": filename,
                "text": clean_text,
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "source_doc": source_doc,
                "image_width": crop_img.width,
                "image_height": crop_img.height,
                "metadata": meta or {},
            }
            samples.append(entry)
            added_count += 1

        self._save_metadata(samples)
        logger.info(f"Added {added_count} samples to TrOCR training dataset (Total: {len(samples)}).")
        return added_count

    def update_sample_text(self, sample_id: str, new_text: str) -> bool:
        """Updates text label of an existing sample."""
        samples = self._load_metadata()
        for s in samples:
            if s["id"] == sample_id:
                s["text"] = new_text.strip()
                s["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                self._save_metadata(samples)
                return True
        return False

    def delete_sample(self, sample_id: str) -> bool:
        """Deletes a sample image and its metadata entry."""
        samples = self._load_metadata()
        target = next((s for s in samples if s["id"] == sample_id), None)
        if not target:
            return False

        img_path = self.images_dir / target["image_file"]
        if img_path.exists():
            try:
                img_path.unlink()
            except Exception as e:
                logger.warning(f"Failed to delete file {img_path}: {str(e)}")

        remaining = [s for s in samples if s["id"] != sample_id]
        self._save_metadata(remaining)
        return True

    def clear_dataset(self) -> int:
        """Removes all samples and images from the dataset."""
        samples = self._load_metadata()
        count = len(samples)
        for s in samples:
            img_path = self.images_dir / s["image_file"]
            if img_path.exists():
                try:
                    img_path.unlink()
                except Exception:
                    pass
        self._save_metadata([])
        return count

    def get_stats(self) -> Dict[str, Any]:
        """Calculates summary statistics of the dataset."""
        samples = self._load_metadata()
        total_samples = len(samples)
        non_empty = [s for s in samples if s.get("text", "").strip()]
        total_chars = sum(len(s.get("text", "")) for s in non_empty)
        words = []
        for s in non_empty:
            words.extend(s.get("text", "").split())

        sources = set(s.get("source_doc") for s in samples if s.get("source_doc"))

        return {
            "total_samples": total_samples,
            "labeled_samples": len(non_empty),
            "total_characters": total_chars,
            "total_words": len(words),
            "unique_words": len(set(w.lower() for w in words)),
            "distinct_sources": len(sources),
            "latest_sample_time": samples[-1].get("created_at") if samples else None,
        }


class PyTorchTrOCRDataset(Dataset):
    """
    PyTorch Dataset wrapper for TrOCR fine-tuning.
    Preprocesses images with TrOCRProcessor and tokenizes text targets with pad masking.
    """

    def __init__(
        self,
        samples: List[Dict[str, Any]],
        images_dir: Path,
        processor: TrOCRProcessor,
        max_target_length: int = 64,
    ):
        self.samples = [s for s in samples if s.get("text", "").strip()]
        self.images_dir = images_dir
        self.processor = processor
        self.max_target_length = max_target_length

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> Dict[str, Any]:
        sample = self.samples[idx]
        img_path = self.images_dir / sample["image_file"]

        # Load image
        try:
            image = Image.open(img_path).convert("RGB")
        except Exception:
            # Fallback blank image if file is unreadable
            image = Image.new("RGB", (384, 384), color="white")

        pixel_values = self.processor(image, return_tensors="pt").pixel_values.squeeze(0)

        target_text = sample["text"]
        labels = self.processor.tokenizer(
            target_text,
            padding="max_length",
            max_length=self.max_target_length,
            truncation=True,
            return_tensors="pt",
        ).input_ids.squeeze(0)

        # Replace pad token ID with -100 so loss ignores padding
        labels[labels == self.processor.tokenizer.pad_token_id] = -100

        return {
            "pixel_values": pixel_values,
            "labels": labels,
            "text": target_text,
            "id": sample["id"],
        }


class TrOCRFineTuner:
    """
    Handles incremental fine-tuning of TrOCR on custom handwriting datasets,
    checkpoint management, and inference with fine-tuned models.
    """

    def __init__(
        self,
        models_dir: Optional[Path] = None,
        dataset_manager: Optional[TrOCRDatasetManager] = None,
    ):
        self.models_dir = Path(models_dir) if models_dir else DEFAULT_MODELS_DIR
        self.latest_model_dir = self.models_dir / "latest"
        self.dataset_manager = dataset_manager or TrOCRDatasetManager()
        self.models_dir.mkdir(parents=True, exist_ok=True)

    def get_latest_checkpoint_path(self) -> Optional[Path]:
        """Returns path to latest fine-tuned checkpoint if it exists and is complete."""
        if self.latest_model_dir.exists():
            cfg_file = self.latest_model_dir / "config.json"
            if cfg_file.exists():
                return self.latest_model_dir
        return None

    def list_available_checkpoints(self) -> List[Dict[str, Any]]:
        """
        Lists all available starting points for training:
        - Base model
        - Latest fine-tuned model
        - Individual versioned checkpoints
        """
        options: List[Dict[str, Any]] = [
            {
                "id": "base",
                "name": f"🏛️ Base Model ({settings.TROCR_MODEL_NAME})",
                "path": settings.TROCR_MODEL_NAME,
                "is_base": True,
                "description": "Clean HuggingFace pretrained model weights",
                "training_info": None,
            }
        ]

        # Add Latest if exists
        latest_path = self.get_latest_checkpoint_path()
        if latest_path:
            info_file = latest_path / "training_info.json"
            info = {}
            if info_file.exists():
                try:
                    with open(info_file, "r", encoding="utf-8") as f:
                        info = json.load(f)
                except Exception:
                    pass
            options.append({
                "id": "latest",
                "name": "✨ Latest Fine-Tuned Checkpoint (latest)",
                "path": str(latest_path),
                "is_base": False,
                "description": f"Trained on {info.get('trained_samples_count', '?')} samples | Loss: {info.get('final_loss', '-')} | Date: {info.get('timestamp', '-')}",
                "training_info": info,
            })

        # Add specific checkpoint directories
        if self.models_dir.exists():
            for d in sorted(self.models_dir.glob("checkpoint_*"), reverse=True):
                if d.is_dir() and (d / "config.json").exists() and d.name != "latest":
                    info_file = d / "training_info.json"
                    info = {}
                    if info_file.exists():
                        try:
                            with open(info_file, "r", encoding="utf-8") as f:
                                info = json.load(f)
                        except Exception:
                            pass
                    options.append({
                        "id": d.name,
                        "name": f"📦 {d.name} ({info.get('timestamp', d.name)})",
                        "path": str(d),
                        "is_base": False,
                        "description": f"Trained on {info.get('trained_samples_count', '?')} samples | Loss: {info.get('final_loss', '-')} | Date: {info.get('timestamp', '-')}",
                        "training_info": info,
                    })

        return options

    def get_model_source_info(self) -> Dict[str, Any]:
        """Returns metadata about the active TrOCR model (base vs. fine-tuned)."""
        latest_path = self.get_latest_checkpoint_path()
        if latest_path:
            info_file = latest_path / "training_info.json"
            info = {}
            if info_file.exists():
                try:
                    with open(info_file, "r", encoding="utf-8") as f:
                        info = json.load(f)
                except Exception:
                    pass
            return {
                "type": "fine-tuned",
                "path": str(latest_path.resolve()),
                "name": f"Fine-Tuned Checkpoint ({info.get('timestamp', 'Custom')})",
                "training_info": info,
                "is_finetuned": True,
            }
        else:
            return {
                "type": "base",
                "path": settings.TROCR_MODEL_NAME,
                "name": settings.TROCR_MODEL_NAME,
                "training_info": None,
                "is_finetuned": False,
            }

    def train(
        self,
        epochs: int = 5,
        batch_size: int = 4,
        learning_rate: float = 5e-5,
        weight_decay: float = 0.01,
        max_target_length: int = 64,
        device_name: str = "auto",
        starting_checkpoint_id: Optional[str] = None,
        freeze_encoder: bool = True,
        use_gradient_checkpointing: bool = True,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """
        Executes fine-tuning loop on all labeled samples in the dataset with VRAM optimizations:
        - Allows starting from Base Model, Latest Checkpoint, or any specific saved Checkpoint
        - Freezes ViT encoder by default (reduces trainable parameters & optimizer memory by 60%)
        - Enables gradient checkpointing to slash activation memory
        - Uses micro-batching (micro_batch=1) with gradient accumulation
        - Employs AMP mixed precision and proactive cache emptying
        - Auto-falls back if CUDA OOM occurs
        """
        os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        t_start = time.time()
        samples = self.dataset_manager.get_samples()
        valid_samples = [s for s in samples if s.get("text", "").strip()]

        if not valid_samples:
            raise ValueError("Cannot train: No labeled training samples found in dataset.")

        # Determine compute device
        if device_name == "auto":
            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            device = torch.device(device_name if (device_name != "cuda" or torch.cuda.is_available()) else "cpu")

        # Determine model starting point from user selection
        if starting_checkpoint_id == "base":
            model_path_to_load = settings.TROCR_MODEL_NAME
            source_description = f"Base HuggingFace Model ({settings.TROCR_MODEL_NAME})"
        elif starting_checkpoint_id == "latest":
            latest_checkpoint = self.get_latest_checkpoint_path()
            if latest_checkpoint:
                model_path_to_load = str(latest_checkpoint)
                source_description = f"Latest Checkpoint ({latest_checkpoint.name})"
            else:
                model_path_to_load = settings.TROCR_MODEL_NAME
                source_description = f"Base Model ({settings.TROCR_MODEL_NAME})"
        elif starting_checkpoint_id:
            # Look up specific checkpoint directory
            cand_path = self.models_dir / starting_checkpoint_id
            if cand_path.exists() and (cand_path / "config.json").exists():
                model_path_to_load = str(cand_path)
                source_description = f"Specific Checkpoint ({starting_checkpoint_id})"
            else:
                model_path_to_load = settings.TROCR_MODEL_NAME
                source_description = f"Base Model ({settings.TROCR_MODEL_NAME})"
        else:
            latest_checkpoint = self.get_latest_checkpoint_path()
            if latest_checkpoint:
                model_path_to_load = str(latest_checkpoint)
                source_description = f"Latest Checkpoint ({latest_checkpoint.name})"
            else:
                model_path_to_load = settings.TROCR_MODEL_NAME
                source_description = f"Base Model ({settings.TROCR_MODEL_NAME})"

        if progress_callback:
            progress_callback({
                "status": "loading_model",
                "message": f"Loading starting weights from {source_description} on {device}...",
                "progress": 0.05,
            })

        logger.info(f"Fine-Tuning: Loading TrOCR from {model_path_to_load} onto {device}...")
        processor = TrOCRProcessor.from_pretrained(model_path_to_load)
        model = VisionEncoderDecoderModel.from_pretrained(model_path_to_load).to(device)

        # Set special tokens in model config
        model.config.decoder_start_token_id = processor.tokenizer.cls_token_id
        model.config.pad_token_id = processor.tokenizer.pad_token_id
        model.config.vocab_size = model.config.decoder.vocab_size

        # VRAM Optimization 1: Freeze ViT Encoder (saves ~60% VRAM / 4GB+ optimizer states)
        if freeze_encoder:
            logger.info("VRAM Optimization: Freezing ViT encoder parameters...")
            for param in model.encoder.parameters():
                param.requires_grad = False

        # VRAM Optimization 2: Enable Gradient Checkpointing
        if use_gradient_checkpointing and hasattr(model, "gradient_checkpointing_enable"):
            try:
                model.gradient_checkpointing_enable()
                logger.info("VRAM Optimization: Gradient checkpointing enabled.")
            except Exception as e:
                logger.debug(f"Gradient checkpointing notice: {str(e)}")

        # Prepare PyTorch Dataset
        dataset = PyTorchTrOCRDataset(
            samples=valid_samples,
            images_dir=self.dataset_manager.images_dir,
            processor=processor,
            max_target_length=max_target_length,
        )

        # VRAM Optimization 3: Micro-batch DataLoader with Gradient Accumulation
        # On GPU with <=8GB VRAM, micro_batch_size = 1 prevents allocation spikes
        micro_batch_size = 1 if device.type == "cuda" else min(2, len(dataset))
        accum_steps = max(1, batch_size // micro_batch_size)

        dataloader = DataLoader(
            dataset,
            batch_size=micro_batch_size,
            shuffle=True,
            drop_last=False,
        )

        trainable_params = [p for p in model.parameters() if p.requires_grad]
        logger.info(
            f"Trainable Parameters: {sum(p.numel() for p in trainable_params):,} / {sum(p.numel() for p in model.parameters()):,}"
        )

        optimizer = torch.optim.AdamW(
            trainable_params,
            lr=learning_rate,
            weight_decay=weight_decay,
        )

        total_optimizer_steps = (len(dataloader) // accum_steps + (1 if len(dataloader) % accum_steps != 0 else 0)) * epochs
        scheduler = get_linear_schedule_with_warmup(
            optimizer,
            num_warmup_steps=max(1, int(total_optimizer_steps * 0.1)),
            num_training_steps=max(1, total_optimizer_steps),
        )

        use_amp = (device.type == "cuda")
        scaler = torch.amp.GradScaler("cuda", enabled=use_amp) if use_amp else None

        logger.info(
            f"Starting TrOCR Fine-Tuning: {len(dataset)} samples, {epochs} epochs, "
            f"micro_batch={micro_batch_size}, accum_steps={accum_steps} (Effective Batch: {micro_batch_size * accum_steps}), "
            f"device={device}, AMP={use_amp}"
        )

        epoch_losses: List[float] = []
        step_history: List[Dict[str, Any]] = []
        global_step = 0
        opt_step = 0

        model.train()
        optimizer.zero_grad()

        for epoch in range(1, epochs + 1):
            epoch_loss_sum = 0.0
            epoch_steps = 0

            for b_idx, batch in enumerate(dataloader, start=1):
                global_step += 1
                pixel_values = batch["pixel_values"].to(device)
                labels = batch["labels"].to(device)

                try:
                    if use_amp and scaler is not None:
                        with torch.amp.autocast("cuda"):
                            outputs = model(pixel_values=pixel_values, labels=labels)
                            loss = outputs.loss / accum_steps
                        scaler.scale(loss).backward()
                    else:
                        outputs = model(pixel_values=pixel_values, labels=labels)
                        loss = outputs.loss / accum_steps
                        loss.backward()

                except torch.cuda.OutOfMemoryError as oom:
                    logger.warning("CUDA OOM caught during forward/backward. Clearing cache...")
                    torch.cuda.empty_cache()
                    optimizer.zero_grad()
                    continue

                raw_loss = float(loss.item()) * accum_steps
                epoch_loss_sum += raw_loss
                epoch_steps += 1

                # Gradient accumulation step
                if b_idx % accum_steps == 0 or b_idx == len(dataloader):
                    opt_step += 1
                    if use_amp and scaler is not None:
                        scaler.unscale_(optimizer)
                        torch.nn.utils.clip_grad_norm_(trainable_params, max_norm=1.0)
                        scaler.step(optimizer)
                        scaler.update()
                    else:
                        torch.nn.utils.clip_grad_norm_(trainable_params, max_norm=1.0)
                        optimizer.step()

                    scheduler.step()
                    optimizer.zero_grad()

                step_info = {
                    "epoch": epoch,
                    "step": global_step,
                    "total_steps": len(dataloader) * epochs,
                    "loss": round(raw_loss, 4),
                    "lr": float(scheduler.get_last_lr()[0]),
                    "progress": min(0.95, (global_step / max(1, len(dataloader) * epochs))),
                }
                step_history.append(step_info)

                if progress_callback:
                    progress_callback({
                        "status": "training",
                        "epoch": epoch,
                        "epochs": epochs,
                        "step": global_step,
                        "total_steps": len(dataloader) * epochs,
                        "loss": raw_loss,
                        "progress": step_info["progress"],
                        "message": f"Epoch {epoch}/{epochs} | Step {global_step}/{len(dataloader) * epochs} | Loss: {raw_loss:.4f}",
                    })

            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            avg_epoch_loss = epoch_loss_sum / max(1, epoch_steps)
            epoch_losses.append(avg_epoch_loss)
            logger.info(f"Epoch {epoch}/{epochs} Complete - Average Loss: {avg_epoch_loss:.4f}")

        # ---------------------------------------------------------
        # Save Checkpoint & Update Latest Model Directory
        # ---------------------------------------------------------
        if progress_callback:
            progress_callback({
                "status": "saving",
                "message": "Saving fine-tuned model weights and tokenizer...",
                "progress": 0.96,
            })

        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        checkpoint_name = f"checkpoint_{timestamp_str}"
        checkpoint_dir = self.models_dir / checkpoint_name
        checkpoint_dir.mkdir(parents=True, exist_ok=True)

        # Save to versioned checkpoint directory
        model.save_pretrained(checkpoint_dir)
        processor.save_pretrained(checkpoint_dir)

        training_info = {
            "checkpoint_name": checkpoint_name,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "base_model": model_path_to_load,
            "trained_samples_count": len(valid_samples),
            "epochs": epochs,
            "batch_size": batch_size,
            "learning_rate": learning_rate,
            "freeze_encoder": freeze_encoder,
            "final_loss": round(epoch_losses[-1], 4) if epoch_losses else 0.0,
            "epoch_losses": [round(l, 4) for l in epoch_losses],
            "total_duration_seconds": round(time.time() - t_start, 2),
            "device": str(device),
        }

        with open(checkpoint_dir / "training_info.json", "w", encoding="utf-8") as f:
            json.dump(training_info, f, indent=2)

        # Update 'latest' folder for future fine-tuning and inference
        if self.latest_model_dir.exists():
            try:
                shutil.rmtree(self.latest_model_dir)
            except Exception as e:
                logger.warning(f"Could not clear latest directory: {str(e)}")

        self.latest_model_dir.mkdir(parents=True, exist_ok=True)
        for item in checkpoint_dir.iterdir():
            if item.is_file():
                shutil.copy2(item, self.latest_model_dir / item.name)

        duration_sec = time.time() - t_start

        if progress_callback:
            progress_callback({
                "status": "completed",
                "message": f"Training completed successfully in {duration_sec:.1f}s! Saved to {checkpoint_name}.",
                "progress": 1.0,
                "summary": training_info,
            })

        logger.info(f"TrOCR Fine-Tuning Completed in {duration_sec:.1f}s. Saved: {checkpoint_dir}")
        return training_info

    def predict_crop(
        self,
        crop_image: Image.Image,
        use_latest: bool = True,
        custom_model_path: Optional[str] = None,
        device_name: str = "auto",
    ) -> Tuple[str, float]:
        """
        Runs TrOCR inference on a single crop using latest fine-tuned checkpoint, custom checkpoint path, or base model.
        """
        res = self.predict_crops_batch(
            [crop_image],
            use_latest=use_latest,
            custom_model_path=custom_model_path,
            batch_size=1,
            device_name=device_name,
        )
        return res[0] if res else ("", 0.0)

    def predict_crops_batch(
        self,
        crop_images: List[Image.Image],
        use_latest: bool = True,
        custom_model_path: Optional[str] = None,
        batch_size: int = 8,
        device_name: str = "auto",
    ) -> List[Tuple[str, float]]:
        """
        Runs fast batched TrOCR inference on multiple crops using latest fine-tuned checkpoint,
        a custom checkpoint path, or the base model.
        """
        if not crop_images:
            return []

        if custom_model_path:
            model_path = custom_model_path
        else:
            latest_path = self.get_latest_checkpoint_path() if use_latest else None
            model_path = str(latest_path) if latest_path else settings.TROCR_MODEL_NAME

        if device_name == "auto":
            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            device = torch.device(device_name if (device_name != "cuda" or torch.cuda.is_available()) else "cpu")

        try:
            processor = TrOCRProcessor.from_pretrained(model_path)
            model = VisionEncoderDecoderModel.from_pretrained(model_path).to(device)
            model.eval()

            results: List[Tuple[str, float]] = []
            for i in range(0, len(crop_images), batch_size):
                batch_slice = crop_images[i:i + batch_size]
                batch_imgs = [img.convert("RGB") for img in batch_slice]
                pixel_values = processor(batch_imgs, return_tensors="pt").pixel_values.to(device)
                with torch.no_grad():
                    if device.type == "cuda":
                        with torch.amp.autocast("cuda"):
                            generated_ids = model.generate(pixel_values, max_new_tokens=48)
                    else:
                        generated_ids = model.generate(pixel_values, max_new_tokens=48)
                batch_texts = processor.batch_decode(generated_ids, skip_special_tokens=True)
                for t in batch_texts:
                    clean_t = t.strip()
                    results.append((clean_t, 0.95 if clean_t else 0.0))

            return results
        except Exception as e:
            logger.error(f"Batch inference error with model {model_path}: {str(e)}")
            return [("", 0.0)] * len(crop_images)
