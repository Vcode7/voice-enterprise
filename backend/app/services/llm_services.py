import os
import io
import re
import time
import json
import base64
import httpx
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime

from app.config import settings
from app.core.logger import logger
from app.db.repositories import SettingsRepo, LookupTablesRepo, HandwritingTemplatesRepo, OcrResultsRepo
from app.db.defaults import DEFAULT_HANDWRITING_SCANNING_TEMPLATE
from app.utils.json_parser import clean_and_parse_json, normalize_numeric_field_value
from app.utils.html_cleaner import clean_html_to_text


# --------------------------------------------------------------------------
# Ollama Local LLM Service (Local Inference with Qwen > Gemma Priority)
# --------------------------------------------------------------------------
class OllamaLLMService:
    """
    Dedicated service for local LLM inference via Ollama.
    Enforces strict Model Selection Priority:
      1. Qwen — highest priority.
      2. Gemma — use only if a Qwen model is not available.
    Strict constraint: Do not use any other models or providers.
    """
    DEFAULT_BASE_URL = getattr(settings, "OLLAMA_BASE_URL", "http://127.0.0.1:11434")

    @classmethod
    def get_base_url(cls) -> str:
        app_settings = SettingsRepo.get()
        custom_url = (
            app_settings.get("ollamaBaseUrl")
            or os.environ.get("OLLAMA_BASE_URL")
            or cls.DEFAULT_BASE_URL
        )
        return str(custom_url).rstrip("/")

    @classmethod
    async def get_available_models(cls, base_url: Optional[str] = None) -> List[str]:
        b_url = (base_url or cls.get_base_url()).rstrip("/")
        tags_url = f"{b_url}/api/tags"
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.get(tags_url)
                if res.status_code == 200:
                    models = res.json().get("models", [])
                    return [m["name"] for m in models if "name" in m]
        except Exception as e:
            logger.warning(f"[Ollama LLM] Could not query models at {tags_url}: {e}")
        return []

    @classmethod
    async def resolve_model(cls, base_url: Optional[str] = None) -> Tuple[str, str]:
        """
        Model Selection Priority:
        1. Qwen — highest priority.
        2. Gemma — use only if a Qwen model is not available.
        Do not use any other models or providers.
        Returns: (model_name, model_family)
        """
        available = await cls.get_available_models(base_url)
        logger.info(f"[Ollama LLM] Available Ollama models: {available}")

        # 1. Qwen — highest priority (excluding OCR vision model like chandra)
        qwen_models = [m for m in available if "qwen" in m.lower() and "chandra" not in m.lower()]
        if qwen_models:
            preferred_qwen = next((m for m in qwen_models if "qwen2.5" in m.lower()), qwen_models[0])
            logger.info(f"[Ollama LLM] Priority 1 Selected: Qwen model '{preferred_qwen}'")
            return preferred_qwen, "qwen"

        # 2. Gemma — use only if a Qwen model is not available
        gemma_models = [m for m in available if "gemma" in m.lower()]
        if gemma_models:
            preferred_gemma = next((m for m in gemma_models if "gemma2" in m.lower() or "gemma-4" in m.lower()), gemma_models[0])
            logger.info(f"[Ollama LLM] Priority 2 Selected: Gemma model '{preferred_gemma}' (Qwen not available)")
            return preferred_gemma, "gemma"

        # 3. Default if neither Qwen nor Gemma is found in local tags
        logger.info("[Ollama LLM] Neither Qwen nor Gemma found in Ollama tags; defaulting to 'qwen2.5:7b'")
        return "qwen2.5:7b", "qwen"

    @classmethod
    async def execute_chat(
        cls,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.0,
        max_tokens: int = 8192,
        response_format: Optional[Dict[str, str]] = None,
        base_url: Optional[str] = None,
    ) -> str:
        resolved_model, family = await cls.resolve_model(base_url)
        chosen_model = model or resolved_model
        b_url = (base_url or cls.get_base_url()).rstrip("/")
        chat_url = f"{b_url}/api/chat"

        logger.info(f"[Ollama LLM] Dispatching chat request to {chat_url} | Model: '{chosen_model}' ({family.upper()})")

        payload: Dict[str, Any] = {
            "model": chosen_model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        if response_format and response_format.get("type") == "json_object":
            payload["format"] = "json"

        start_t = time.time()
        async with httpx.AsyncClient(timeout=300.0) as client:
            try:
                res = await client.post(chat_url, json=payload)
            except Exception as net_err:
                logger.error(f"[Ollama LLM] Failed to connect to {chat_url}: {net_err}")
                raise RuntimeError(
                    f"Ollama local LLM connection failed: {net_err}. "
                    f"Please ensure Ollama is running at {b_url} and a Qwen or Gemma model is downloaded."
                )

            elapsed_ms = (time.time() - start_t) * 1000.0

            if res.status_code == 200:
                data = res.json()
                content = data.get("message", {}).get("content", "")
                logger.info(
                    f"[Ollama LLM] Success in {elapsed_ms:.1f}ms | Model: '{chosen_model}' | "
                    f"Length: {len(content)} chars"
                )
                return content
            else:
                err_text = res.text
                logger.error(f"[Ollama LLM] API error ({res.status_code}): {err_text}")
                raise RuntimeError(f"Ollama API error ({res.status_code}): {err_text}")


# --------------------------------------------------------------------------
# Groq LLM & Whisper Service (with Automatic Detection & Ollama Failover)
# --------------------------------------------------------------------------
class GroqService:
    GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
    GROQ_AUDIO_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
    DEFAULT_LLM_MODEL = "openai/gpt-oss-120b"
    FALLBACK_LLM_MODEL = "openai/gpt-oss-20b"
    WHISPER_MODEL = "whisper-large-v3"

    @classmethod
    def get_all_keys(cls, custom_override: Optional[str] = None) -> List[Dict[str, str]]:
        keys: List[Dict[str, str]] = []
        seen = set()

        def add_key(val: Optional[str], label: str):
            if not val:
                return
            trimmed = val.strip()
            if trimmed and "your_groq" not in trimmed and "your_fallback" not in trimmed and trimmed not in seen:
                seen.add(trimmed)
                keys.append({"key": trimmed, "label": label})

        # Base primary key
        add_key(os.environ.get("GROQ_API_KEY") or settings.GROQ_API_KEY, "Base Primary .env Key")

        # Fallbacks 1 to 10
        for i in range(1, 11):
            env_val = os.environ.get(f"GROQ_API_KEY_FALLBACK{i}")
            if env_val:
                add_key(env_val, f".env Fallback Key #{i}")

        # SQLite settings custom key
        app_settings = SettingsRepo.get()
        custom_key = custom_override or app_settings.get("customGroqApiKey")
        add_key(custom_key, "User Settings Key")

        return keys

    @classmethod
    def has_groq_key(cls, custom_override: Optional[str] = None) -> bool:
        """
        Automatically detects whether a valid Groq API key is available.
        """
        return len(cls.get_all_keys(custom_override)) > 0

    @classmethod
    def get_key_status(cls) -> Dict[str, Any]:
        keys = cls.get_all_keys()
        env_key = os.environ.get("GROQ_API_KEY") or settings.GROQ_API_KEY
        has_env_key = bool(env_key and env_key.strip() and "your_groq" not in env_key)
        app_settings = SettingsRepo.get()
        custom_key = app_settings.get("customGroqApiKey", "").strip()
        has_custom_key = bool(custom_key)

        active_type = "none"
        if keys:
            active_type = "primary_env" if has_env_key else "backup_custom"

        return {
            "hasEnvKey": has_env_key,
            "hasCustomKey": has_custom_key,
            "isConfigured": len(keys) > 0,
            "activeKeyType": active_type,
            "totalConfiguredKeys": len(keys),
            "keyLabels": [k["label"] for k in keys],
            "activeBackend": "groq" if len(keys) > 0 else "ollama",
        }

    @classmethod
    async def execute_chat_with_failover(
        cls,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.0,
        max_tokens: int = 8192,
        response_format: Optional[Dict[str, str]] = None,
        custom_key: Optional[str] = None,
    ) -> str:
        keys = cls.get_all_keys(custom_key)

        # 1. Automatic Detection: If no Groq API key is found, automatically fall back to Ollama
        if not keys:
            logger.info("[LLM Backend] No Groq API key configured. Automatically selecting Ollama for local LLM inference.")
            return await OllamaLLMService.execute_chat(
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format=response_format,
            )

        # 2. If a Groq API key is configured, use the configured Groq model
        chosen_model = model or cls.DEFAULT_LLM_MODEL
        logger.info(f"[LLM Backend] Groq API key detected ({len(keys)} key(s)). Using configured Groq model: '{chosen_model}'")
        last_err: Optional[Exception] = None

        async with httpx.AsyncClient(timeout=90.0) as client:
            for entry in keys:
                api_key = entry["key"]
                label = entry["label"]
                try:
                    payload: Dict[str, Any] = {
                        "model": chosen_model,
                        "messages": messages,
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                    }
                    if response_format:
                        payload["response_format"] = response_format

                    start_t = time.time()
                    res = await client.post(
                        cls.GROQ_API_URL,
                        headers={
                            "Authorization": f"Bearer {api_key}",
                            "Content-Type": "application/json",
                        },
                        json=payload,
                    )
                    elapsed_ms = (time.time() - start_t) * 1000.0

                    if res.status_code == 200:
                        data = res.json()
                        out_content = data["choices"][0]["message"]["content"]
                        logger.info(
                            f"[Groq LLM] Success in {elapsed_ms:.1f}ms | Model: {payload['model']} | "
                            f"Key: '{label}' | Response length: {len(out_content)} chars"
                        )
                        return out_content

                    err_text = res.text
                    if res.status_code == 429 or "rate_limit" in err_text.lower():
                        logger.warning(f"[Groq Failover] Key '{label}' hit rate limit (429). Trying next key...")
                        continue

                    # If model not found or context error, try with FALLBACK_LLM_MODEL
                    if chosen_model != cls.FALLBACK_LLM_MODEL:
                        logger.warning(f"[Groq Failover] Retrying with {cls.FALLBACK_LLM_MODEL}...")
                        payload["model"] = cls.FALLBACK_LLM_MODEL
                        payload["max_tokens"] = max_tokens
                        res_retry = await client.post(
                            cls.GROQ_API_URL,
                            headers={
                                "Authorization": f"Bearer {api_key}",
                                "Content-Type": "application/json",
                            },
                            json=payload,
                        )
                        if res_retry.status_code == 200:
                            data = res_retry.json()
                            out_content = data["choices"][0]["message"]["content"]
                            logger.info(f"[Groq LLM] Fallback success | Model: {cls.FALLBACK_LLM_MODEL} | Response: {len(out_content)} chars")
                            return out_content

                    last_err = RuntimeError(f"Groq API error ({res.status_code}): {err_text}")
                except Exception as e:
                    last_err = e
                    logger.warning(f"[Groq Failover] Exception with key '{label}': {str(e)}")

        # 3. If all Groq keys failed: automatically fall back to Ollama local LLM inference!
        logger.warning(f"[LLM Backend] All Groq keys failed ({last_err}). Automatically falling back to Ollama local LLM inference...")
        return await OllamaLLMService.execute_chat(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format=response_format,
        )

    @classmethod
    async def _dispatch_llm_completion(
        cls,
        system_prompt: str,
        user_prompt: str,
        custom_key: Optional[str] = None,
        call_label: str = "LLM Call",
        temperature: float = 0.0,
        max_tokens: int = 8192,
        model: Optional[str] = None,
    ) -> str:
        """
        Executes an LLM chat completion using automatic backend detection:
        - If a Groq API key is configured: uses configured Groq model.
        - If no Groq API key is found (or Groq fails): automatically falls back to Ollama.
        - Ollama model selection priority: Qwen (highest priority) -> Gemma (only if Qwen not available).
        - Strictly no other models or providers are used.
        """
        logger.info(f"[{call_label}] Dispatching LLM completion...")
        return await cls.execute_chat_with_failover(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
            custom_key=custom_key,
        )

    @classmethod
    async def transcribe_audio(
        cls,
        file_bytes: bytes,
        filename: str = "audio.webm",
        custom_key: Optional[str] = None,
    ) -> str:
        keys = cls.get_all_keys(custom_key)
        if not keys:
            raise RuntimeError("No Groq API keys configured for audio transcription.")

        last_err: Optional[Exception] = None
        async with httpx.AsyncClient(timeout=60.0) as client:
            for entry in keys:
                api_key = entry["key"]
                label = entry["label"]
                try:
                    files = {"file": (filename, file_bytes, "audio/webm")}
                    data = {"model": cls.WHISPER_MODEL, "response_format": "json"}

                    res = await client.post(
                        cls.GROQ_AUDIO_URL,
                        headers={"Authorization": f"Bearer {api_key}"},
                        files=files,
                        data=data,
                    )

                    if res.status_code == 200:
                        res_json = res.json()
                        return res_json.get("text", "").strip()

                    err_text = res.text
                    if res.status_code == 429 or "rate_limit" in err_text.lower():
                        logger.warning(f"[Groq Whisper] Key '{label}' hit rate limit. Trying next key...")
                        continue

                    last_err = RuntimeError(f"Whisper transcription failed ({res.status_code}): {err_text}")
                except Exception as e:
                    last_err = e
                    logger.warning(f"[Groq Whisper] Exception with key '{label}': {str(e)}")

        raise last_err or RuntimeError("All Groq keys failed during transcription.")

    @classmethod
    async def extract_financial_intent(cls, transcript: str, custom_key: Optional[str] = None) -> Dict[str, Any]:
        today_iso = datetime.utcnow().strftime("%Y-%m-%d")
        system_prompt = (
            "You are a financial transaction extraction assistant. Extract financial details from the user's spoken voice note.\n"
            "Respond ONLY with valid JSON in this structure:\n"
            "{\n"
            '  "amount": number,\n'
            '  "currency": "INR",\n'
            '  "merchant": string or null,\n'
            '  "category": string (e.g. Groceries, Food, Transport, Shopping, Entertainment, Bills, Rent, Salary, Other),\n'
            '  "paymentMethod": string or null (e.g. UPI, Cash, Credit Card, Google Pay, PhonePe, Paytm),\n'
            '  "transactionType": "expense" or "income",\n'
            '  "description": string or null,\n'
            f'  "date": "{today_iso}"\n'
            "}"
        )
        content = await cls.execute_chat_with_failover(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Spoken note: '{transcript}'"},
            ],
            response_format={"type": "json_object"},
            custom_key=custom_key,
        )
        parsed = clean_and_parse_json(content)
        parsed["transcript"] = transcript
        return parsed

    @classmethod
    async def extract_voice_receipt(cls, transcript: str, custom_key: Optional[str] = None) -> Dict[str, Any]:
        settings_data = SettingsRepo.get()
        prefix = settings_data.get("receiptPrefix") or "INV-"
        system_prompt = (
            "You are an invoice and receipt parsing assistant. Extract invoice items and totals from the user's spoken voice transcript.\n"
            "Respond ONLY with valid JSON in this exact structure:\n"
            "{\n"
            f'  "receiptNumber": "{prefix}...",\n'
            '  "date": "YYYY-MM-DD",\n'
            '  "customerName": string or null,\n'
            '  "customerPhone": string or null,\n'
            '  "items": [\n'
            '    {\n'
            '      "description": string,\n'
            '      "quantity": number,\n'
            '      "unitPrice": number,\n'
            '      "amount": number,\n'
            '      "gstPercent": number\n'
            '    }\n'
            '  ],\n'
            '  "subtotal": number,\n'
            '  "discount": number,\n'
            '  "tax": number,\n'
            '  "taxPercent": number,\n'
            '  "taxType": "none" or "cgst_sgst" or "igst",\n'
            '  "cgst": number,\n'
            '  "sgst": number,\n'
            '  "igst": number,\n'
            '  "grandTotal": number,\n'
            '  "currency": "INR"\n'
            "}"
        )
        content = await cls.execute_chat_with_failover(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Voice Transcript: '{transcript}'"},
            ],
            response_format={"type": "json_object"},
            custom_key=custom_key,
        )
        parsed = clean_and_parse_json(content)
        parsed["transcript"] = transcript
        return parsed

    @classmethod
    async def extract_custom_data(
        cls,
        transcript: str,
        template: Dict[str, Any],
        custom_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        template_name = template.get("name", "Custom Template")
        fields = template.get("fields", [])
        table_fields = template.get("tableFields", [])
        tables = template.get("tables", [])

        # Check for fixed value fields
        fixed_guidance = ""
        fixed_fields = [f for f in fields if f.get("is_fixed") or f.get("type") == "fixed"]
        if fixed_fields:
            lines = ["FIXED VALUE FIELDS (STRICT COMPLIANCE REQUIRED):"]
            for ff in fixed_fields:
                fname = ff.get("name") or ff.get("extractionKey")
                val = ff.get("fixed_value")
                vals = ff.get("fixed_values") or (ff.get("options") if ff.get("type") == "fixed" else None)
                if val:
                    lines.append(f"- Field '{fname}': MUST be set to exact fixed value: \"{val}\".")
                elif vals:
                    lines.append(f"- Field '{fname}': MUST ONLY be chosen from {json.dumps(vals)}. Do not output values outside this list.")
            fixed_guidance = "\n" + "\n".join(lines) + "\n"

        prompt = (
            f"Extract production/ERP log data matching template '{template_name}' from this transcript:\n"
            f"Transcript: '{transcript}'\n\n"
            f"Form Fields Schema: {json.dumps(fields)}\n"
            f"Table Fields Schema: {json.dumps(table_fields)}\n"
            f"Tables Schema: {json.dumps(tables)}\n"
            f"{fixed_guidance}\n"
            "Return JSON matching:\n"
            "{\n"
            '  "templateId": "...",\n'
            '  "templateName": "...",\n'
            '  "fieldValues": { "field_key": "extracted_value" },\n'
            '  "tableRows": [ { "col_key": "val" } ],\n'
            '  "rawTranscript": "..."\n'
            "}"
        )
        content = await cls.execute_chat_with_failover(
            messages=[
                {"role": "system", "content": "You extract structured ERP log records from voice transcriptions. Output strictly valid JSON."},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            custom_key=custom_key,
        )
        parsed = clean_and_parse_json(content)
        parsed["templateId"] = template.get("id")
        parsed["templateName"] = template_name
        parsed["rawTranscript"] = transcript

        # Post-process fixed values
        if parsed.get("fieldValues") and isinstance(parsed["fieldValues"], dict):
            field_vals = parsed["fieldValues"]
            for ff in fixed_fields:
                k = ff.get("extractionKey") or ff.get("name")
                val = ff.get("fixed_value")
                vals = ff.get("fixed_values") or (ff.get("options") if ff.get("type") == "fixed" else None)
                if val:
                    field_vals[k] = str(val).strip()
                elif vals:
                    allowed = [str(a).strip() for a in vals if str(a).strip()]
                    if allowed:
                        curr = str(field_vals.get(k, "")).strip()
                        matched = next((a for a in allowed if a.lower() == curr.lower()), None)
                        if not matched and curr:
                            matched = next((a for a in allowed if a.lower() in curr.lower() or curr.lower() in a.lower()), None)
                        field_vals[k] = matched if matched else allowed[0]

        return parsed

    @classmethod
    async def extract_flexible_data(cls, transcript: str, custom_key: Optional[str] = None) -> Dict[str, Any]:
        prompt = (
            "Extract all keys, fields, entities, and table rows mentioned in this transcript into flexible JSON.\n"
            f"Transcript: '{transcript}'\n\n"
            "Return JSON:\n"
            "{\n"
            '  "title": "...",\n'
            '  "fieldValues": { ... },\n'
            '  "tableHeaders": [ ... ],\n'
            '  "tableRows": [ ... ],\n'
            '  "rawTranscript": "..."\n'
            "}"
        )
        content = await cls.execute_chat_with_failover(
            messages=[
                {"role": "system", "content": "You extract flexible ERP entities from voice notes."},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            custom_key=custom_key,
        )
        parsed = clean_and_parse_json(content)
        parsed["isFlexible"] = True
        parsed["rawTranscript"] = transcript
        return parsed

    @classmethod
    async def parse_financial_query(cls, query: str, custom_key: Optional[str] = None) -> Dict[str, Any]:
        from app.db.repositories import TransactionsRepo
        txs = TransactionsRepo.get_all()
        prompt = (
            f"The user has a question about their transactions/expenses:\n"
            f"User Question: '{query}'\n\n"
            f"Available Transactions Data ({len(txs)} records):\n"
            f"{json.dumps(txs[:100], indent=2)}\n\n"
            "Respond in JSON:\n"
            "{\n"
            '  "answer": "Detailed helpful answer",\n'
            '  "totalAmount": number or null,\n'
            '  "matchedTransactionsCount": number,\n'
            '  "timeframe": string\n'
            "}"
        )
        content = await cls.execute_chat_with_failover(
            messages=[
                {"role": "system", "content": "You are a financial analytics assistant answering questions based on transaction data."},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            custom_key=custom_key,
        )
        return clean_and_parse_json(content)

    @classmethod
    async def structure_handwritten_page(
        cls,
        page_ocr_text: str,
        page_number: int = 1,
        total_pages: int = 1,
        template: Optional[Dict[str, Any]] = None,
        mode: str = "template",
        document_name: str = "document",
        ocr_method: str = "chandra_2",
        custom_key: Optional[str] = None,
        ocr_record_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Structures reviewed OCR text (HTML or raw text from Chandra 2)
        into a finalized, schema-compliant SessionDataEntry via LLM (Groq / Gemini fallback).
        Always saves final parsed JSON back to SQLite and outputs prominent backend logs.
        """
        # If ocr_record_id provided, look up raw HTML from SQLite if needed
        if ocr_record_id:
            try:
                saved_rec = OcrResultsRepo.get_by_id(ocr_record_id)
                if saved_rec and saved_rec.get("raw_text") and len(saved_rec["raw_text"]) > len(page_ocr_text):
                    logger.info(f"[LLM-Structuring] Hydrated raw HTML OCR text ({len(saved_rec['raw_text'])} chars) from SQLite record '{ocr_record_id}'")
                    page_ocr_text = saved_rec["raw_text"]
            except Exception as rec_err:
                logger.warning(f"[LLM-Structuring] Failed to fetch SQLite OCR record '{ocr_record_id}': {rec_err}")

        # Compute clean display text (with HTML tags stripped) for UI use
        clean_display_text = clean_html_to_text(page_ocr_text)

        # Log Log 1: Raw Chandra OCR output
        logger.info("=" * 80)
        logger.info(f"=== [1. RAW CHANDRA OCR OUTPUT: {document_name} (Page {page_number}/{total_pages})] ===")
        logger.info(f"OCR Record ID: {ocr_record_id or 'N/A'} | Raw Length: {len(page_ocr_text)} chars | Method: {ocr_method}")
        logger.info("--- RAW OCR OUTPUT TEXT / HTML ---")
        logger.info(page_ocr_text)
        logger.info("=" * 80)

        is_template_mode = mode == "template"
        page_label = f"Page {page_number}" if total_pages > 1 else (document_name or "Document")
        entry_id = f"entry_hw_{int(time.time() * 1000)}_p{page_number}"

        if not page_ocr_text or not page_ocr_text.strip():
            empty_entry = {
                "id": entry_id,
                "pageNumber": page_number,
                "templateId": template.get("id") if template else "hw_template",
                "templateName": template.get("name") if template else "Handwriting Scanning Template",
                "fieldValues": {},
                "tableHeaders": [],
                "tableRows": [],
                "tables": [],
                "cleanText": "",
                "rawTranscript": "",
                "rawOcrText": "",
                "documentName": document_name,
                "missingFields": [f.get("name", "") for f in template.get("fields", [])] if template else [],
                "ocrRecordId": ocr_record_id,
            }
            if ocr_record_id:
                OcrResultsRepo.update_llm_result(ocr_record_id, empty_entry)
            return empty_entry

        # Load / merge template schema to ensure complete 16 fields + 2 tables
        active_template = template
        if is_template_mode:
            if not active_template or not active_template.get("fields"):
                try:
                    active_template = HandwritingTemplatesRepo.get_active()
                except Exception:
                    active_template = DEFAULT_HANDWRITING_SCANNING_TEMPLATE
            if not active_template:
                active_template = DEFAULT_HANDWRITING_SCANNING_TEMPLATE

        if is_template_mode and active_template:
            # Normalize fields schema for CALL 1: PURE OCR EXTRACTION (NO fixed-value info)
            raw_fields = active_template.get("fields") or DEFAULT_HANDWRITING_SCANNING_TEMPLATE["fields"]
            pure_fields_schema = []
            seen_field_keys = set()
            fixed_fields_config = []

            for f in raw_fields:
                f_name = f.get("name") or f.get("field_name")
                if not f_name:
                    continue
                f_key = f.get("extractionKey") or f.get("key") or f_name
                if f_key in seen_field_keys:
                    continue
                seen_field_keys.add(f_key)

                # Pure field schema for Call 1: strip all is_fixed, fixed_value, and allowed_values
                pure_fields_schema.append({
                    "key": f_key,
                    "name": f_name,
                    "type": f.get("type", "text") if f.get("type") != "fixed" else "text",
                    "options": f.get("options") if f.get("type") != "fixed" else None,
                    "required": f.get("required", False),
                })

                # Collect fixed-field definitions separately for CALL 2
                is_fixed = bool(f.get("is_fixed") or f.get("type") == "fixed")
                if is_fixed:
                    fixed_val = f.get("fixed_value")
                    vals = f.get("fixed_values") or f.get("allowed_values") or (f.get("options") if f.get("type") == "fixed" else None)
                    allowed_list = []
                    if vals and isinstance(vals, list):
                        allowed_list = [str(a).strip() for a in vals if str(a).strip()]
                    elif fixed_val and str(fixed_val).strip():
                        allowed_list = [str(fixed_val).strip()]

                    if allowed_list:
                        fixed_fields_config.append({
                            "name": f_name,
                            "key": f_key,
                            "allowed_values": allowed_list,
                            "is_single_fixed": bool(fixed_val and not vals),
                        })

            # Ensure all 16 canonical handwriting template fields are present in pure_fields_schema
            canonical_fields = DEFAULT_HANDWRITING_SCANNING_TEMPLATE["fields"]
            for cf in canonical_fields:
                cf_name = cf["field_name"]
                if cf_name not in seen_field_keys:
                    pure_fields_schema.append({
                        "key": cf_name,
                        "name": cf_name,
                        "type": "text",
                        "options": None,
                        "required": False,
                    })
                    seen_field_keys.add(cf_name)

            # If lookupConfig has strict validation enabled, include the autofill base field in Call 2 (Fixed Field Resolution)
            lookup_config = (
                (template.get("lookupConfig") if template and isinstance(template, dict) else None)
                or active_template.get("lookupConfig")
            )
            if lookup_config and lookup_config.get("enabled"):
                is_strict = bool(lookup_config.get("strictValidation") or lookup_config.get("strict"))
                table_id = lookup_config.get("tableId")
                if is_strict and table_id:
                    main_col = lookup_config.get("mainTableColumn")
                    main_key = lookup_config.get("mainFieldKey")

                    # Identify field name and key from template schema
                    base_field_name = None
                    base_field_key = None
                    for f in pure_fields_schema:
                        if main_key and (f["key"] == main_key or f["name"] == main_key):
                            base_field_name = f["name"]
                            base_field_key = f["key"]
                            break
                        if main_col and (f["name"] == main_col or f["key"] == main_col):
                            base_field_name = f["name"]
                            base_field_key = f["key"]
                            break

                    if not base_field_name:
                        base_field_name = main_col or main_key
                        base_field_key = main_key or main_col

                    try:
                        table_doc = LookupTablesRepo.get_by_id(table_id)
                        if not table_doc and isinstance(lookup_config.get("table"), dict):
                            table_doc = lookup_config["table"]
                        if not table_doc and template and isinstance(template.get("lookupTable"), dict):
                            table_doc = template["lookupTable"]

                        if table_doc and table_doc.get("rows"):
                            lookup_col = main_col or base_field_name
                            valid_vals = []
                            seen_vals = set()
                            for r in table_doc["rows"]:
                                val = str(r.get(lookup_col, "")).strip()
                                if not val and main_key and r.get(main_key):
                                    val = str(r.get(main_key, "")).strip()
                                if val and val not in seen_vals:
                                    seen_vals.add(val)
                                    valid_vals.append(val)

                            if valid_vals:
                                # Check if already in fixed_fields_config
                                existing_ff = next(
                                    (ff for ff in fixed_fields_config if ff["name"] == base_field_name or ff["key"] == base_field_key),
                                    None
                                )
                                if existing_ff:
                                    existing_set = set(existing_ff["allowed_values"])
                                    for v in valid_vals:
                                        if v not in existing_set:
                                            existing_ff["allowed_values"].append(v)
                                            existing_set.add(v)
                                    existing_ff["is_strict_lookup"] = True
                                    existing_ff["lookup_config"] = lookup_config
                                else:
                                    fixed_fields_config.append({
                                        "name": base_field_name,
                                        "key": base_field_key,
                                        "allowed_values": valid_vals,
                                        "is_single_fixed": False,
                                        "is_strict_lookup": True,
                                        "lookup_config": lookup_config,
                                    })
                                logger.info(
                                    f"[LLM-Structuring] Added strict autofill base field '{base_field_name}' "
                                    f"to Call 2 with {len(valid_vals)} allowed values from master catalog '{table_id}'."
                                )
                    except Exception as lk_err:
                        logger.warning(f"[LLM-Structuring] Failed to load lookup table '{table_id}' for Call 2: {lk_err}")

            raw_tables = active_template.get("tables") or []
            if not raw_tables and active_template.get("hasTable") and active_template.get("tableFields"):
                raw_tables = [
                    {
                        "id": "table_default",
                        "name": active_template.get("tableTitle") or "Production Table",
                        "fields": active_template.get("tableFields", []),
                    }
                ]
            elif not raw_tables and active_template.get("table_columns"):
                raw_tables = [
                    {
                        "id": "table_default",
                        "name": "Production Table",
                        "fields": [
                            {"name": c.get("column_name", ""), "key": c.get("column_name", ""), "type": "text"}
                            for c in active_template.get("table_columns", [])
                        ],
                    }
                ]

            # Ensure canonical tables (Production Table & Rejection Table) are represented
            has_rejection = any("reject" in str(t.get("name", "")).lower() for t in raw_tables)
            if not has_rejection and DEFAULT_HANDWRITING_SCANNING_TEMPLATE.get("tables"):
                for dt in DEFAULT_HANDWRITING_SCANNING_TEMPLATE["tables"]:
                    if "reject" in dt["name"].lower():
                        raw_tables.append(dt)
                        break

            multi_tables_schema = [
                {
                    "name": tbl.get("name") or "Table",
                    "columns": [
                        {
                            "key": c.get("extractionKey") or c.get("key") or c.get("column_name") or c.get("name"),
                            "name": c.get("name") or c.get("column_name"),
                            "type": c.get("type", "text"),
                        }
                        for c in (tbl.get("fields") or tbl.get("columns") or [])
                        if c.get("name") or c.get("column_name")
                    ],
                }
                for tbl in raw_tables
            ]

            # =========================================================================
            # CALL 1 — OCR -> Structured JSON (PURE OCR EXTRACTION, NO FIXED VALUES OR REFERENCES)
            # =========================================================================
            call1_system_prompt = (
                "You are an expert Document Intelligence and Handwriting Extraction AI.\n"
                "Your ONLY task is to extract ALL structured form fields and tables directly from the provided OCR HTML text into a strictly valid JSON object.\n"
                "THE OCR HTML IS YOUR ABSOLUTE SOURCE OF TRUTH.\n\n"
                "STRICT OUTPUT REQUIREMENTS:\n"
                "1. Output MUST strictly be valid JSON only. Do NOT output markdown explanations or conversational text outside the JSON.\n"
                "2. All strings inside JSON must have internal double quotes escaped (\\\").\n"
                "3. Never truncate the output. Return the complete JSON with every field and table row.\n"
                "4. Use the EXACT field names provided in the REQUIRED FORM FIELDS SCHEMA as keys in 'fieldValues'. Do NOT create duplicate fields, variations, or aliases.\n\n"
                f"1. REQUIRED FORM FIELDS SCHEMA:\n{json.dumps(pure_fields_schema, indent=2)}\n\n"
                f"2. REQUIRED TABLES SCHEMA:\n{json.dumps(multi_tables_schema, indent=2)}\n\n"
                "FIELD EXTRACTION GUIDELINES:\n"
                "1. Scan the OCR HTML thoroughly and extract the exact value for every schema field.\n"
                "2. Match each schema field to its corresponding text in the OCR HTML:\n"
                "   - Extract 'Part No', 'Machine Name', 'Description', 'Raw Material', 'Planned Production', 'Date', 'Shift', 'Batch No', 'Opening Cycle', 'Closing Cycle', 'Cycle Time', 'Startup Time', 'Operator', 'No of Cavities', 'Purge Weight', 'Runner Weight'.\n"
                "   - Map any slight OCR label variations (such as 'Opening Counter' or 'Opening Meter' in the document) directly to the schema field 'Opening Cycle'.\n"
                "   - Map 'Closing Counter' or 'Closing Meter' directly to the schema field 'Closing Cycle'.\n"
                "   - Map 'Setup Time' directly to the schema field 'Startup Time'.\n"
                "   - Map 'Planned Prodn.' directly to the schema field 'Planned Production'.\n"
                "   - Map 'M/C Name' or 'M/C No' directly to the schema field 'Machine Name'.\n"
                "   - Always put the extracted value under the EXACT schema field name. Do NOT output variant or duplicate keys.\n"
                "3. Handwriting & Document Layout:\n"
                "   - Handwriting is typically enclosed in <u>...</u> tags (e.g. '<u>320910590</u>', '<u>DTS-100</u>', '<u>8732</u>').\n"
                "   - Bold text (<b>...</b>) often contains shift letters or section identifiers.\n"
                "   - Inverted signatures: In signature/approval blocks at the bottom of the card, the handwritten name or signature is often placed directly above the role label (e.g. '<u>D. Dungalwamy</u><br/>Operator').\n"
                "4. Arithmetic sums:\n"
                "   - If any value contains arithmetic like '300 + 8' or '365 + 4', calculate and return the sum ('308' or '369').\n"
                "5. Additional document fields:\n"
                "   - If the OCR HTML contains other distinct filled fields not in the schema (such as 'RM Loading', 'OK Component', 'Physical Weight'), extract them too under their exact label names.\n"
                "6. Strict Source of Truth:\n"
                "   - If a field is genuinely absent from the OCR HTML, set its value to empty string (\"\").\n"
                "   - Never hallucinate or guess values. Never mark a field as empty if its value is clearly present anywhere in the OCR HTML.\n"
                "7. Tables — STRICT ROW & CELL INDEPENDENCE (ZERO DUPLICATION):\n"
                "   - Extract all actual operational data rows according to the REQUIRED TABLES SCHEMA.\n"
                "   - ABSOLUTE ZERO DUPLICATION RULE:\n"
                "     * Each table row and cell must be extracted EXACTLY ONCE. Never repeat, duplicate, clone, or carry over values across rows.\n"
                "     * Every single cell must be extracted independently and strictly from its own corresponding row in the OCR HTML.\n"
                "   - MANDATORY REMARKS COLUMN ROW-BY-ROW VERIFICATION:\n"
                "     * Verify the 'Remarks' (or 'Reason'/'Notes') column strictly row-by-row against the OCR HTML.\n"
                "     * Extract a remark ONLY on the specific row where that handwritten note actually appears in the OCR HTML text.\n"
                "     * If a table row has no handwritten remark in the OCR HTML (i.e. the cell is blank, empty <td></td>, whitespace, or unwritten), you MUST set its 'Remarks' value to an empty string (\"\").\n"
                "     * NEVER copy, repeat, propagate, cascade, or carry forward a remark to adjacent, previous, or subsequent rows under any circumstances!\n"
                "     * Each remark belongs strictly and exclusively to the single row where it was written. Two rows must NEVER share identical non-empty remarks unless that remark is physically written out separately in each row in the OCR HTML.\n"
                "   - EXCLUDE TOTAL/SUMMARY ROW: DO NOT extract or include the summary/total row (the row containing 'Total', 'TOTAL', or cumulative column sums at the bottom of the table). We already calculate totals automatically. Only extract actual operational data rows.\n\n"
                "OUTPUT JSON STRUCTURE (Strictly Valid JSON Only):\n"
                "{\n"
                f'  "title": "{template.get("name", "Document")} ({page_label})",\n'
                '  "fieldValues": {\n'
                + ",\n".join([f'    "{f["name"]}": "..."' for f in pure_fields_schema])
                + "\n  },\n"
                '  "tables": [\n'
                '    {\n'
                '      "name": "Production Table",\n'
                '      "headers": [ ... ],\n'
                '      "rows": [ { ... } ]\n'
                '    }\n'
                '  ],\n'
                '  "tableRows": [],\n'
                '  "confidenceScore": 95\n'
                "}"
            )

            call1_user_prompt = (
                f"DOCUMENT: {template.get('name', 'Document')} | PAGE: {page_label}\n\n"
                f"TARGET FIELDS TO EXTRACT:\n{json.dumps([f['name'] for f in pure_fields_schema], indent=2)}\n\n"
                f"TARGET TABLES TO EXTRACT:\n{json.dumps([t['name'] for t in multi_tables_schema], indent=2)}\n\n"
                f"OCR HTML TEXT (ABSOLUTE SOURCE OF TRUTH FOR {page_label.upper()}):\n"
                '"""\n'
                f"{page_ocr_text}\n"
                '"""\n\n'
                "INSTRUCTIONS:\n"
                "1. Scan the entire OCR HTML text above and extract all field values and tables into the required JSON format.\n"
                "2. Use the exact schema field names as keys. Do NOT create duplicate keys or alias entries.\n"
                "3. Extract any additional filled fields (such as 'RM Loading', 'OK Component', 'Physical Weight') under their exact label names.\n"
                "4. In tables: Extract ONLY actual operational data rows. DO NOT extract the last row containing 'Total' or cumulative sums (totals are calculated automatically).\n"
                "5. STRICT ROW & CELL INDEPENDENCE (ZERO DUPLICATION & REMARKS COLUMN VERIFICATION):\n"
                "   - Extract each table row and cell EXACTLY ONCE with no duplication, repetition, or carryover of values.\n"
                "   - Specifically verify the 'Remarks' column for every row against the OCR HTML: extract a remark ONLY on the exact row where it was physically written. If a row has no remark in the OCR HTML, leave its 'Remarks' value as an empty string (\"\"). NEVER carry over, repeat, or cascade a remark from one row to subsequent rows.\n"
                "6. Return ONLY a single strictly valid JSON object."
            )

            logger.info("=" * 80)
            logger.info(f"=== [CALL 1 INPUT: OCR -> STRUCTURED JSON: {page_label.upper()} ({page_number}/{total_pages})] ===")
            logger.info(f"Template Name: '{active_template.get('name', 'Handwriting Scanning Template')}' | Target Fields: {len(pure_fields_schema)} | Target Tables: {len(multi_tables_schema)}")
            logger.info("--- REQUIRED OUTPUT JSON SCHEMA (NO FIXED VALUES) ---")
            logger.info(json.dumps(pure_fields_schema, indent=2, ensure_ascii=False))
            logger.info("--- TABLES SCHEMA ---")
            logger.info(json.dumps(multi_tables_schema, indent=2, ensure_ascii=False))
            logger.info("--- OCR HTML INPUT LENGTH: %d characters ---", len(page_ocr_text))
            logger.info("=" * 80)

            call1_raw = await cls._dispatch_llm_completion(
                system_prompt=call1_system_prompt,
                user_prompt=call1_user_prompt,
                custom_key=custom_key,
                call_label="Call 1: OCR -> Structured JSON",
                temperature=0.0,
                max_tokens=8192,
            )

            logger.info("=" * 80)
            logger.info(f"=== [CALL 1 RAW OUTPUT ({len(call1_raw)} chars)] ===")
            logger.info(call1_raw)
            logger.info("=" * 80)

            call1_parsed = clean_and_parse_json(call1_raw)
            if not isinstance(call1_parsed, dict):
                if isinstance(call1_parsed, list) and len(call1_parsed) > 0 and isinstance(call1_parsed[0], dict):
                    call1_parsed = call1_parsed[0]
                else:
                    call1_parsed = {}

            raw_extracted = call1_parsed.get("fieldValues")
            if not isinstance(raw_extracted, dict):
                raw_extracted = {}

            # Ingest top-level fields if the LLM output keys at the root of JSON
            reserved_root_keys = {
                "title", "tables", "tableRows", "tableHeaders", "confidenceScore", "missingFields",
                "id", "pageNumber", "mode", "sourceType", "createdAt", "templateId", "templateName",
                "documentName", "cleanText", "rawTranscript", "rawOcrText", "rawOcrHtml", "ocrRecordId",
                "fieldValues", "columns", "headers", "rows"
            }
            for k, v in call1_parsed.items():
                if k not in reserved_root_keys and v is not None:
                    if k not in raw_extracted or not str(raw_extracted[k]).strip():
                        raw_extracted[k] = str(v).strip()

            # Build clean fieldValues without duplicates:
            # 1. Map directly to schema field names
            call1_field_vals: Dict[str, Any] = {}
            for f in pure_fields_schema:
                fname = f.get("name")
                fkey = f.get("key")
                val = raw_extracted.get(fname)
                if val is None or str(val).strip() == "":
                    val = raw_extracted.get(fkey)
                call1_field_vals[fname] = str(val).strip() if val is not None else ""

            # 2. Add any legitimate distinct extra fields present in document (no internal keys)
            schema_names_set = {f.get("name") for f in pure_fields_schema if f.get("name")}
            schema_keys_set = {f.get("key") for f in pure_fields_schema if f.get("key")}
            for k, v in raw_extracted.items():
                if k not in schema_names_set and k not in schema_keys_set and k not in reserved_root_keys:
                    if k not in call1_field_vals:
                        call1_field_vals[k] = str(v).strip() if v is not None else ""

            # 3. Arithmetic expression evaluation on field values (e.g. "365 + 4" -> "369")
            for fk, fv in list(call1_field_vals.items()):
                if isinstance(fv, str) and "+" in fv:
                    parts = [p.strip() for p in fv.split("+")]
                    if len(parts) >= 2 and all(re.match(r"^\d+(?:\.\d+)?$", p) for p in parts):
                        total = sum(float(p) for p in parts)
                        call1_field_vals[fk] = str(int(total)) if total.is_integer() else str(round(total, 4))

            call1_parsed["fieldValues"] = call1_field_vals

            # Filter out any total/summary rows from tables (as totals are computed automatically)
            def _filter_total_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
                filtered = []
                for r in rows:
                    if not isinstance(r, dict):
                        continue
                    is_tot = False
                    for _, val in r.items():
                        if isinstance(val, str):
                            v_clean = val.strip().lower()
                            if v_clean in ("total", "totals", "grand total", "grand_total") or re.match(r"^total\b", v_clean):
                                is_tot = True
                                break
                    if not is_tot:
                        filtered.append(r)
                return filtered

            # Ensure each table row and cell is extracted exactly once with zero duplication in Remarks
            def _deduplicate_table_remarks(rows: List[Dict[str, Any]], ocr_text: str) -> List[Dict[str, Any]]:
                if not rows or not isinstance(rows, list):
                    return rows

                remark_keys = set()
                for r in rows:
                    if isinstance(r, dict):
                        for k in r.keys():
                            k_lower = k.lower().strip()
                            if "remark" in k_lower or "reason" in k_lower or "note" in k_lower:
                                remark_keys.add(k)

                if not remark_keys:
                    return rows

                ocr_lower = ocr_text.lower() if ocr_text else ""
                norm_ocr = re.sub(r"\s+", " ", ocr_lower)

                for rkey in remark_keys:
                    seen_counts: Dict[str, int] = {}
                    for r in rows:
                        if not isinstance(r, dict):
                            continue
                        val = r.get(rkey)
                        if not val or not isinstance(val, str):
                            continue
                        val_clean = val.strip()
                        if not val_clean:
                            continue

                        norm_val = re.sub(r"\s+", " ", val_clean.lower()).strip()
                        if norm_val in ("ok", "nil", "na", "n/a", "-", "--", "none", "good"):
                            continue

                        seen_counts[norm_val] = seen_counts.get(norm_val, 0) + 1
                        occurrence = seen_counts[norm_val]

                        if occurrence > 1:
                            search_term = norm_val[:25] if len(norm_val) > 25 else norm_val
                            ocr_occurrences = norm_ocr.count(search_term) if search_term else 0

                            if ocr_occurrences < occurrence:
                                logger.info(
                                    f"[Deduplicate-Remarks] Cleared duplicate/carried-over remark on row: "
                                    f"col='{rkey}', val='{val_clean}' (table occurrence #{occurrence}, OCR occurrences: {ocr_occurrences})"
                                )
                                r[rkey] = ""

                return rows

            if call1_parsed.get("tables") and isinstance(call1_parsed["tables"], list):
                for tbl in call1_parsed["tables"]:
                    if isinstance(tbl, dict) and tbl.get("rows") and isinstance(tbl["rows"], list):
                        tbl["rows"] = _filter_total_rows(tbl["rows"])
                        tbl["rows"] = _deduplicate_table_remarks(tbl["rows"], page_ocr_text)

            if call1_parsed.get("tableRows") and isinstance(call1_parsed["tableRows"], list):
                call1_parsed["tableRows"] = _filter_total_rows(call1_parsed["tableRows"])
                call1_parsed["tableRows"] = _deduplicate_table_remarks(call1_parsed["tableRows"], page_ocr_text)

            logger.info("=" * 80)
            logger.info(f"=== [CALL 1 PARSED JSON: {page_label.upper()}] ===")
            logger.info(json.dumps(call1_parsed, indent=2, ensure_ascii=False))
            logger.info("=" * 80)

            # =========================================================================
            # CALL 2 — Fixed Field Resolution
            # =========================================================================
            call1_field_vals = call1_parsed.get("fieldValues") or {}
            resolved_fixed_fields: Dict[str, str] = {}

            if fixed_fields_config:
                # Populate scanned values extracted by Call 1
                for ff in fixed_fields_config:
                    scanned_val = call1_field_vals.get(ff["name"])
                    if scanned_val is None or str(scanned_val).strip() == "":
                        scanned_val = call1_field_vals.get(ff["key"])
                    ff["scanned_value"] = str(scanned_val).strip() if scanned_val is not None else ""

                call2_system_prompt = (
                    "You are an expert Data Normalization and Fixed Field Resolution Assistant.\n"
                    "Your task is to match scanned OCR values to the official list of allowed/fixed values.\n\n"
                    "CRITICAL RESOLUTION RULES:\n"
                    "1. For each fixed field, evaluate the provided 'Scanned Value' (extracted from OCR in Call 1) against the field's 'Allowed Values' list.\n"
                    "2. Find the best matching allowed value for each fixed field based on the scanned OCR value.\n"
                    "3. Handle OCR spelling errors, handwriting recognition errors, abbreviations, punctuation differences, spacing differences, initials, and noise (e.g. 'Dil. cep' -> 'Dilip', 'D. Dungalwamy' -> 'DODDATHUNGALAPPA', 'NEW 150' -> 'NEW-150').\n"
                    "4. STRICT CONSTRAINT: You MUST select the closest valid value ONLY from the provided Allowed Values list for that field.\n"
                    "5. NEVER create, invent, or output any new value. The value MUST appear exactly as written in the Allowed Values list.\n"
                    "6. If the scanned value is empty (\"\") or there is genuinely no reasonable match in the allowed list, return \"\" (empty string) rather than guessing.\n"
                    "7. Return valid JSON containing the selected value for every fixed field in this format:\n"
                    "{\n"
                    '  "fieldValues": {\n'
                    '    "<Field Name>": "<Selected Allowed Value or \"\">"\n'
                    '  }\n'
                    "}"
                )

                call2_prompt_lines = ["FIXED FIELD RESOLUTION REQUEST:\n"]
                for ff in fixed_fields_config:
                    call2_prompt_lines.append(f"Fixed Field:\n{ff['name']}\n")
                    call2_prompt_lines.append("Allowed Values:\n" + "\n".join(f"- {v}" for v in ff["allowed_values"]) + "\n")
                    scanned_repr = f'"{ff["scanned_value"]}"' if ff["scanned_value"] else '"" (empty / not present in OCR)'
                    call2_prompt_lines.append(f"Scanned Value:\n{scanned_repr}\n")
                    call2_prompt_lines.append("-" * 30 + "\n")

                call2_prompt_lines.append(
                    "For each fixed field above, select the closest matching value ONLY from its allowed-values list based on the scanned value. "
                    "Return valid JSON mapping each field name to its selected allowed value."
                )
                call2_user_prompt = "\n".join(call2_prompt_lines)

                logger.info("=" * 80)
                logger.info(f"=== [CALL 2 INPUT: FIXED FIELD MATCHING: {page_label.upper()} ({len(fixed_fields_config)} fields)] ===")
                logger.info(call2_user_prompt)
                logger.info("=" * 80)

                call2_raw = await cls._dispatch_llm_completion(
                    system_prompt=call2_system_prompt,
                    user_prompt=call2_user_prompt,
                    custom_key=custom_key,
                    call_label="Call 2: Fixed Field Resolution",
                )

                logger.info("=" * 80)
                logger.info(f"=== [CALL 2 RAW OUTPUT ({len(call2_raw)} chars)] ===")
                logger.info(call2_raw)
                logger.info("=" * 80)

                call2_parsed = clean_and_parse_json(call2_raw)
                call2_resolved = call2_parsed.get("fieldValues") if isinstance(call2_parsed.get("fieldValues"), dict) else call2_parsed
                if not isinstance(call2_resolved, dict):
                    call2_resolved = {}

                logger.info("=" * 80)
                logger.info(f"=== [CALL 2 RESOLVED FIXED FIELDS: {page_label.upper()}] ===")
                logger.info(json.dumps(call2_resolved, indent=2, ensure_ascii=False))
                logger.info("=" * 80)

                resolved_fixed_fields = call2_resolved
            else:
                logger.info("=" * 80)
                logger.info(f"=== [CALL 2 SKIPPED: NO FIXED FIELDS CONFIGURED FOR {page_label.upper()}] ===")
                logger.info("=" * 80)

            # =========================================================================
            # MERGE CALL 2's RESOLVED FIXED FIELDS INTO CALL 1 JSON
            # =========================================================================
            merged_field_values = dict(call1_field_vals)

            if fixed_fields_config:
                for ff in fixed_fields_config:
                    fname = ff["name"]
                    fkey = ff["key"]
                    allowed_list = ff["allowed_values"]

                    resolved_val = resolved_fixed_fields.get(fname)
                    if resolved_val is None or str(resolved_val).strip() == "":
                        resolved_val = resolved_fixed_fields.get(fkey)

                    canonical_match = None
                    if resolved_val and str(resolved_val).strip():
                        str_res = str(resolved_val).strip()
                        # Exact or case-insensitive match to canonical allowed item
                        for a in allowed_list:
                            if a.lower() == str_res.lower():
                                canonical_match = a
                                break
                        if not canonical_match:
                            for a in allowed_list:
                                norm_a = a.lower().replace("-", " ").replace(".", "").strip()
                                norm_res = str_res.lower().replace("-", " ").replace(".", "").strip()
                                if norm_a == norm_res:
                                    canonical_match = a
                                    break

                    # If single fixed value was configured and LLM didn't return a match, enforce the single value
                    if not canonical_match and ff.get("is_single_fixed"):
                        canonical_match = allowed_list[0]

                    if canonical_match:
                        merged_field_values[fname] = canonical_match
                        if fkey != fname:
                            merged_field_values[fkey] = canonical_match

                        # Auto-fill dependent fields from the matched lookup table row
                        if ff.get("is_strict_lookup") and ff.get("lookup_config"):
                            cfg = ff["lookup_config"]
                            tbl_doc = LookupTablesRepo.get_by_id(cfg.get("tableId")) if cfg.get("tableId") else None
                            if not tbl_doc and isinstance(cfg.get("table"), dict):
                                tbl_doc = cfg["table"]
                            if tbl_doc and tbl_doc.get("rows"):
                                col_name = cfg.get("mainTableColumn") or fname
                                matched_row = next(
                                    (r for r in tbl_doc["rows"] if str(r.get(col_name, "")).strip().lower() == canonical_match.lower()),
                                    None
                                )
                                if matched_row and cfg.get("fieldMappings"):
                                    for mapping in cfg["fieldMappings"]:
                                        m_fkey = mapping.get("fieldKey")
                                        m_tcol = mapping.get("tableColumn")
                                        if m_fkey and m_tcol and matched_row.get(m_tcol) is not None:
                                            val_to_fill = str(matched_row[m_tcol]).strip()
                                            if val_to_fill:
                                                merged_field_values[m_fkey] = val_to_fill
                                                for pf in pure_fields_schema:
                                                    if pf["key"] == m_fkey and pf["name"] != m_fkey:
                                                        merged_field_values[pf["name"]] = val_to_fill
                    elif ff.get("is_strict_lookup"):
                        # In strict lookup mode, if there is no valid match in the master table, reject / clear value
                        merged_field_values[fname] = ""
                        if fkey != fname:
                            merged_field_values[fkey] = ""
                        if ff.get("lookup_config") and ff["lookup_config"].get("fieldMappings"):
                            for mapping in ff["lookup_config"]["fieldMappings"]:
                                m_fkey = mapping.get("fieldKey")
                                if m_fkey:
                                    merged_field_values[m_fkey] = ""
                                    for pf in pure_fields_schema:
                                        if pf["key"] == m_fkey and pf["name"] != m_fkey:
                                            merged_field_values[pf["name"]] = ""

            # Set merged fieldValues onto final record
            parsed = call1_parsed
            parsed["fieldValues"] = merged_field_values

            # =========================================================================
            # UPDATE missingFields AFTER BOTH CALLS BASED ON FINAL MERGED JSON
            # =========================================================================
            missing_fields = []
            for f in pure_fields_schema:
                f_name = f["name"]
                f_key = f["key"]
                v = merged_field_values.get(f_name)
                if v is None or str(v).strip() == "":
                    v = merged_field_values.get(f_key)
                if v is None or str(v).strip() == "":
                    missing_fields.append(f_name)
            parsed["missingFields"] = missing_fields

            # Normalize standard metadata fields
            parsed["id"] = entry_id
            parsed["pageNumber"] = page_number
            parsed["mode"] = mode or "template"
            parsed["sourceType"] = "handwritten"
            parsed["createdAt"] = datetime.utcnow().isoformat() + "Z"
            parsed["templateId"] = active_template.get("id", "handwriting_scanning_default")
            parsed["templateName"] = active_template.get("name", "Handwriting Scanning Template")
            parsed["documentName"] = document_name
            parsed["cleanText"] = clean_display_text
            parsed["rawTranscript"] = clean_display_text
            parsed["rawOcrText"] = clean_display_text
            parsed["rawOcrHtml"] = page_ocr_text
            parsed["ocrRecordId"] = ocr_record_id

            # Ensure table compatibility for single-table and multi-table views and filter out any total/summary rows
            if parsed.get("tables") and isinstance(parsed["tables"], list) and len(parsed["tables"]) > 0:
                for tbl in parsed["tables"]:
                    if isinstance(tbl, dict):
                        if not tbl.get("headers") and tbl.get("columns"):
                            tbl["headers"] = [
                                c.get("name") or c.get("column_name") or str(c)
                                if isinstance(c, dict) else str(c)
                                for c in tbl["columns"]
                            ]
                        if tbl.get("rows") and isinstance(tbl["rows"], list):
                            tbl["rows"] = _filter_total_rows(tbl["rows"])
                            tbl["rows"] = _deduplicate_table_remarks(tbl["rows"], page_ocr_text)
                t0 = parsed["tables"][0]
                if not parsed.get("tableHeaders") and t0.get("headers"):
                    parsed["tableHeaders"] = t0.get("headers")
                if not parsed.get("tableRows") and t0.get("rows"):
                    parsed["tableRows"] = t0.get("rows")
            elif parsed.get("tableRows") and isinstance(parsed["tableRows"], list):
                clean_table_rows = _filter_total_rows(parsed["tableRows"])
                clean_table_rows = _deduplicate_table_remarks(clean_table_rows, page_ocr_text)
                parsed["tableRows"] = clean_table_rows
                parsed["tables"] = [
                    {
                        "name": active_template.get("tableTitle") or "Production Table",
                        "headers": parsed.get("tableHeaders") or (
                            list(clean_table_rows[0].keys())
                            if len(clean_table_rows) > 0 and isinstance(clean_table_rows[0], dict)
                            else []
                        ),
                        "rows": clean_table_rows,
                    }
                ]
            if parsed.get("tableRows") and isinstance(parsed["tableRows"], list):
                parsed["tableRows"] = _filter_total_rows(parsed["tableRows"])
                parsed["tableRows"] = _deduplicate_table_remarks(parsed["tableRows"], page_ocr_text)

            logger.info("=" * 80)
            logger.info(f"=== [FINAL MERGED JSON: {page_label.upper()}] ===")
            logger.info(json.dumps(parsed, indent=2, ensure_ascii=False))
            logger.info("=" * 80)

            # Persist structured LLM extraction into SQLite
            if ocr_record_id:
                try:
                    OcrResultsRepo.update_llm_result(ocr_record_id, parsed)
                    logger.info(f"[SQLite] Successfully updated ocr_results record '{ocr_record_id}' with final merged JSON.")
                except Exception as db_err:
                    logger.warning(f"[LLM-Structuring] Failed to update SQLite record '{ocr_record_id}': {db_err}")

            return parsed

        else:
            # Flexible freeform mode
            system_prompt = (
                "You are an expert Document Understanding and Handwriting Data Extraction Assistant.\n"
                "Your task is to repair OCR formatting noise, fix handwritten number misrecognitions, and structure this document into ONE clean record with dynamic key-value attributes and table rows.\n\n"
                "Return valid JSON:\n"
                "{\n"
                f'  "title": "Flexible Record ({page_label})",\n'
                '  "fieldValues": { "Field Name": "Value" },\n'
                '  "tableHeaders": [ ... ],\n'
                '  "tableRows": [ [ ... ] ],\n'
                '  "rawTranscript": "..."\n'
                "}"
            )
            user_prompt = f"OCR TEXT:\n\"\"\"\n{page_ocr_text}\n\"\"\""

            logger.info("=" * 80)
            logger.info(f"=== [2. LLM INPUT: PROMPT + JSON/SCHEMA (FLEXIBLE MODE): {page_label.upper()}] ===")
            logger.info(system_prompt)
            logger.info(user_prompt)
            logger.info("=" * 80)

            content = await cls.execute_chat_with_failover(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                custom_key=custom_key,
            )

            logger.info("=" * 80)
            logger.info(f"=== [3. LLM RAW OUTPUT (FLEXIBLE): {len(content)} chars] ===")
            logger.info(content)
            logger.info("=" * 80)

            parsed = clean_and_parse_json(content)
            parsed["id"] = entry_id
            parsed["pageNumber"] = page_number
            parsed["mode"] = "flexible"
            parsed["documentName"] = document_name
            parsed["cleanText"] = clean_display_text
            parsed["rawTranscript"] = clean_display_text
            parsed["rawOcrText"] = clean_display_text
            parsed["rawOcrHtml"] = page_ocr_text
            parsed["ocrRecordId"] = ocr_record_id

            logger.info("=" * 80)
            logger.info(f"=== [4. FINAL PARSED JSON (FLEXIBLE): {page_label.upper()}] ===")
            logger.info(json.dumps(parsed, indent=2, ensure_ascii=False))
            logger.info("=" * 80)

            if ocr_record_id:
                try:
                    OcrResultsRepo.update_llm_result(ocr_record_id, parsed)
                except Exception as db_err:
                    logger.warning(f"[LLM-Structuring] Failed to update SQLite record '{ocr_record_id}': {db_err}")

            return parsed


# --------------------------------------------------------------------------
# Gemini Multimodal Document Service
# --------------------------------------------------------------------------
class GeminiService:
    GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

    @classmethod
    def get_model(cls) -> str:
        env_model = os.environ.get("GEMINI_MODEL") or settings.GEMINI_MODEL
        if env_model and env_model in ("gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro", "gemini-3.5-flash", "gemini-3.5-flash-lite"):
            return env_model
        return "gemini-2.5-flash"

    @classmethod
    def get_all_keys(cls, custom_override: Optional[str] = None) -> List[Dict[str, str]]:
        keys: List[Dict[str, str]] = []
        seen = set()

        def add_key(val: Optional[str], label: str):
            if not val:
                return
            trimmed = val.strip()
            if trimmed and trimmed not in seen and "your_gemini" not in trimmed:
                seen.add(trimmed)
                keys.append({"key": trimmed, "label": label})

        add_key(os.environ.get("GEMINI_API_KEY") or settings.GEMINI_API_KEY, "Base Primary .env Key")
        app_settings = SettingsRepo.get()
        add_key(custom_override or app_settings.get("customGeminiApiKey"), "User Settings Key")
        return keys

    @classmethod
    def get_key_status(cls) -> Dict[str, Any]:
        keys = cls.get_all_keys()
        env_key = os.environ.get("GEMINI_API_KEY") or settings.GEMINI_API_KEY
        has_env_key = bool(env_key and env_key.strip() and "your_gemini" not in env_key)
        app_settings = SettingsRepo.get()
        custom_key = app_settings.get("customGeminiApiKey", "").strip()
        has_custom_key = bool(custom_key)

        active_type = "none"
        if keys:
            active_type = "primary_env" if has_env_key else "backup_custom"

        return {
            "hasEnvKey": has_env_key,
            "hasCustomKey": has_custom_key,
            "isConfigured": len(keys) > 0,
            "activeKeyType": active_type,
            "totalConfiguredKeys": len(keys),
            "keyLabels": [k["label"] for k in keys],
            "model": cls.get_model(),
        }

    @classmethod
    async def extract_from_document(
        cls,
        file_bytes: bytes,
        mime_type: str = "image/png",
        filename: str = "document.png",
        template: Optional[Dict[str, Any]] = None,
        handwriting_template: Optional[Dict[str, Any]] = None,
        mode: str = "template",
    ) -> Dict[str, Any]:
        keys = cls.get_all_keys()
        if not keys:
            raise RuntimeError("Gemini API Key is not configured. Please add GEMINI_API_KEY in .env or Settings.")

        model = cls.get_model()
        b64_data = base64.b64encode(file_bytes).decode("utf-8")

        target_template = handwriting_template or template or {}
        fields_desc = json.dumps(target_template.get("fields", []))
        tables_desc = json.dumps(target_template.get("tables") or target_template.get("table_columns") or [])

        prompt = (
            "Analyze this document image or PDF page. Extract all handwritten and printed field values and tabular records.\n"
            f"Target Fields Schema: {fields_desc}\n"
            f"Target Tables Schema: {tables_desc}\n\n"
            "Output strictly valid JSON:\n"
            "{\n"
            '  "field_values": { "Field Name": "Extracted Value" },\n'
            '  "table_headers": [ ... ],\n'
            '  "table_rows": [ { ... } ],\n'
            '  "tables": [ { "name": "...", "headers": [ ... ], "rows": [ { ... } ] } ],\n'
            '  "structured_text": "Complete extracted transcript text",\n'
            '  "raw_text": "Raw OCR text"\n'
            "}"
        )

        last_err: Optional[Exception] = None
        async with httpx.AsyncClient(timeout=180.0) as client:
            for entry in keys:
                api_key = entry["key"]
                label = entry["label"]
                url = f"{cls.GEMINI_API_BASE_URL}/{model}:generateContent?key={api_key}"
                try:
                    payload = {
                        "contents": [
                            {
                                "role": "user",
                                "parts": [
                                    {"text": prompt},
                                    {"inline_data": {"mime_type": mime_type, "data": b64_data}},
                                ],
                            }
                        ],
                        "generationConfig": {
                            "temperature": 0.1,
                            "responseMimeType": "application/json",
                        },
                    }
                    res = await client.post(url, json=payload)
                    if res.status_code == 200:
                        data = res.json()
                        cand_text = data["candidates"][0]["content"]["parts"][0]["text"]
                        parsed = clean_and_parse_json(cand_text)
                        return parsed

                    err_text = res.text
                    logger.warning(f"[Gemini Failover] Key '{label}' error {res.status_code}: {err_text}")
                    last_err = RuntimeError(f"Gemini API error ({res.status_code}): {err_text}")
                except Exception as e:
                    last_err = e
                    logger.warning(f"[Gemini Failover] Exception with key '{label}': {str(e)}")

        raise last_err or RuntimeError("Gemini extraction failed across all configured keys.")


# --------------------------------------------------------------------------
# Voice Edit Service (Groq with Automatic Ollama Failover)
# --------------------------------------------------------------------------
class VoiceEditService:
    @classmethod
    async def process_voice_edit(
        cls,
        instruction: str,
        current_field_values: Dict[str, Any],
        table_headers: List[str],
        table_rows: List[Any],
        template: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        system_prompt = (
            "You are a high-precision data editing assistant for document extraction.\n"
            "The user is reviewing extracted document data and has spoken a voice instruction to correct one or more values.\n\n"
            f"Current Extracted Form Fields:\n{json.dumps(current_field_values, indent=2)}\n\n"
            f"Current Table Headers:\n{json.dumps(table_headers)}\n\n"
            f"Current Table Rows:\n{json.dumps(table_rows, indent=2)}\n\n"
            f"User Voice Instruction:\n\"{instruction.strip()}\"\n\n"
            "CRITICAL RULES:\n"
            "1. Return ONLY the form fields that need correction in 'field_values'. Do NOT include unchanged fields.\n"
            "2. If user instruction modifies table data, return the complete corrected table in 'table_rows'. Otherwise set 'table_rows': null.\n"
            "3. Provide a concise explanation of changes in 'explanation'.\n"
            "4. Output strictly valid JSON."
        )

        try:
            content = await GroqService.execute_chat_with_failover(
                messages=[
                    {"role": "system", "content": "You edit extracted document data from voice instructions. Output valid JSON."},
                    {"role": "user", "content": system_prompt},
                ],
                model="llama-3.3-70b-versatile",
                response_format={"type": "json_object"},
            )
            parsed = clean_and_parse_json(content)
            return {
                "success": True,
                "field_values": parsed.get("field_values") or {},
                "table_rows": parsed.get("table_rows"),
                "explanation": parsed.get("explanation", "Applied voice corrections via LLM."),
            }
        except Exception as err:
            logger.error(f"[Voice Edit] LLM processing failed: {str(err)}")
            raise RuntimeError(f"Voice edit failed: {str(err)}")
