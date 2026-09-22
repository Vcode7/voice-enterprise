import re
import math
from typing import List, Dict, Any, Tuple, Optional
from app.core.logger import logger
from app.models.schemas import ExtractedFieldMatch, OcrBlock
from app.services.validator import FieldValidator


class SpatialFieldExtractor:
    """
    Field-Specific Form Extractor:
    Extracts ONLY the fields configured in the active template by locating field labels
    and searching their spatial neighborhood (primarily AFTER/RIGHT of label and BELOW label).
    """

    # Common field aliases and variations for standard industrial & form templates
    DEFAULT_FIELD_ALIASES: Dict[str, List[str]] = {
        "part_no": ["part no", "part no.", "part number", "part#", "part_no", "partnum", "part"],
        "machine_name": ["machine name", "machine name:", "machine", "mc name", "m/c name", "m/c", "mc no", "machine no"],
        "description": ["description", "description:", "desc", "part description", "item description", "desc."],
        "raw_material": ["raw material", "raw material:", "material", "rm", "raw mat", "raw mat."],
        "planned_production_date": ["planned production date", "planned date", "prod date", "plan date"],
        "planned_prodn": ["planned prodn", "planned prodn.", "planned prod", "planned production", "plan prod", "planned qty", "planned"],
        "quantity": ["quantity", "qty", "produced qty", "prod qty", "total qty", "prod n qty", "reg n qty", "ok qty", "produced"],
        "opening_counter": ["opening counter", "opening counter:", "open counter", "opening cntr", "start counter", "initial counter"],
        "closing_counter": ["closing counter", "closing counter:", "close counter", "closing cntr", "end counter", "final counter"],
        "cycle_time": ["cycle time", "cycle time:", "cycle time to", "c/t", "cycle", "sec/cycle"],
        "startup_time": ["startup time", "startup time:", "statup time", "start time", "start up time"],
        "operator": ["operator", "operator:", "operator no", "operator name", "op", "op no", "op."],
        "no_of_cavities": ["no. of cavities", "no of cavities", "cavities", "no of cavity", "cavity count"],
        "purge_weight": ["purge weight", "purge wt", "purge weight:", "purge"],
        "runner_weight": ["runner weight", "runner wt", "runner weight:", "runner"],
        "date": ["date", "date:", "dated", "production date", "mfg date"],
        "shift": ["shift", "shift:", "shift no", "shift code"],
        "batch_no": ["batch no", "batch no.", "batch number", "batch#", "lot no", "lot number", "batch"],
        "status": ["status", "status:", "result", "qc status", "inspection"],
        "notes": ["notes", "notes:", "remarks", "comments"],
    }

    @staticmethod
    def normalize_text(text: str) -> str:
        """Strips punctuation, colons, dots, spaces, hyphens, and lowercases for matching."""
        if not text:
            return ""
        # Remove trailing colons, dots, dashes
        cleaned = re.sub(r"[:\.\-_=]+", " ", text)
        cleaned = re.sub(r"\s+", " ", cleaned).strip().lower()
        return cleaned

    @classmethod
    def parse_template_fields(cls, template_input: Any) -> List[Dict[str, Any]]:
        """
        Normalizes various template inputs (list of field names, list of dicts, or template object)
        into a consistent field definitions list.
        """
        if not template_input:
            return []

        # If template is a dict with 'fields' key
        if isinstance(template_input, dict) and "fields" in template_input:
            field_list = template_input["fields"]
        elif isinstance(template_input, list):
            field_list = template_input
        else:
            return []

        parsed: List[Dict[str, Any]] = []
        for item in field_list:
            if isinstance(item, str):
                name = item.strip()
                key = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
                ftype = "text"
                if any(w in key for w in ["qty", "quantity", "counter", "weight", "cavities", "number", "no", "count"]):
                    ftype = "number"
                elif "date" in key:
                    ftype = "date"
                elif "time" in key:
                    ftype = "time"

                parsed.append({
                    "name": name,
                    "key": key,
                    "type": ftype,
                    "aliases": cls._get_aliases_for_field(name, key),
                })
            elif isinstance(item, dict):
                name = item.get("name") or item.get("label") or item.get("key") or "Field"
                key = item.get("extractionKey") or item.get("key") or re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
                ftype = item.get("type", "text")
                parsed.append({
                    "name": name,
                    "key": key,
                    "type": ftype,
                    "aliases": cls._get_aliases_for_field(name, key),
                })

        return parsed

    @classmethod
    def _get_aliases_for_field(cls, name: str, key: str) -> List[str]:
        """Builds a comprehensive list of match strings for a field."""
        aliases = set()
        norm_name = cls.normalize_text(name)
        norm_key = cls.normalize_text(key.replace("_", " "))

        if norm_name:
            aliases.add(norm_name)
        if norm_key:
            aliases.add(norm_key)

        # Check default dictionary for known aliases
        for dict_key, dict_aliases in cls.DEFAULT_FIELD_ALIASES.items():
            if dict_key == key or dict_key in key or key in dict_key or any(a in norm_name for a in dict_aliases):
                for a in dict_aliases:
                    aliases.add(cls.normalize_text(a))

        return list(aliases)

    @classmethod
    def match_label_text(cls, block_text: str, field_def: Dict[str, Any]) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Checks if a block's text contains or represents the label for field_def.

        Returns:
            Tuple of (is_match, inline_value_if_any, matched_label_substring)
        """
        if not block_text or not block_text.strip():
            return False, None, None

        raw_str = block_text.strip()
        norm_str = cls.normalize_text(raw_str)
        aliases = field_def.get("aliases", [])

        # Sort aliases by length descending so longer/more specific match first
        sorted_aliases = sorted(aliases, key=len, reverse=True)
        label_noise_words = {
            "no", "num", "number", "name", "code", "id", "type", "val",
            "cntr", "wt", "weight", "time", "date", "desc", "qty", "prodn", "production"
        }

        # Case 1: Text contains ':' separator (e.g. "Part No: PRT-4029" or "Shift: B" or "Opening Counter: 994")
        if ":" in raw_str:
            parts = raw_str.split(":", 1)
            prefix = cls.normalize_text(parts[0])
            inline_val = parts[1].strip()

            for alias in sorted_aliases:
                if prefix == alias or prefix.startswith(alias) or alias in prefix:
                    return True, inline_val if inline_val else None, parts[0].strip() + ":"

        # Case 2: Exact or prefix match without colon
        for alias in sorted_aliases:
            if norm_str == alias:
                return True, None, raw_str

            # Check if block starts with the label followed by value (e.g., "Part No 99465634" or "Shift B")
            if norm_str.startswith(alias + " "):
                remaining = norm_str[len(alias):].strip()
                if remaining and remaining not in label_noise_words:
                    return True, remaining, alias
                else:
                    return True, None, raw_str

            # Check fuzzy token overlap
            if len(alias) >= 4 and alias in norm_str:
                if len(alias) / max(1, len(norm_str)) >= 0.6:
                    return True, None, raw_str

        return False, None, None

    @classmethod
    def extract_fields(
        cls,
        ocr_blocks: List[Dict[str, Any]],
        template_fields: List[Dict[str, Any]],
        image_width: int = 2000,
        image_height: int = 3000,
        lookup_tables: Optional[Dict[str, List[str]]] = None,
    ) -> Tuple[List[ExtractedFieldMatch], str]:
        """
        Main spatial field extractor:
        Takes detected OCR blocks, identifies template field labels,
        and searches spatial neighborhood (right & below) for each field's value.

        Returns:
            Tuple of (extracted_field_matches, structured_text)
        """
        if not template_fields:
            return [], ""

        parsed_fields = cls.parse_template_fields(template_fields)
        if not parsed_fields:
            return [], ""

        logger.info(f"[SpatialFieldExtractor] Processing {len(parsed_fields)} template fields across {len(ocr_blocks)} OCR blocks.")

        # Step 1: Detect which OCR blocks correspond to field labels
        # Map: block_index -> (field_def, inline_value, matched_label_text)
        label_blocks_map: Dict[int, Tuple[Dict[str, Any], Optional[str], str]] = {}
        matched_fields_seen = set()

        for idx, block in enumerate(ocr_blocks):
            txt = block.get("text", block.get("raw_text", ""))
            for fdef in parsed_fields:
                fkey = fdef["key"]
                if fkey in matched_fields_seen:
                    continue  # Already matched this field

                is_match, inline_val, label_substr = cls.match_label_text(txt, fdef)
                if is_match:
                    label_blocks_map[idx] = (fdef, inline_val, label_substr or txt)
                    matched_fields_seen.add(fkey)
                    logger.info(f"  [LABEL DETECTED] Block #{idx} '{txt}' -> Field '{fdef['name']}' (Inline value: '{inline_val}')")
                    break

        label_indices = set(label_blocks_map.keys())
        claimed_block_indices = set(label_indices)

        # Step 2: For each template field, find its value spatially
        extracted_matches: List[ExtractedFieldMatch] = []
        structured_lines: List[str] = []

        # Prepare flat lookup list if provided
        flat_lookup: List[str] = []
        if lookup_tables:
            for _, vals in lookup_tables.items():
                flat_lookup.extend(vals)

        for fdef in parsed_fields:
            fname = fdef["name"]
            fkey = fdef["key"]
            ftype = fdef.get("type", "text")

            # Find if this field had a detected label block
            target_label_idx: Optional[int] = None
            inline_value: Optional[str] = None
            label_text: Optional[str] = None

            for b_idx, (matched_fdef, in_val, lbl_str) in label_blocks_map.items():
                if matched_fdef["key"] == fkey:
                    target_label_idx = b_idx
                    inline_value = in_val
                    label_text = lbl_str
                    break

            if target_label_idx is None:
                # Field label was not detected in document
                logger.info(f"  [FIELD NOT DETECTED] '{fname}' not found in OCR blocks.")
                match_obj = ExtractedFieldMatch(
                    field_name=fname,
                    field_key=fkey,
                    value="",
                    raw_value="",
                    label_text=None,
                    label_bbox=None,
                    value_bbox=None,
                    match_direction="not_found",
                    spatial_distance=None,
                    confidence=0.0,
                    confidence_level="LOW",
                    source=None,
                    is_valid=False,
                    validation_message="Field label not detected in document",
                )
                extracted_matches.append(match_obj)
                structured_lines.append(f"{fname}: ")
                continue

            lbl_block = ocr_blocks[target_label_idx]
            lbl_bbox = lbl_block.get("bbox", [0, 0, 0, 0])
            lbl_w = max(1, lbl_bbox[2] - lbl_bbox[0])
            lbl_h = max(1, lbl_bbox[3] - lbl_bbox[1])
            lbl_cx = (lbl_bbox[0] + lbl_bbox[2]) / 2.0
            lbl_cy = (lbl_bbox[1] + lbl_bbox[3]) / 2.0

            # Case A: Inline value already in the label block
            if inline_value and inline_value.strip():
                clean_val = inline_value.strip()
                val_bbox = [lbl_bbox[0] + int(lbl_w * 0.4), lbl_bbox[1], lbl_bbox[2], lbl_bbox[3]]
                conf = float(lbl_block.get("confidence", 0.95))

                # Validate
                is_valid = True
                val_msg = None
                if flat_lookup:
                    c_val, c_score, c_valid, c_msg = FieldValidator.lookup_table_correction(
                        clean_val, flat_lookup, threshold=0.80, strict=False
                    )
                    clean_val = c_val
                    is_valid = c_valid
                    val_msg = c_msg
                    conf = max(conf, c_score)

                conf_level = FieldValidator.classify_confidence(conf)

                match_obj = ExtractedFieldMatch(
                    field_name=fname,
                    field_key=fkey,
                    value=clean_val,
                    raw_value=inline_value,
                    label_text=label_text or lbl_block.get("text"),
                    label_bbox=lbl_bbox,
                    value_bbox=val_bbox,
                    match_direction="inline",
                    spatial_distance=0.0,
                    confidence=round(conf, 4),
                    confidence_level=conf_level,
                    source=lbl_block.get("source", "hybrid"),
                    is_valid=is_valid,
                    validation_message=val_msg,
                )
                extracted_matches.append(match_obj)
                structured_lines.append(f"{fname}: {clean_val}")
                logger.info(f"  [FIELD MATCH INLINE] '{fname}' -> '{clean_val}'")
                continue

            # Case B: Spatial Neighborhood Search (Right & Below)
            candidates_right: List[Tuple[float, int, Dict[str, Any]]] = []
            candidates_below: List[Tuple[float, int, Dict[str, Any]]] = []

            for c_idx, c_block in enumerate(ocr_blocks):
                if c_idx in claimed_block_indices:
                    continue  # Do not pick another field's label or already-claimed value

                c_text = c_block.get("text", c_block.get("raw_text", "")).strip()
                if not c_text or c_text in (":", ".", "-", "|", "/"):
                    continue

                if cls._is_label_or_header(c_text):
                    continue  # Do not pick other unconfigured field headers as values

                c_bbox = c_block.get("bbox", [0, 0, 0, 0])
                c_w = max(1, c_bbox[2] - c_bbox[0])
                c_h = max(1, c_bbox[3] - c_bbox[1])
                c_cx = (c_bbox[0] + c_bbox[2]) / 2.0
                c_cy = (c_bbox[1] + c_bbox[3]) / 2.0

                # 1. Evaluate RIGHT of label (Horizontal same-row pairing)
                # Starts after label begins and ends to the right
                if c_bbox[0] >= lbl_bbox[0] + int(lbl_w * 0.10) and c_bbox[2] > lbl_bbox[2] - 15:
                    cy_delta = abs(lbl_cy - c_cy)
                    max_h = max(lbl_h, c_h)
                    y_overlap = max(0, min(lbl_bbox[3], c_bbox[3]) - max(lbl_bbox[1], c_bbox[1]))

                    # Strict horizontal row alignment
                    if (y_overlap > 0 and cy_delta <= max_h * 0.70) or cy_delta <= 24.0:
                        dx = max(0, c_bbox[0] - lbl_bbox[2])
                        max_horiz_dist = max(650, int(image_width * 0.45))
                        if dx <= max_horiz_dist:
                            dist_right = dx + (3.0 * cy_delta)
                            if cy_delta <= 15.0:
                                dist_right *= 0.6  # High confidence same-line row bonus
                            candidates_right.append((dist_right, c_idx, c_block))

                # 2. Evaluate BELOW label (Vertical same-column pairing)
                if c_bbox[1] >= lbl_bbox[1] + int(lbl_h * 0.55):
                    cx_delta = abs(lbl_cx - c_cx)
                    max_w = max(lbl_w, c_w)
                    x_overlap = max(0, min(lbl_bbox[2], c_bbox[2]) - max(lbl_bbox[0], c_bbox[0]))

                    if x_overlap > 0 or cx_delta <= max_w * 1.20 or abs(c_bbox[0] - lbl_bbox[0]) <= 120:
                        dy = max(0, c_bbox[1] - lbl_bbox[3])
                        max_vert_dist = max(240, int(image_height * 0.10))
                        if dy <= max_vert_dist:
                            dist_below = (2.0 * cx_delta) + (1.5 * dy) + 80.0
                            candidates_below.append((dist_below, c_idx, c_block))

            # Select best candidate
            best_candidate: Optional[Dict[str, Any]] = None
            best_c_idx: Optional[int] = None
            chosen_direction: str = "right"
            min_dist: float = float("inf")

            candidates_right.sort(key=lambda x: x[0])
            candidates_below.sort(key=lambda x: x[0])

            if candidates_right and candidates_below:
                best_r_dist, best_r_idx, best_r_block = candidates_right[0]
                best_b_dist, best_b_idx, best_b_block = candidates_below[0]

                if best_b_dist < best_r_dist * 0.80:
                    best_candidate = best_b_block
                    best_c_idx = best_b_idx
                    chosen_direction = "below"
                    min_dist = best_b_dist
                else:
                    best_candidate = best_r_block
                    best_c_idx = best_r_idx
                    chosen_direction = "right"
                    min_dist = best_r_dist

            elif candidates_right:
                min_dist, best_c_idx, best_candidate = candidates_right[0]
                chosen_direction = "right"
            elif candidates_below:
                min_dist, best_c_idx, best_candidate = candidates_below[0]
                chosen_direction = "below"

            if best_candidate and best_c_idx is not None:
                claimed_block_indices.add(best_c_idx)
                val_text = best_candidate.get("text", best_candidate.get("raw_text", "")).strip()
                val_raw = best_candidate.get("raw_text", val_text)
                val_bbox = best_candidate.get("bbox", [0, 0, 0, 0])
                conf = float(best_candidate.get("confidence", 0.90))
                src = best_candidate.get("source", "hybrid")

                # Multi-token gathering: check if additional words continue immediately after on that line
                if chosen_direction in ("right", "below"):
                    val_text, val_raw, val_bbox, gathered_indices = cls._gather_consecutive_line_tokens(
                        best_candidate, ocr_blocks, label_indices
                    )
                    for gi in gathered_indices:
                        claimed_block_indices.add(gi)

                # Table lookup / validation
                is_valid = True
                val_msg = None
                if flat_lookup:
                    c_val, c_score, c_valid, c_msg = FieldValidator.lookup_table_correction(
                        val_text, flat_lookup, threshold=0.80, strict=False
                    )
                    val_text = c_val
                    is_valid = c_valid
                    val_msg = c_msg
                    conf = max(conf, c_score)

                if ftype and ftype != "text":
                    f_valid, f_msg = FieldValidator.validate_field_type(val_text, ftype)
                    if not f_valid:
                        is_valid = False
                        val_msg = f_msg

                conf_level = FieldValidator.classify_confidence(conf)

                match_obj = ExtractedFieldMatch(
                    field_name=fname,
                    field_key=fkey,
                    value=val_text,
                    raw_value=val_raw,
                    label_text=label_text or lbl_block.get("text"),
                    label_bbox=lbl_bbox,
                    value_bbox=val_bbox,
                    match_direction=chosen_direction,
                    spatial_distance=round(min_dist, 2),
                    confidence=round(conf, 4),
                    confidence_level=conf_level,
                    source=src,
                    is_valid=is_valid,
                    validation_message=val_msg,
                )
                extracted_matches.append(match_obj)
                structured_lines.append(f"{fname}: {val_text}")
                logger.info(f"  [FIELD MATCH {chosen_direction.upper()}] '{fname}' -> '{val_text}' (dist: {min_dist:.1f}px, bbox: {val_bbox})")

            else:
                logger.info(f"  [FIELD VALUE EMPTY] '{fname}' label found at {lbl_bbox}, but no adjacent value block.")
                match_obj = ExtractedFieldMatch(
                    field_name=fname,
                    field_key=fkey,
                    value="",
                    raw_value="",
                    label_text=label_text or lbl_block.get("text"),
                    label_bbox=lbl_bbox,
                    value_bbox=None,
                    match_direction="not_found",
                    spatial_distance=None,
                    confidence=0.5,
                    confidence_level="LOW",
                    source=lbl_block.get("source"),
                    is_valid=False,
                    validation_message="No adjacent value found near field label",
                )
                extracted_matches.append(match_obj)
                structured_lines.append(f"{fname}: ")

        structured_text_result = "\n".join(structured_lines).strip()
        logger.info(f"[SpatialFieldExtractor] Extracted {len(extracted_matches)} structured fields.")
        return extracted_matches, structured_text_result

    @classmethod
    def _gather_consecutive_line_tokens(
        cls,
        primary_block: Dict[str, Any],
        all_blocks: List[Dict[str, Any]],
        label_indices: set,
    ) -> Tuple[str, str, List[int], List[int]]:
        """
        Gathers adjacent value tokens situated directly to the right on the exact same line
        (e.g., 'FR' + 'BTM' -> 'FR BTM' or 'CNC' + 'Machine' -> 'CNC Machine').
        """
        cur_bbox = list(primary_block.get("bbox", [0, 0, 0, 0]))
        cur_h = max(1, cur_bbox[3] - cur_bbox[1])
        cur_cy = (cur_bbox[1] + cur_bbox[3]) / 2.0

        collected_texts = [primary_block.get("text", "").strip()]
        collected_raws = [primary_block.get("raw_text", "").strip()]
        gathered_indices: List[int] = []

        while True:
            next_token = None
            next_idx = None
            next_dist = float("inf")

            for idx, b in enumerate(all_blocks):
                if idx in label_indices or idx in gathered_indices:
                    continue
                b_text = b.get("text", "").strip()
                if not b_text or b_text in collected_texts or cls._is_label_or_header(b_text):
                    continue

                b_bbox = b.get("bbox", [0, 0, 0, 0])
                b_cy = (b_bbox[1] + b_bbox[3]) / 2.0
                b_h = max(1, b_bbox[3] - b_bbox[1])

                # Same line check
                if abs(cur_cy - b_cy) <= max(cur_h, b_h) * 0.65:
                    dx = b_bbox[0] - cur_bbox[2]
                    # Direct neighbor check (between 0 and 55 pixels for words in the same field value)
                    if 0 <= dx <= 55 and dx < next_dist:
                        next_dist = dx
                        next_token = b
                        next_idx = idx

            if next_token and next_idx is not None:
                gathered_indices.append(next_idx)
                collected_texts.append(next_token.get("text", "").strip())
                collected_raws.append(next_token.get("raw_text", "").strip())
                next_bbox = next_token.get("bbox", [0, 0, 0, 0])
                cur_bbox = [
                    min(cur_bbox[0], next_bbox[0]),
                    min(cur_bbox[1], next_bbox[1]),
                    max(cur_bbox[2], next_bbox[2]),
                    max(cur_bbox[3], next_bbox[3]),
                ]
            else:
                break

        full_text = " ".join(t for t in collected_texts if t).strip()
        full_raw = " ".join(r for r in collected_raws if r).strip()
        return full_text, full_raw, cur_bbox, gathered_indices

    @classmethod
    def _is_label_or_header(cls, text: str) -> bool:
        """Determines if a text block represents a form header, field label, or static disclaimer."""
        t = text.strip()
        if not t:
            return False

        # Ends with colon or dot-colon
        if t.endswith(":") or t.endswith(".:"):
            return True

        lower = t.lower()
        static_form_headers = [
            "cycle time",
            "statup time",
            "startup time",
            "operator",
            "no. of cavities",
            "purge weight",
            "runner weight",
            "ok component",
            "physical weight",
            "rm loading",
            "start time",
            "end time",
            "planned qty",
            "produced qty",
            "rejections",
            "safety shoe",
            "while handling",
            "demoulding",
            "brushing",
            "inspection",
            "shift-incharge",
            "mfg. head",
            "silver streaks",
            "short fill",
            "sink marks",
            "burn marks",
            "weld line",
            "air bubble",
            "pin hole",
            "power cut",
        ]
        for h in static_form_headers:
            if h in lower:
                return True
        return False

