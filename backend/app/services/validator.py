import re
from typing import List, Tuple, Optional, Dict, Any
from datetime import datetime
from rapidfuzz import fuzz, process

from app.core.logger import logger


class FieldValidator:
    """
    Service for field-specific format validation, confidence classification,
    and fuzzy lookup table auto-correction.
    """

    # Regex patterns for common field types
    NUMERIC_PATTERN = re.compile(r"^[-+]?[\$€£₹]?\s*\d+([.,]\d+)?\s*[%]?$")
    DATE_PATTERNS = [
        r"^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$",      # YYYY-MM-DD
        r"^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$",      # DD/MM/YYYY or MM/DD/YYYY
        r"^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4}$",
    ]
    TIME_PATTERNS = [
        r"^\d{1,2}:\d{2}(:\d{2})?\s*(am|pm|AM|PM)?$",
        r"^\d{1,2}\s*(am|pm|AM|PM)$",
    ]

    @classmethod
    def validate_field_type(
        cls,
        text: str,
        field_type: Optional[str] = None,
    ) -> Tuple[bool, Optional[str]]:
        """
        Validates text against a specific semantic field type.

        Returns:
            Tuple of (is_valid, validation_message)
        """
        if not text or not text.strip():
            return False, "Empty text"

        clean_text = text.strip()
        ft = (field_type or "text").lower()

        if ft in ("number", "numeric", "quantity", "qty", "amount", "price"):
            # Strip non-numeric artifacts
            stripped = re.sub(r"[,\s]", "", clean_text)
            if cls.NUMERIC_PATTERN.match(clean_text) or re.match(r"^[-+]?\d+(\.\d+)?$", stripped):
                return True, None
            return False, f"Expected numeric value, got '{clean_text}'"

        elif ft in ("date", "datetime"):
            matched = any(re.match(p, clean_text, re.IGNORECASE) for p in cls.DATE_PATTERNS)
            if matched:
                return True, None
            return False, f"Expected valid date format, got '{clean_text}'"

        elif ft in ("time", "timestamp"):
            matched = any(re.match(p, clean_text, re.IGNORECASE) for p in cls.TIME_PATTERNS)
            if matched:
                return True, None
            return False, f"Expected valid time format, got '{clean_text}'"

        else:
            # General text validation: flag if full of non-alphanumeric noise symbols
            alnum_count = sum(1 for c in clean_text if c.isalnum())
            if len(clean_text) > 2 and alnum_count / len(clean_text) < 0.35:
                return False, f"Text contains excessive non-printable noise: '{clean_text}'"
            return True, None

    @staticmethod
    def classify_confidence(
        score: float,
        high_thresh: float = 0.85,
        med_thresh: float = 0.65,
    ) -> str:
        """
        Classifies numerical confidence (0.0 to 1.0) into HIGH, MEDIUM, or LOW.
        """
        if score >= high_thresh:
            return "HIGH"
        elif score >= med_thresh:
            return "MEDIUM"
        return "LOW"

    @classmethod
    def lookup_table_correction(
        cls,
        raw_text: str,
        lookup_values: List[str],
        threshold: float = 0.80,
        strict: bool = True,
    ) -> Tuple[str, float, bool, Optional[str]]:
        """
        Compares raw OCR text against valid lookup table entries using fuzzy matching.

        Args:
            raw_text: Recognized text from OCR.
            lookup_values: Array of valid table strings (e.g. Part Numbers, Machine IDs).
            threshold: Fuzzy ratio threshold (0.0 to 1.0) required to auto-correct.
            strict: If True, unmatched values are flagged as invalid.

        Returns:
            Tuple of (corrected_or_original_text, match_score, is_valid, explanation_message)
        """
        if not raw_text or not lookup_values:
            return raw_text, 1.0, True, None

        clean_raw = raw_text.strip()
        norm_raw = re.sub(r"[\s\-_]", "", clean_raw).upper()

        # 1. Exact / Normalized Match
        for val in lookup_values:
            norm_val = re.sub(r"[\s\-_]", "", val.strip()).upper()
            if norm_raw == norm_val or clean_raw.lower() == val.strip().lower():
                return val.strip(), 1.0, True, "Exact lookup match"

        # 2. Fuzzy Matching with RapidFuzz
        match_result = process.extractOne(
            clean_raw,
            lookup_values,
            scorer=fuzz.token_sort_ratio,
        )

        if match_result:
            matched_value, score, _ = match_result
            norm_score = float(score) / 100.0

            if norm_score >= threshold:
                msg = f"Fuzzy corrected '{clean_raw}' -> '{matched_value}' ({score:.0f}% match)"
                logger.info(f"  [LOOKUP CORRECTION] {msg}")
                return matched_value, norm_score, True, msg

            elif strict:
                msg = f"Strict lookup rejected '{clean_raw}' (best match '{matched_value}' at {score:.0f}% < {threshold*100:.0f}%)"
                logger.warning(f"  [LOOKUP REJECTED] {msg}")
                return clean_raw, norm_score, False, msg

        if strict:
            return clean_raw, 0.0, False, f"Value '{clean_raw}' not found in lookup table"

        return clean_raw, 0.5, True, None
