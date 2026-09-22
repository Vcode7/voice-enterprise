import time
import os
import re
import json
import gc
import struct
import io
import base64
import httpx
from contextlib import contextmanager
from typing import List, Dict, Any, Tuple, Optional, Callable
from PIL import Image
import torch
from transformers import BitsAndBytesConfig, AutoModelForImageTextToText, AutoProcessor, AutoConfig
from transformers.integrations import replace_with_bnb_linear
from accelerate import init_empty_weights
from accelerate.utils import set_module_tensor_to_device
from huggingface_hub import try_to_load_from_cache, hf_hub_download

from app.core.logger import logger
from app.config import settings
from app.models.schemas import (
    HandwritingScanningTemplate,
    HandwritingFieldExtractionResult,
    HandwritingOcrResponse,
)
from app.services.handwriting_extractor import DEFAULT_HANDWRITING_TEMPLATE

OCR_PROMPT = """OCR this image to HTML.

Only use these tags ['br', 'i', 'b', 'u', 'table', 'tr', 'td', 'p', 'th', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'ul', 'ol', 'li', 'span', 'hr', 'tbody', 'thead'], and these attributes ['class', 'colspan', 'rowspan', 'display', 'checked', 'type', 'border', 'value', 'data-bbox', 'data-label'].

Guidelines:
* Tables: Use colspan and rowspan attributes to match table structure.
* Text: join lines together properly into paragraphs using <p>...</p> tags.  Use <br> tags for line breaks within paragraphs, but only when absolutely necessary to maintain meaning.
* Lists: Preserve indents and proper list markers.
* Use the simplest possible HTML structure that accurately represents the content of the block.
* Make sure the text is accurate and easy for a human to read and interpret.  Reading order should be correct and natural.
"""

# Alias for backward compatibility
OCR_LAYOUT_PROMPT = OCR_PROMPT

try:
    from chandra.output import parse_chunks, parse_markdown, parse_layout
except ImportError:
    parse_chunks = None
    parse_markdown = None
    parse_layout = None



class ChandraEngine:
    """
    Dedicated Chandra 2 Handwriting OCR and Structured Document Extraction Engine.

    Key Features:
    1. Quantization (3-bit / 4-bit BitsAndBytes) to fit safely within consumer GPUs (e.g. 6 GB VRAM).
    2. Two Modes:
       - Full Image (Complete OCR): Sends entire document page with native OCR_PROMPT -> clean HTML layout.
         The HTML output is then passed to the LLM model (/structure) for schema/field/table structuring.
       - Detected Region: Uses PaddleOCR to detect fields/bounding boxes, and Chandra 2 to transcribe the crops.
    3. On-Demand VRAM Lifecycle:
       - Model is NOT kept in memory/VRAM when idle.
       - Loaded only when an OCR task starts.
       - Reused across all pages/crops of the active task batch.
       - Immediately unloaded with VRAM freed upon completion or failure.
    4. Comprehensive logging for loading, quantization, inference, unloading, and VRAM metrics.
    """

    _instance: Optional["ChandraEngine"] = None

    def __init__(self):
        self._model = None
        self._processor = None
        self._device = None
        self._model_name = settings.CHANDRA_MODEL_NAME
        self._load_in_4bit = settings.CHANDRA_LOAD_IN_4BIT
        self._quantization = getattr(settings, "CHANDRA_QUANTIZATION", "3-bit") or "3-bit"
        self._active_quantization: Optional[str] = None
        self._determine_device()

    @classmethod
    def get_instance(cls) -> "ChandraEngine":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def is_loaded(self) -> bool:
        return self._model is not None and self._processor is not None

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def quantization(self) -> str:
        return self._active_quantization or self.normalize_quantization(self._quantization)

    @property
    def device_name(self) -> str:
        if torch.cuda.is_available():
            return f"CUDA ({torch.cuda.get_device_name(0)})"
        return str(self._device) if self._device else "CPU"

    @staticmethod
    def normalize_quantization(quant: Optional[str]) -> str:
        if not quant:
            return "3-bit"
        q = str(quant).lower().strip()
        if q in ("3", "3bit", "3-bit"):
            return "3-bit"
        if q in ("4", "4bit", "4-bit"):
            return "4-bit"
        if q in ("8", "8bit", "8-bit"):
            return "8-bit"
        return "3-bit"

    def _determine_device(self):
        """Determines best compute device."""
        if torch.cuda.is_available():
            self._device = torch.device("cuda")
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            self._device = torch.device("mps")
        else:
            self._device = torch.device("cpu")

    @staticmethod
    def get_vram_info() -> Dict[str, float]:
        """Returns currently allocated and reserved GPU memory in MB."""
        if torch.cuda.is_available():
            return {
                "allocated_mb": round(torch.cuda.memory_allocated() / (1024 ** 2), 2),
                "reserved_mb": round(torch.cuda.memory_reserved() / (1024 ** 2), 2),
            }
        return {"allocated_mb": 0.0, "reserved_mb": 0.0}

    def load_model(self, quantization: Optional[str] = None, force_reload: bool = False):
        """
        Loads Chandra 2 model with requested quantization ('3-bit', '4-bit', or '8-bit') into memory on-demand.
        Default is '3-bit' (BitsAndBytes NF4 with double quantization, ~3.2-3.3 bits/weight effective).
        If already loaded with a different quantization level, unloads and reloads with the requested level.
        Logs loading progress and VRAM allocation.
        """
        target_quant = self.normalize_quantization(quantization or self._quantization)

        # If already loaded with the requested quantization level and not forcing reload, reuse
        if self.is_loaded and not force_reload and self._active_quantization == target_quant:
            logger.info(f"[Chandra2] Model '{self._model_name}' ({target_quant}) is already active in memory. Reusing for current task.")
            return

        # If loaded with a different quantization, unload first to free VRAM
        if self.is_loaded:
            logger.info(f"[Chandra2] Model active with '{self._active_quantization}', switching to '{target_quant}'. Unloading previous instance...")
            self.unload_model()

        start_time = time.time()
        vram_before = self.get_vram_info()

        logger.info("=" * 75)
        logger.info(f"[Chandra2] Loading '{self._model_name}' with {target_quant} quantization on {self.device_name}...")
        logger.info(f"[Chandra2] Initial VRAM: Allocated={vram_before['allocated_mb']} MB, Reserved={vram_before['reserved_mb']} MB")

        try:
            if self._device.type == "cuda":
                # Build BitsAndBytesConfig for selected quantization level
                if target_quant == "3-bit":
                    logger.info("[Chandra2] Configuring 3-bit effective BitsAndBytes quantization (NF4 + double quant, float16 compute, ~3.2-3.3 bits/weight)...")
                    bnb_config = BitsAndBytesConfig(
                        load_in_4bit=True,
                        bnb_4bit_compute_dtype=torch.float16,
                        bnb_4bit_quant_type="nf4",
                        bnb_4bit_use_double_quant=True,
                    )
                elif target_quant == "4-bit":
                    logger.info("[Chandra2] Configuring 4-bit BitsAndBytes quantization (NF4 single quant, float16 compute)...")
                    bnb_config = BitsAndBytesConfig(
                        load_in_4bit=True,
                        bnb_4bit_compute_dtype=torch.float16,
                        bnb_4bit_quant_type="nf4",
                        bnb_4bit_use_double_quant=False,
                    )
                elif target_quant == "8-bit":
                    logger.info("[Chandra2] Configuring 8-bit BitsAndBytes quantization (LLM.int8, threshold=6.0)...")
                    bnb_config = BitsAndBytesConfig(
                        load_in_8bit=True,
                        llm_int8_threshold=6.0,
                        llm_int8_has_fp16_weight=False,
                    )
                else:
                    logger.info(f"[Chandra2] Unknown quantization '{target_quant}', falling back to 3-bit...")
                    target_quant = "3-bit"
                    bnb_config = BitsAndBytesConfig(
                        load_in_4bit=True,
                        bnb_4bit_compute_dtype=torch.float16,
                        bnb_4bit_quant_type="nf4",
                        bnb_4bit_use_double_quant=True,
                    )

                # Locate cached weights or download if not present
                safetensors_path = try_to_load_from_cache(self._model_name, "model.safetensors")
                if not safetensors_path or not os.path.exists(safetensors_path):
                    logger.info(f"[Chandra2] Resolving/downloading 'model.safetensors' for '{self._model_name}'...")
                    safetensors_path = hf_hub_download(repo_id=self._model_name, filename="model.safetensors")

                # Instantiate empty model structure on meta device
                logger.info(f"[Chandra2] Loading config and instantiating empty structure for '{self._model_name}'...")
                config = AutoConfig.from_pretrained(self._model_name)
                with init_empty_weights():
                    self._model = AutoModelForImageTextToText.from_config(config)

                # Replace linear layers with quantized modules
                logger.info(f"[Chandra2] Quantizing linear layers with {target_quant} BitsAndBytes modules...")
                self._model = replace_with_bnb_linear(self._model, quantization_config=bnb_config)

                # Stream weights tensor-by-tensor directly to GPU using binary seek/read
                # to avoid Windows memory-mapping commit limit exhaustion (Error 1455) and 0xC0000005 crash
                logger.info(f"[Chandra2] Streaming weights directly to GPU via binary seek from {os.path.basename(safetensors_path)}...")
                dtype_map = {
                    "BF16": torch.bfloat16,
                    "F16": torch.float16,
                    "F32": torch.float32,
                    "I32": torch.int32,
                    "I64": torch.int64,
                    "U8": torch.uint8,
                    "BOOL": torch.bool,
                }
                with open(safetensors_path, "rb") as f:
                    header_len = struct.unpack("<Q", f.read(8))[0]
                    header = json.loads(f.read(header_len).decode("utf-8"))
                    keys = [k for k in header.keys() if k != "__metadata__"]
                    total_keys = len(keys)
                    base_offset = 8 + header_len

                    for i, k in enumerate(keys):
                        info = header[k]
                        start, end = info["data_offsets"]
                        f.seek(base_offset + start)
                        raw = f.read(end - start)
                        dtype = dtype_map.get(info["dtype"], torch.float32)
                        tensor = torch.frombuffer(bytearray(raw), dtype=dtype).reshape(info["shape"])
                        del raw
                        try:
                            set_module_tensor_to_device(self._model, k, device="cuda:0", value=tensor)
                        except (AttributeError, ValueError):
                            # Skip auxiliary/speculative decoding heads (e.g. MTP) not in the model
                            pass
                        del tensor
                        if (i + 1) % 150 == 0 or (i + 1) == total_keys:
                            vram_curr = self.get_vram_info()["allocated_mb"]
                            logger.info(f"[Chandra2] Streamed {i + 1}/{total_keys} tensors. GPU Allocated: {vram_curr:.1f} MB")

                # For 8-bit quantization: ensure all Linear8bitLt weights are wrapped as Int8Params
                if target_quant == "8-bit":
                    logger.info("[Chandra2] Finalizing 8-bit Int8Params on GPU modules...")
                    for m in self._model.modules():
                        if isinstance(m, bnb.nn.Linear8bitLt) and hasattr(m, "weight") and m.weight is not None:
                            if not isinstance(m.weight, bnb.nn.Int8Params):
                                m.weight = bnb.nn.Int8Params(m.weight.data, has_fp16_weights=False, requires_grad=False).to(self._device)

                self._active_quantization = target_quant
            else:
                logger.info(f"[Chandra2] Loading model without quantization on {self._device}...")
                self._model = AutoModelForImageTextToText.from_pretrained(
                    self._model_name,
                    torch_dtype=torch.float16 if self._device.type == "cuda" else torch.float32,
                    device_map="auto" if self._device.type == "cuda" else None,
                    low_cpu_mem_usage=True,
                )
                if self._device.type != "cuda":
                    self._model = self._model.to(self._device)
                self._active_quantization = "none"

            # Ensure all non-parameter buffers (e.g. rotary position embedding inv_freq) are on compute device
            for m in self._model.modules():
                for name, buf in m.named_buffers(recurse=False):
                    if buf is not None and buf.device != self._device:
                        setattr(m, name, buf.to(self._device))

            self._model.eval()

            # 2. Load Processor
            logger.info(f"[Chandra2] Loading AutoProcessor for '{self._model_name}'...")
            self._processor = AutoProcessor.from_pretrained(self._model_name)
            if hasattr(self._processor, "tokenizer") and self._processor.tokenizer:
                self._processor.tokenizer.padding_side = "left"

            elapsed = time.time() - start_time
            vram_after = self.get_vram_info()
            used_mb = max(0.0, vram_after["allocated_mb"] - vram_before["allocated_mb"])

            logger.info(
                f"[Chandra2] Successfully loaded in {elapsed:.2f}s ({self._active_quantization})! "
                f"VRAM Allocated: {vram_after['allocated_mb']} MB (+{used_mb:.1f} MB), "
                f"Reserved: {vram_after['reserved_mb']} MB"
            )
            logger.info("=" * 75)

        except Exception as e:
            logger.error(f"[Chandra2] Failed to load model '{self._model_name}': {str(e)}", exc_info=True)
            self.unload_model()
            raise RuntimeError(f"Chandra 2 model loading failed: {str(e)}")

    def unload_model(self):
        """
        Immediately unloads Chandra 2 model and processor from memory/GPU and releases VRAM.
        Guarantees zero VRAM is held when idle.
        """
        if self._model is None and self._processor is None:
            return

        vram_before = self.get_vram_info()
        logger.info(f"[Chandra2] Unloading '{self._model_name}' ({self._active_quantization or self._quantization}) from VRAM and reclaiming memory...")

        if self._model is not None:
            del self._model
            self._model = None
        if self._processor is not None:
            del self._processor
            self._processor = None
        self._active_quantization = None

        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            if hasattr(torch.cuda, "ipc_collect"):
                torch.cuda.ipc_collect()

        vram_after = self.get_vram_info()
        freed_mb = max(0.0, vram_before["allocated_mb"] - vram_after["allocated_mb"])
        logger.info(
            f"[Chandra2] Unload complete & VRAM released. Freed ~{freed_mb:.1f} MB "
            f"(Current GPU Allocated: {vram_after['allocated_mb']} MB, Reserved: {vram_after['reserved_mb']} MB)"
        )

    @contextmanager
    def session(self, quantization: Optional[str] = None):
        """
        Context manager ensuring Chandra 2 is loaded for the task and immediately unloaded upon completion/failure.
        """
        try:
            self.load_model(quantization=quantization)
            yield self
        finally:
            self.unload_model()

    # -----------------------------------------------------------------------
    # JSON Parsing & Schema Validation Utilities
    # -----------------------------------------------------------------------
    @staticmethod
    def _clean_and_parse_json(raw_text: str) -> Optional[Any]:
        """Robustly extracts and parses JSON (objects or arrays) from model generation output."""
        if not raw_text:
            return None

        text = raw_text.strip()

        # 1. Remove markdown code fences if present
        fence_match = re.search(r"```(?:json)?\s*([\{\[].*?[\}\]])\s*```", text, re.DOTALL)
        if fence_match:
            candidate = fence_match.group(1).strip()
            try:
                return json.loads(candidate)
            except Exception:
                pass

        # 2. Extract outermost matching braces or brackets
        json_match = re.search(r"([\{\[].*[\}\]])", text, re.DOTALL)
        if json_match:
            candidate = json_match.group(1).strip()
            cleaned = re.sub(r",\s*([\}\]])", r"\1", candidate)
            try:
                return json.loads(cleaned)
            except Exception:
                pass

        # 3. Direct parse attempt
        try:
            return json.loads(text)
        except Exception:
            pass

        return None



    def _run_page_inference(
        self,
        image_pil: Image.Image,
        prompt: str,
        max_new_tokens: int = 1856,
    ) -> Tuple[str, float]:
        """Performs a single inference pass with the given prompt and image with comprehensive step tracing."""
        start_t = time.time()
        logger.info(
            f"[Chandra2-Inference] >>> Starting inference pass | Image size: {image_pil.size} (mode: {image_pil.mode}) | "
            f"Prompt length: {len(prompt)} chars | max_new_tokens: {max_new_tokens} | Device: {self._device}"
        )
        vram_start = self.get_vram_info()
        logger.info(f"[Chandra2-Inference] Pre-inference VRAM: Allocated={vram_start['allocated_mb']} MB, Reserved={vram_start['reserved_mb']} MB")

        try:
            # 1. Prepare chat conversation
            logger.info("[Chandra2-Inference] [Step 1/5] Formatting chat conversation payload...")
            conv = [
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "image": image_pil.convert("RGB")},
                        {"type": "text", "text": prompt},
                    ],
                }
            ]

            # 2. Apply chat template and tokenize
            logger.info("[Chandra2-Inference] [Step 2/5] Applying processor chat template & image tokenization...")
            t_proc_start = time.time()
            inputs = self._processor.apply_chat_template(
                conv,
                tokenize=True,
                add_generation_prompt=True,
                return_dict=True,
                return_tensors="pt",
            )
            t_proc_ms = (time.time() - t_proc_start) * 1000.0
            input_keys = list(inputs.keys())
            input_ids_len = inputs["input_ids"].shape[1] if "input_ids" in inputs else 0
            logger.info(
                f"[Chandra2-Inference] [Step 2/5] Processor completed in {t_proc_ms:.1f}ms | Input keys: {input_keys} | "
                f"Prompt input_ids tokens: {input_ids_len}"
            )

            # 3. Move inputs to compute device
            logger.info(f"[Chandra2-Inference] [Step 3/5] Transferring input tensors to device '{self._device}'...")
            device_inputs = {}
            for k, v in inputs.items():
                if isinstance(v, torch.Tensor):
                    device_inputs[k] = v.to(self._device)
                    logger.debug(f"  Tensor '{k}': shape={v.shape}, dtype={v.dtype}, device={device_inputs[k].device}")
                else:
                    device_inputs[k] = v

            # 4. Resolve EOS tokens
            logger.info("[Chandra2-Inference] [Step 4/5] Resolving generation stop/EOS token IDs...")
            eos_ids = [self._processor.tokenizer.eos_token_id]
            if hasattr(self._processor.tokenizer, "convert_tokens_to_ids"):
                for t_name in ["<|im_end|>", "<|endoftext|>"]:
                    t_id = self._processor.tokenizer.convert_tokens_to_ids(t_name)
                    if t_id is not None and t_id not in eos_ids:
                        eos_ids.append(t_id)
            logger.info(f"[Chandra2-Inference] Active EOS token IDs: {eos_ids}")

            # 5. Model Generation
            vram_pre_gen = self.get_vram_info()
            logger.info(
                f"[Chandra2-Inference] [Step 5/5] Invoking model.generate() with {input_ids_len} input tokens | "
                f"max_new_tokens={max_new_tokens} | VRAM Allocated: {vram_pre_gen['allocated_mb']} MB, Reserved: {vram_pre_gen['reserved_mb']} MB..."
            )

            t_gen_start = time.time()
            with torch.no_grad():
                output_ids = self._model.generate(
                    **device_inputs,
                    max_new_tokens=max_new_tokens,
                    eos_token_id=eos_ids,
                    do_sample=False,
                )
            t_gen_ms = (time.time() - t_gen_start) * 1000.0
            vram_post_gen = self.get_vram_info()

            in_len = device_inputs["input_ids"].shape[1]
            gen_tokens = output_ids[0][in_len:]
            gen_count = len(gen_tokens)
            tok_per_sec = (gen_count / (t_gen_ms / 1000.0)) if t_gen_ms > 0 else 0.0

            logger.info(
                f"[Chandra2-Inference] [Step 5/5] Generation finished in {t_gen_ms:.1f}ms | Generated {gen_count} tokens "
                f"({tok_per_sec:.1f} tok/s) | Post-generation VRAM Allocated: {vram_post_gen['allocated_mb']} MB"
            )

            # 6. Decode output tokens
            logger.info("[Chandra2-Inference] Decoding generated tokens into text...")
            raw_output = self._processor.decode(gen_tokens, skip_special_tokens=True).strip()
            total_elapsed_ms = (time.time() - start_t) * 1000.0
            logger.info(f"[Chandra2-Inference] <<< Completed inference in {total_elapsed_ms:.1f}ms | Output text length: {len(raw_output)} chars")

            return raw_output, total_elapsed_ms

        except torch.cuda.OutOfMemoryError as oom:
            logger.critical(
                f"[Chandra2-Inference] CUDA OUT OF MEMORY during model.generate(): {str(oom)}",
                exc_info=True,
            )
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            raise RuntimeError(f"Chandra 2 GPU Out of Memory: {str(oom)}") from oom
        except Exception as exc:
            logger.critical(
                f"[Chandra2-Inference] Exception during inference ({type(exc).__name__}): {str(exc)}",
                exc_info=True,
            )
            raise

    # -----------------------------------------------------------------------
    # OLLAMA VISION OCR INFERENCE
    # -----------------------------------------------------------------------

    def infer_ollama(
        self,
        image_pil: Image.Image,
        prompt: str,
        model_name: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> Tuple[str, float]:
        """
        Sends the same image input and prompt to a Chandra Ollama vision model via the Ollama API.
        Does not load PyTorch or consume local Transformers GPU VRAM.
        """
        start_t = time.time()
        target_model = (model_name or getattr(settings, "CHANDRA_OLLAMA_MODEL", "chandra") or "chandra").strip()
        target_url = (base_url or getattr(settings, "OLLAMA_BASE_URL", "http://127.0.0.1:11434")).strip().rstrip("/")
        timeout_sec = float(timeout or getattr(settings, "CHANDRA_OLLAMA_TIMEOUT", 5000.0) or 5000.0)

        logger.info(
            f"[Chandra2-Ollama] Starting inference pass via Ollama API | Model: '{target_model}' | "
            f"Endpoint: {target_url} | Image size: {image_pil.size} | Prompt length: {len(prompt)} chars"
        )

        # 1. Scale and prepare base64 image (same scaling as local inference)
        proc_img = image_pil.convert("RGB")
        max_dim = 1800
        w, h = proc_img.size
        if max(w, h) > max_dim:
            scale = max_dim / float(max(w, h))
            proc_img = proc_img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)

        buf = io.BytesIO()
        proc_img.save(buf, format="JPEG", quality=95)
        img_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        # 2. Prepare request payload and options
        max_tokens = int(getattr(settings, "CHANDRA_MAX_NEW_TOKENS", 1856) or 1856)
        ctx_size = int(getattr(settings, "CHANDRA_NUM_CTX", 8192) or 8192)
        disable_thinking = bool(getattr(settings, "CHANDRA_DISABLE_THINKING", True))

        ollama_options = {
            "num_predict": max_tokens,
            "num_ctx": ctx_size,
            "temperature": 0.1,
        }

        # Explicitly log the final Ollama options being sent so num_predict and num_ctx can be verified
        logger.info(
            f"[Chandra2-Ollama] Final Ollama options: num_predict={ollama_options['num_predict']}, "
            f"num_ctx={ollama_options['num_ctx']}, temperature={ollama_options['temperature']}, "
            f"think={not disable_thinking}"
        )

        chat_payload = {
            "model": target_model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                    "images": [img_b64],
                }
            ],
            "stream": False,
            "think": not disable_thinking,
            "options": ollama_options,
        }

        # 3. Call Ollama API with explicit error handling
        raw_output = ""
        try:
            with httpx.Client(timeout=timeout_sec) as client:
                logger.info(
                    f"[Chandra2-Ollama] Sending POST {target_url}/api/chat (model='{target_model}', "
                    f"num_predict={ollama_options['num_predict']}, num_ctx={ollama_options['num_ctx']}, "
                    f"think={not disable_thinking})..."
                )
                res = client.post(f"{target_url}/api/chat", json=chat_payload)

                if res.status_code == 404:
                    err_msg = res.text
                    raise RuntimeError(
                        f"Ollama model '{target_model}' was not found on server {target_url}. "
                        f"Please run 'ollama pull {target_model}' or verify model name in settings. (Details: {err_msg})"
                    )

                if res.status_code != 200:
                    # Fallback to /api/generate
                    logger.info(
                        f"[Chandra2-Ollama] /api/chat returned HTTP {res.status_code}, "
                        f"trying /api/generate fallback (num_predict={ollama_options['num_predict']}, num_ctx={ollama_options['num_ctx']})..."
                    )
                    gen_payload = {
                        "model": target_model,
                        "prompt": prompt,
                        "images": [img_b64],
                        "stream": False,
                        "think": not disable_thinking,
                        "options": ollama_options,
                    }
                    gen_res = client.post(f"{target_url}/api/generate", json=gen_payload)
                    if gen_res.status_code == 200:
                        raw_output = gen_res.json().get("response", "").strip()
                    else:
                        raise RuntimeError(
                            f"Ollama API returned HTTP {res.status_code}: {res.text}"
                        )
                else:
                    data = res.json()
                    msg = data.get("message", {})
                    raw_output = msg.get("content", "").strip()
                    thinking_output = msg.get("thinking", "").strip()
                    if not raw_output and thinking_output:
                        logger.warning(
                            f"[Chandra2-Ollama] Warning: Content field was empty but {len(thinking_output)} characters of "
                            f"thinking were generated. Output tokens may have been consumed by reasoning block."
                        )

        except httpx.ConnectError as conn_err:
            logger.error(f"[Chandra2-Ollama] Connection error to {target_url}: {conn_err}")
            raise RuntimeError(
                f"Could not connect to Ollama server at {target_url}. "
                f"Please ensure Ollama is installed and running ('ollama serve')."
            ) from conn_err
        except httpx.ReadTimeout as timeout_err:
            logger.error(f"[Chandra2-Ollama] Request timed out after {timeout_sec}s: {timeout_err}")
            raise RuntimeError(
                f"Ollama OCR inference timed out after {timeout_sec}s for model '{target_model}'. "
                f"The model may still be loading or system is under heavy load."
            ) from timeout_err
        except Exception as exc:
            if isinstance(exc, RuntimeError):
                raise
            logger.error(f"[Chandra2-Ollama] Unexpected error during inference: {exc}", exc_info=True)
            raise RuntimeError(f"Ollama OCR failed: {str(exc)}") from exc

        # 4. Clean outer markdown code blocks and reasoning/thinking blocks if present
        clean_text = raw_output or ""
        # Strip any thinking / reasoning tags if leaked into output
        clean_text = re.sub(r"<think>[\s\S]*?</think>", "", clean_text, flags=re.DOTALL).strip()
        clean_text = re.sub(r"<thought>[\s\S]*?</thought>", "", clean_text, flags=re.DOTALL).strip()

        if clean_text.startswith("```"):
            lines = clean_text.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            clean_text = "\n".join(lines).strip()

        total_elapsed_ms = (time.time() - start_t) * 1000.0
        logger.info(
            f"[Chandra2-Ollama] <<< Finished Ollama inference in {total_elapsed_ms:.1f}ms | "
            f"Output text length: {len(clean_text)} chars"
        )
        return clean_text, total_elapsed_ms

    # -----------------------------------------------------------------------
    # MODE 1: Full Image OCR (Complete OCR -> HTML via OCR_PROMPT)
    # -----------------------------------------------------------------------

    def extract_full_image(
        self,
        image_pil: Image.Image,
        template: Optional[HandwritingScanningTemplate] = None,
        loading_method: str = "local",
        ollama_model: Optional[str] = None,
    ) -> HandwritingOcrResponse:
        """
        Mode 1 (Full Image OCR):
        Processes the complete image with Chandra 2 using the native layout OCR prompt.
        Supports both Local (Transformers/PyTorch) and Ollama API loading methods.
        Returns identical HandwritingOcrResponse structure.
        """
        start_time = time.time()
        active_template = template or DEFAULT_HANDWRITING_TEMPLATE
        is_ollama = (loading_method or "local").strip().lower() == "ollama"

        proc_img = image_pil.convert("RGB")

        # Scale image if too large for inference memory safety (preserving aspect ratio)
        max_dim = 1800
        w, h = proc_img.size
        if max(w, h) > max_dim:
            scale = max_dim / float(max(w, h))
            proc_img = proc_img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)

        if is_ollama:
            resolved_ollama_model = (
                ollama_model or getattr(settings, "CHANDRA_OLLAMA_MODEL", "chandra") or "chandra"
            ).strip()
            logger.info(
                f"[Chandra2-FullImage] Running via Ollama (model='{resolved_ollama_model}') with OCR_PROMPT..."
            )
            raw_output, duration_ms = self.infer_ollama(
                proc_img,
                OCR_PROMPT,
                model_name=resolved_ollama_model,
            )
            device_label = f"ollama ({resolved_ollama_model})"
        else:
            # Local Chandra 2 execution (exact existing behavior)
            logger.info(
                f"[Chandra2-FullImage] Starting complete image layout OCR with Chandra 2 (Local)..."
            )
            max_tokens = int(getattr(settings, "CHANDRA_MAX_NEW_TOKENS", 1856) or 1856)
            logger.info(f"[Chandra2-FullImage] Prompting Chandra 2 with OCR_PROMPT (max_new_tokens={max_tokens})...")
            raw_output, duration_ms = self._run_page_inference(
                proc_img,
                OCR_PROMPT,
                max_new_tokens=max_tokens,
            )
            device_label = self.device_name

        logger.info(f"[Chandra2-FullImage] Finished inference in {duration_ms:.1f}ms. Output length: {len(raw_output)} chars.")

        # Parse layout blocks if present
        layout_chunks = []
        if parse_chunks is not None:
            try:
                layout_chunks = parse_chunks(raw_output, proc_img)
                logger.info(f"[Chandra2-FullImage] Parsed {len(layout_chunks)} layout blocks from Chandra output.")
            except Exception as e:
                logger.warning(f"[Chandra2-FullImage] Layout chunks parsing warning: {str(e)}")

        total_duration = (time.time() - start_time) * 1000.0

        return HandwritingOcrResponse(
            success=True,
            filename=None,
            template_name=active_template.name if active_template else "Chandra 2 OCR",
            fields=[],
            field_values={},
            table_headers=[c.column_name for c in active_template.table_columns] if active_template else [],
            table_rows=[],
            tables=[],
            structured_text=raw_output,
            raw_text=raw_output,
            total_pages=1,
            processing_time_ms=round(total_duration, 2),
            device=device_label,
            page_results=layout_chunks,
        )

    # -----------------------------------------------------------------------
    # MODE 2: Detected Region Crop Inference
    # -----------------------------------------------------------------------
    def infer_crop_batch(
        self,
        crop_images: List[Image.Image],
        field_labels: Optional[List[str]] = None,
    ) -> List[str]:
        """
        Mode 2 (Detected Region Helper):
        Runs Chandra 2 inference on a batch of cropped handwritten regions.
        Prompts Chandra 2 for clean structured extraction of each crop.
        """
        if not crop_images:
            return []

        results: List[str] = []
        batch_size = max(1, settings.BATCH_SIZE)

        for idx in range(0, len(crop_images), batch_size):
            batch_slice = crop_images[idx : idx + batch_size]
            label_slice = (field_labels[idx : idx + batch_size]) if field_labels else [None] * len(batch_slice)

            for crop_img, label_hint in zip(batch_slice, label_slice):
                if crop_img.width < 5 or crop_img.height < 5:
                    results.append("")
                    continue

                # Ensure minimum dimensions for vision attention layers
                min_side = min(crop_img.width, crop_img.height)
                if min_side < 32:
                    scale = 32.0 / float(min_side)
                    proc_crop = crop_img.resize(
                        (max(16, int(crop_img.width * scale)), max(16, int(crop_img.height * scale))),
                        Image.Resampling.LANCZOS,
                    )
                else:
                    proc_crop = crop_img

                hint_text = f" for field '{label_hint}'" if label_hint else ""
                prompt = (
                    f"Transcribe all handwritten and printed characters in this cropped region{hint_text}.\n"
                    "Return clean, valid JSON strictly conforming to this schema:\n"
                    "{\"text\": \"<extracted value>\"}\n"
                    "Output ONLY the raw JSON object, without formatting backticks or explanation."
                )

                conv = [
                    {
                        "role": "user",
                        "content": [
                            {"type": "image", "image": proc_crop.convert("RGB")},
                            {"type": "text", "text": prompt},
                        ],
                    }
                ]

                try:
                    inputs = self._processor.apply_chat_template(
                        conv,
                        tokenize=True,
                        add_generation_prompt=True,
                        return_dict=True,
                        return_tensors="pt",
                    )
                    inputs = {k: v.to(self._device) if isinstance(v, torch.Tensor) else v for k, v in inputs.items()}

                    eos_ids = [self._processor.tokenizer.eos_token_id]
                    if hasattr(self._processor.tokenizer, "convert_tokens_to_ids"):
                        for t_name in ["<|im_end|>", "<|endoftext|>"]:
                            t_id = self._processor.tokenizer.convert_tokens_to_ids(t_name)
                            if t_id is not None and t_id not in eos_ids:
                                eos_ids.append(t_id)

                    with torch.no_grad():
                        out = self._model.generate(
                            **inputs,
                            max_new_tokens=64,
                            eos_token_id=eos_ids,
                            do_sample=False,
                        )

                    in_len = inputs["input_ids"].shape[1]
                    raw_text = self._processor.decode(out[0][in_len:], skip_special_tokens=True).strip()

                    parsed = self._clean_and_parse_json(raw_text)
                    extracted_val = ""
                    if isinstance(parsed, list) and len(parsed) > 0 and isinstance(parsed[0], dict) and "text" in parsed[0]:
                        extracted_val = str(parsed[0]["text"]).strip()
                    elif isinstance(parsed, dict) and "text" in parsed:
                        extracted_val = str(parsed["text"]).strip()
                    else:
                        m = re.search(r'"text"\s*:\s*"([^"]*)"', raw_text)
                        if m:
                            extracted_val = m.group(1).strip()
                        else:
                            cleaned = re.sub(r"<think>.*?</think>", "", raw_text, flags=re.DOTALL)
                            cleaned = re.sub(r'[\{\}\[\]"\'\n\r:]', " ", cleaned).strip()
                            extracted_val = cleaned

                    results.append(extracted_val)
                except Exception as e:
                    logger.error(f"[Chandra2-Crop] Crop inference error: {str(e)}")
                    results.append("")

        return results


def get_chandra_engine() -> ChandraEngine:
    """Returns the singleton instance of ChandraEngine."""
    return ChandraEngine.get_instance()
