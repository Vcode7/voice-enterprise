import re
import math
from typing import List, Dict, Any, Tuple, Optional, Callable, Set
from PIL import Image

from app.core.logger import logger
from app.models.schemas import (
    HandwritingFieldConfig,
    HandwritingTableColumnConfig,
    HandwritingTableConfig,
    HandwritingScanningTemplate,
    HandwritingFieldExtractionResult,
    HandwritingOcrResponse,
)


# ===========================================================================
# Dedicated Default Handwriting Scanning Template
# ===========================================================================
DEFAULT_HANDWRITING_TEMPLATE = HandwritingScanningTemplate(
    id="handwriting_scanning_default",
    name="Handwriting Scanning Template",
    description="Dedicated handwriting scanning template with direction-based field extraction and spatial table column alignment.",
    fields=[
        HandwritingFieldConfig(field_name="Part No", field_type="digital", value_type="h", look_for="right"),
        HandwritingFieldConfig(field_name="Machine Name", field_type="digital", value_type="h", look_for="right"),
        HandwritingFieldConfig(field_name="Description", field_type="digital", value_type="h", look_for="right"),
        HandwritingFieldConfig(field_name="Raw Material", field_type="digital", value_type="h", look_for="right"),
        HandwritingFieldConfig(field_name="Planned Production", field_type="digital", value_type="h", look_for="right"),
        HandwritingFieldConfig(field_name="Date", field_type="digital", value_type="h", look_for="right"),
        HandwritingFieldConfig(field_name="Shift", field_type="digital", value_type="d", look_for="right"),
        HandwritingFieldConfig(field_name="Batch No", field_type="digital", value_type="h", look_for="right"),
        HandwritingFieldConfig(field_name="Opening Cycle", field_type="digital", value_type="h", look_for="right"),
        HandwritingFieldConfig(field_name="Closing Cycle", field_type="digital", value_type="h", look_for="right"),
        HandwritingFieldConfig(field_name="Cycle Time", field_type="digital", value_type="h", look_for="right"),
        HandwritingFieldConfig(field_name="Startup Time", field_type="digital", value_type="h", look_for="right"),
        HandwritingFieldConfig(field_name="Operator", field_type="digital", value_type="h", look_for="right"),
        HandwritingFieldConfig(field_name="No of Cavities", field_type="digital", value_type="h", look_for="right"),
        HandwritingFieldConfig(field_name="Purge Weight", field_type="digital", value_type="h", look_for="right"),
        HandwritingFieldConfig(field_name="Runner Weight", field_type="digital", value_type="h", look_for="right"),
    ],
    table_columns=[
        HandwritingTableColumnConfig(column_name="Start Time", value_type="d"),
        HandwritingTableColumnConfig(column_name="End Time", value_type="d"),
        HandwritingTableColumnConfig(column_name="Planned Qty", value_type="h", is_number=True, calculate_total=True),
        HandwritingTableColumnConfig(column_name="Produced Qty", value_type="h", is_number=True, calculate_total=True),
        HandwritingTableColumnConfig(column_name="Rejection", value_type="h", is_number=True, calculate_total=True),
    ],
    tables=[
        HandwritingTableConfig(
            id="table_production_log",
            name="Production Table",
            columns=[
                HandwritingTableColumnConfig(column_name="Start Time", value_type="d"),
                HandwritingTableColumnConfig(column_name="End Time", value_type="d"),
                HandwritingTableColumnConfig(column_name="Planned Qty", value_type="h", is_number=True, calculate_total=True),
                HandwritingTableColumnConfig(column_name="Produced Qty", value_type="h", is_number=True, calculate_total=True),
                HandwritingTableColumnConfig(column_name="Rejection", value_type="h", is_number=True, calculate_total=True),
            ],
        ),
        HandwritingTableConfig(
            id="table_rejection",
            name="Rejection",
            columns=[
                HandwritingTableColumnConfig(column_name="STRUP", value_type="h", is_number=True, calculate_total=True),
                HandwritingTableColumnConfig(column_name="BD", value_type="h", is_number=True, calculate_total=True),
                HandwritingTableColumnConfig(column_name="SS", value_type="h", is_number=True, calculate_total=True),
                HandwritingTableColumnConfig(column_name="SM", value_type="h", is_number=True, calculate_total=True),
                HandwritingTableColumnConfig(column_name="BM", value_type="h", is_number=True, calculate_total=True),
                HandwritingTableColumnConfig(column_name="ST", value_type="h", is_number=True, calculate_total=True),
                HandwritingTableColumnConfig(column_name="WL", value_type="h", is_number=True, calculate_total=True),
                HandwritingTableColumnConfig(column_name="SC", value_type="h", is_number=True, calculate_total=True),
                HandwritingTableColumnConfig(column_name="PC", value_type="h", is_number=True, calculate_total=True),
                HandwritingTableColumnConfig(column_name="AB", value_type="h", is_number=True, calculate_total=True),
                HandwritingTableColumnConfig(column_name="PH", value_type="h", is_number=True, calculate_total=True),
                HandwritingTableColumnConfig(column_name="FS", value_type="h", is_number=True, calculate_total=True),
                HandwritingTableColumnConfig(column_name="TOTAL", value_type="h", is_number=True, calculate_total=True),
            ],
        ),
    ],
)


class HandwritingFieldExtractor:
    """
    Dedicated Handwriting Form and Table Extraction Engine.
    
    Key Features:
    1. Independent from Voice Entry templates.
    2. Digital field labels detected via PaddleOCR.
    3. Direction-based value extraction: 'right', 'left', 'up', 'down'.
    4. Adaptive spatial constraints with perpendicular alignment checking.
    5. Table header detection defining dynamic column boundaries.
    6. Strict horizontal X-alignment for table row extraction (missing values stay empty '').
    7. Routing: value_type 'h' -> crop region & TrOCR; value_type 'd' -> PaddleOCR result.
    """

    # Field aliases to maximize robust detection of digital labels
    FIELD_ALIASES: Dict[str, List[str]] = {
        "part no": ["part no", "part no.", "part number", "part#", "part_no", "partnum", "part"],
        "machine name": ["machine name", "machine name:", "machine", "mc name", "m/c name", "m/c", "mc no", "machine no"],
        "description": ["description", "description:", "desc", "part description", "item description", "desc."],
        "raw material": ["raw material", "raw material:", "material", "rm", "raw mat", "raw mat."],
        "planned production": ["planned production", "planned prodn", "planned prodn.", "planned prod", "plan prod", "planned qty", "planned"],
        "date": ["date", "date:", "dated", "production date", "mfg date"],
        "shift": ["shift", "shift:", "shift no", "shift code"],
        "batch no": ["batch no", "batch no.", "batch number", "batch#", "lot no", "lot number", "batch"],
        "opening cycle": ["opening cycle", "opening cycle:", "opening counter", "opening cntr", "start cycle", "initial cycle", "open cycle"],
        "closing cycle": ["closing cycle", "closing cycle:", "closing counter", "closing cntr", "end cycle", "final cycle", "close cycle"],
        "cycle time": ["cycle time", "cycle time:", "cycle time to", "c/t", "cycle", "sec/cycle"],
        "startup time": ["startup time", "startup time:", "statup time", "start up time"],
        "operator": ["operator", "operator:", "operator no", "operator name", "op", "op no", "op."],
        "no of cavities": ["no of cavities", "no. of cavities", "cavities", "no of cavity", "cavity count", "no. cavities"],
        "purge weight": ["purge weight", "purge wt", "purge weight:", "purge"],
        "runner weight": ["runner weight", "runner wt", "runner weight:", "runner"],
    }

    TABLE_HEADER_ALIASES: Dict[str, List[str]] = {
        "start time": ["start time", "start time:", "start", "time from", "from time", "st time"],
        "end time": ["end time", "end time:", "end", "time to", "to time"],
        "planned qty": ["planned qty", "planned qty.", "plan qty", "planned quantity", "target qty", "plan"],
        "produced qty": ["produced qty", "produced qty.", "prod qty", "produced quantity", "actual qty", "produced", "actual"],
        "rejection": ["rejection", "rejection:", "rej qty", "rej", "rejection qty", "reject"],
    }

    @classmethod
    def normalize_text(cls, text: str) -> str:
        """Strips punctuation, colons, dots, hyphens, and whitespace for normalized matching."""
        if not text:
            return ""
        cleaned = re.sub(r"[:\.\-_=]+", " ", text)
        return re.sub(r"\s+", " ", cleaned).strip().lower()

    @classmethod
    def match_field_label(cls, text: str, field_name: str) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Checks whether text matches a given field label.
        Returns: (is_match, inline_value_if_any, matched_label_prefix)
        """
        if not text or not text.strip():
            return False, None, None

        raw = text.strip()
        norm = cls.normalize_text(raw)
        norm_field = cls.normalize_text(field_name)

        aliases = cls.FIELD_ALIASES.get(norm_field, [norm_field])
        if norm_field not in aliases:
            aliases = [norm_field] + aliases

        # Check colon split (e.g. "Part No: PRT-4029" or "Shift: A")
        if ":" in raw:
            parts = raw.split(":", 1)
            prefix_norm = cls.normalize_text(parts[0])
            inline_val = parts[1].strip()

            for alias in aliases:
                if prefix_norm == alias or prefix_norm.startswith(alias) or alias in prefix_norm:
                    return True, inline_val if inline_val else None, parts[0].strip() + ":"

        # Direct match or prefix without colon
        for alias in aliases:
            if norm == alias:
                return True, None, raw
            if norm.startswith(alias + " "):
                remainder = raw[len(alias):].strip()
                return True, remainder if remainder else None, raw[:len(alias)].strip()
            if len(alias) >= 4 and alias in norm:
                if len(alias) / max(1, len(norm)) >= 0.7:
                    return True, None, raw

        return False, None, None

    @classmethod
    def match_table_header(cls, text: str, column_name: str) -> bool:
        """Checks whether text matches a configured table column header."""
        if not text or not text.strip():
            return False

        norm = cls.normalize_text(text)
        norm_col = cls.normalize_text(column_name)

        aliases = cls.TABLE_HEADER_ALIASES.get(norm_col, [norm_col])
        if norm_col not in aliases:
            aliases = [norm_col] + aliases

        for alias in aliases:
            if norm == alias:
                return True
            if norm.startswith(alias) or alias in norm:
                if len(alias) / max(1, len(norm)) >= 0.65:
                    return True

        return False

    @classmethod
    def extract_value_from_direction(
        cls,
        field_bbox: List[int],
        direction: str,
        ocr_regions: List[Dict[str, Any]],
        value_type: str = "h",
        excluded_indices: Optional[Set[int]] = None,
        reserved_texts: Optional[Set[str]] = None,
        image_size: Optional[Tuple[int, int]] = None,
    ) -> Dict[str, Any]:
        """
        Reusable spatial extraction function:
        extract_value_from_direction(field_bbox, direction, ocr_regions, value_type)
        
        Rules:
        - 'right': only consider regions whose position is to the right of the field.
        - 'left': only consider regions to the left.
        - 'up': only consider regions above.
        - 'down': only consider regions below.
        - Selects the first/nearest valid text region in that direction.
        - Avoids selecting unrelated fields, table headers, or already-claimed regions.
        - Uses bounding-box distance and alignment to determine the closest valid candidate.
        - Respects reasonable perpendicular alignment so text far away perpendicularly is not picked.
        - If no valid text region is found, returns an empty value.
        """
        dir_norm = direction.lower().strip()
        if dir_norm not in ("right", "left", "up", "down"):
            dir_norm = "right"

        fx1, fy1, fx2, fy2 = field_bbox
        fcx = (fx1 + fx2) / 2.0
        fcy = (fy1 + fy2) / 2.0
        fw = max(1, fx2 - fx1)
        fh = max(1, fy2 - fy1)

        img_w = image_size[0] if image_size else 2500
        img_h = image_size[1] if image_size else 3500

        excluded = set(excluded_indices) if excluded_indices else set()
        reserved = set(cls.normalize_text(t) for t in (reserved_texts or []))

        candidates: List[Tuple[float, int, Dict[str, Any]]] = []

        for idx, region in enumerate(ocr_regions):
            if idx in excluded:
                continue

            r_text = region.get("text", region.get("raw_text", "")).strip()
            if not r_text or r_text in (":", ".", "-", "|", "/"):
                continue

            # Exclude known field labels or table headers from being taken as values
            norm_r = cls.normalize_text(r_text)
            if norm_r in reserved:
                continue

            rx1, ry1, rx2, ry2 = region.get("bbox", [0, 0, 0, 0])
            rw = max(1, rx2 - rx1)
            rh = max(1, ry2 - ry1)
            rcx = (rx1 + rx2) / 2.0
            rcy = (ry1 + ry2) / 2.0

            # -------------------------------------------------------------
            # DIRECTION 1: RIGHT
            # -------------------------------------------------------------
            if dir_norm == "right":
                # Candidate must be to the right of the field
                if rcx > fcx and rx2 > fx2 - 15:
                    cy_delta = abs(fcy - rcy)
                    max_h = max(fh, rh)
                    y_overlap = max(0, min(fy2, ry2) - max(fy1, ry1))

                    # Perpendicular (vertical) alignment check
                    if (y_overlap > 0 and cy_delta <= max_h * 0.85) or cy_delta <= 28.0:
                        dx = max(0, rx1 - fx2)
                        max_dx = max(650, int(img_w * 0.45))
                        if dx <= max_dx:
                            dist = dx + (3.0 * cy_delta)
                            if cy_delta <= 14.0:
                                dist *= 0.65  # Bonus for high vertical alignment
                            candidates.append((dist, idx, region))

            # -------------------------------------------------------------
            # DIRECTION 2: LEFT
            # -------------------------------------------------------------
            elif dir_norm == "left":
                # Candidate must be to the left of the field
                if rcx < fcx and rx1 < fx1 + 15:
                    cy_delta = abs(fcy - rcy)
                    max_h = max(fh, rh)
                    y_overlap = max(0, min(fy2, ry2) - max(fy1, ry1))

                    if (y_overlap > 0 and cy_delta <= max_h * 0.85) or cy_delta <= 28.0:
                        dx = max(0, fx1 - rx2)
                        max_dx = max(650, int(img_w * 0.45))
                        if dx <= max_dx:
                            dist = dx + (3.0 * cy_delta)
                            if cy_delta <= 14.0:
                                dist *= 0.65
                            candidates.append((dist, idx, region))

            # -------------------------------------------------------------
            # DIRECTION 3: DOWN (BELOW)
            # -------------------------------------------------------------
            elif dir_norm == "down":
                # Candidate must be below the field
                if rcy > fcy and ry2 > fy2 - 10:
                    cx_delta = abs(fcx - rcx)
                    max_w = max(fw, rw)
                    x_overlap = max(0, min(fx2, rx2) - max(fx1, rx1))

                    # Perpendicular (horizontal) alignment check
                    if x_overlap > 0 or cx_delta <= max_w * 1.3 or abs(rx1 - fx1) <= 120:
                        dy = max(0, ry1 - fy2)
                        max_dy = max(350, int(img_h * 0.15))
                        if dy <= max_dy:
                            dist = (2.2 * cx_delta) + (1.2 * dy) + 40.0
                            candidates.append((dist, idx, region))

            # -------------------------------------------------------------
            # DIRECTION 4: UP (ABOVE)
            # -------------------------------------------------------------
            elif dir_norm == "up":
                # Candidate must be above the field
                if rcy < fcy and ry1 < fy1 + 10:
                    cx_delta = abs(fcx - rcx)
                    max_w = max(fw, rw)
                    x_overlap = max(0, min(fx2, rx2) - max(fx1, rx1))

                    if x_overlap > 0 or cx_delta <= max_w * 1.3 or abs(rx1 - fx1) <= 120:
                        dy = max(0, fy1 - ry2)
                        max_dy = max(350, int(img_h * 0.15))
                        if dy <= max_dy:
                            dist = (2.2 * cx_delta) + (1.2 * dy) + 40.0
                            candidates.append((dist, idx, region))

        if not candidates:
            return {
                "found": False,
                "bbox": None,
                "text": "",
                "confidence": 0.0,
                "indices": [],
            }

        # Select closest valid candidate
        candidates.sort(key=lambda c: c[0])
        best_dist, best_idx, best_region = candidates[0]

        val_bbox = list(best_region.get("bbox", [0, 0, 0, 0]))
        val_text = best_region.get("text", best_region.get("raw_text", "")).strip()
        val_conf = float(best_region.get("confidence", 0.90))
        claimed_indices = [best_idx]

        # Multi-token gathering for horizontal directions ('right' or 'left')
        if dir_norm in ("right", "left"):
            gathered_bbox, gathered_text, gathered_idxs = cls._gather_horizontal_tokens(
                best_region, ocr_regions, excluded | {best_idx}, reserved
            )
            if gathered_idxs:
                val_bbox = gathered_bbox
                val_text = gathered_text
                claimed_indices.extend(gathered_idxs)

        return {
            "found": True,
            "bbox": val_bbox,
            "text": val_text,
            "confidence": val_conf,
            "indices": claimed_indices,
            "distance": round(best_dist, 2),
        }

    @classmethod
    def _gather_horizontal_tokens(
        cls,
        base_region: Dict[str, Any],
        ocr_regions: List[Dict[str, Any]],
        excluded_indices: Set[int],
        reserved_texts: Set[str],
    ) -> Tuple[List[int], str, List[int]]:
        """Gathers subsequent contiguous text tokens on the same horizontal line."""
        b_bbox = list(base_region.get("bbox", [0, 0, 0, 0]))
        tokens = [(b_bbox[0], base_region.get("text", base_region.get("raw_text", "")).strip())]
        b_cy = (b_bbox[1] + b_bbox[3]) / 2.0
        b_h = max(1, b_bbox[3] - b_bbox[1])

        gathered_idxs: List[int] = []

        for idx, reg in enumerate(ocr_regions):
            if idx in excluded_indices:
                continue

            r_txt = reg.get("text", reg.get("raw_text", "")).strip()
            if not r_txt:
                continue
            if cls.normalize_text(r_txt) in reserved_texts:
                continue

            rb = reg.get("bbox", [0, 0, 0, 0])
            rcy = (rb[1] + rb[3]) / 2.0
            rh = max(1, rb[3] - rb[1])

            # Must be closely on the same line
            if abs(b_cy - rcy) <= max(b_h, rh) * 0.45 or abs(b_cy - rcy) <= 12.0:
                # Must be reasonably close horizontally (gap <= 90px)
                dx = rb[0] - b_bbox[2]
                if 0 <= dx <= 90:
                    tokens.append((rb[0], r_txt))
                    b_bbox[2] = max(b_bbox[2], rb[2])
                    b_bbox[1] = min(b_bbox[1], rb[1])
                    b_bbox[3] = max(b_bbox[3], rb[3])
                    gathered_idxs.append(idx)

        tokens.sort(key=lambda t: t[0])
        merged_text = " ".join(t[1] for t in tokens if t[1]).strip()
        return b_bbox, merged_text, gathered_idxs

    @classmethod
    def extract_table(
        cls,
        ocr_regions: List[Dict[str, Any]],
        table_columns: List[HandwritingTableColumnConfig],
        image_pil: Optional[Image.Image] = None,
        trocr_infer_fn: Optional[Callable[[List[Image.Image]], List[str]]] = None,
    ) -> Tuple[List[str], List[Dict[str, str]], List[Dict[str, Any]], Set[int]]:
        """
        Table Header Detection & Row Value Extraction with strict X-alignment.

        Pipeline:
        1. Run PaddleOCR (regions provided).
        2. Detect configured table headers (Start Time, End Time, Planned Qty, Produced Qty, Rejection).
        3. Detect Start Time to establish the header row. Search right for other headers.
        4. Define column boundaries/centers from detected headers.
        5. For each column, search downward for row cells. Validate X-axis alignment strictly.
        6. Missing values remain '' without shifting columns.
        7. For 'd' columns: use PaddleOCR text.
        8. For 'h' columns: crop cell region & run TrOCR.

        Returns:
            Tuple of (detected_header_names, structured_rows, raw_cells, claimed_indices)
        """
        if not table_columns:
            return [], [], [], set()

        claimed_table_indices: Set[int] = set()

        # Step 1: Detect Header Row
        # Look for Start Time or first column header
        first_col_name = table_columns[0].column_name if table_columns else "Start Time"
        start_time_match: Optional[Tuple[int, Dict[str, Any], HandwritingTableColumnConfig]] = None

        for idx, reg in enumerate(ocr_regions):
            txt = reg.get("text", reg.get("raw_text", ""))
            for col_cfg in table_columns:
                if cls.match_table_header(txt, col_cfg.column_name):
                    if col_cfg.column_name == first_col_name or start_time_match is None:
                        start_time_match = (idx, reg, col_cfg)
                        if col_cfg.column_name == first_col_name:
                            break
            if start_time_match and start_time_match[2].column_name == first_col_name:
                break

        if not start_time_match:
            logger.info("[HandwritingTable] No table header detected in document.")
            return [c.column_name for c in table_columns], [], [], set()

        st_idx, st_reg, st_cfg = start_time_match
        st_bbox = st_reg["bbox"]
        header_y1 = st_bbox[1]
        header_y2 = st_bbox[3]
        header_cy = (header_y1 + header_y2) / 2.0
        header_h = max(1, header_y2 - header_y1)

        claimed_table_indices.add(st_idx)

        # Step 2: Search horizontally to the right for other configured headers
        detected_headers: List[Dict[str, Any]] = [
            {
                "index": st_idx,
                "column_name": st_cfg.column_name,
                "value_type": st_cfg.value_type,
                "bbox": st_bbox,
                "cx": (st_bbox[0] + st_bbox[2]) / 2.0,
                "x1": st_bbox[0],
                "x2": st_bbox[2],
            }
        ]
        matched_col_names = {st_cfg.column_name}

        for idx, reg in enumerate(ocr_regions):
            if idx in claimed_table_indices:
                continue

            r_bbox = reg.get("bbox", [0, 0, 0, 0])
            r_cy = (r_bbox[1] + r_bbox[3]) / 2.0
            r_txt = reg.get("text", reg.get("raw_text", ""))

            # Header row horizontal alignment check
            if abs(r_cy - header_cy) <= max(24.0, header_h * 0.85):
                for col_cfg in table_columns:
                    if col_cfg.column_name in matched_col_names:
                        continue
                    if cls.match_table_header(r_txt, col_cfg.column_name):
                        detected_headers.append({
                            "index": idx,
                            "column_name": col_cfg.column_name,
                            "value_type": col_cfg.value_type,
                            "bbox": r_bbox,
                            "cx": (r_bbox[0] + r_bbox[2]) / 2.0,
                            "x1": r_bbox[0],
                            "x2": r_bbox[2],
                        })
                        matched_col_names.add(col_cfg.column_name)
                        claimed_table_indices.add(idx)
                        break

        # Sort detected headers from left to right by X1
        detected_headers.sort(key=lambda h: h["x1"])
        logger.info(
            f"[HandwritingTable] Detected {len(detected_headers)} table header(s): "
            f"{[h['column_name'] for h in detected_headers]}"
        )

        # Step 3: Compute Column Horizontal Boundaries
        # Midpoints between adjacent column headers establish column zones
        for i, col in enumerate(detected_headers):
            if i == 0:
                left_bound = max(0, col["x1"] - 45)
            else:
                prev_col = detected_headers[i - 1]
                left_bound = (prev_col["cx"] + col["cx"]) / 2.0

            if i == len(detected_headers) - 1:
                right_bound = col["x2"] + 120
            else:
                next_col = detected_headers[i + 1]
                right_bound = (col["cx"] + next_col["cx"]) / 2.0

            col["left_bound"] = left_bound
            col["right_bound"] = right_bound

        table_y_start = max(h["bbox"][3] for h in detected_headers) + 3
        table_x_min = min(h["left_bound"] for h in detected_headers)
        table_x_max = max(h["right_bound"] for h in detected_headers)

        # Step 4: Cluster Below-Header OCR Regions into Rows
        candidate_cells: List[Tuple[int, Dict[str, Any]]] = []
        for idx, reg in enumerate(ocr_regions):
            if idx in claimed_table_indices:
                continue

            rb = reg.get("bbox", [0, 0, 0, 0])
            rcx = (rb[0] + rb[2]) / 2.0
            ry1 = rb[1]

            # Strictly below the header row and within horizontal table bounds
            if ry1 >= table_y_start:
                if table_x_min - 30 <= rcx <= table_x_max + 30:
                    candidate_cells.append((idx, reg))

        if not candidate_cells:
            logger.info("[HandwritingTable] No row data found below table headers.")
            return [h["column_name"] for h in detected_headers], [], [], claimed_table_indices

        # Group candidate regions into rows by Y coordinate
        candidate_cells.sort(key=lambda item: (item[1]["bbox"][1] + item[1]["bbox"][3]) / 2.0)
        row_clusters: List[List[Tuple[int, Dict[str, Any]]]] = []

        for item in candidate_cells:
            idx, reg = item
            rb = reg["bbox"]
            rcy = (rb[1] + rb[3]) / 2.0
            rh = max(1, rb[3] - rb[1])

            matched_cluster = None
            for cluster in row_clusters:
                avg_y = sum((c[1]["bbox"][1] + c[1]["bbox"][3]) / 2.0 for c in cluster) / len(cluster)
                avg_h = sum(max(1, c[1]["bbox"][3] - c[1]["bbox"][1]) for c in cluster) / len(cluster)
                tolerance = max(15.0, max(avg_h, rh) * 0.70)
                if abs(rcy - avg_y) <= tolerance:
                    matched_cluster = cluster
                    break

            if matched_cluster is not None:
                matched_cluster.append(item)
            else:
                row_clusters.append([item])

        # Step 5: Assign cells in each row cluster to columns based strictly on horizontal X-alignment
        structured_rows: List[Dict[str, str]] = []
        raw_cell_records: List[Dict[str, Any]] = []
        trocr_crop_requests: List[Tuple[int, int, str, List[int]]] = []  # (row_idx, col_idx, col_name, bbox)

        for r_idx, cluster in enumerate(row_clusters):
            row_dict: Dict[str, str] = {h["column_name"]: "" for h in detected_headers}

            for c_idx, col in enumerate(detected_headers):
                col_name = col["column_name"]
                col_vtype = col["value_type"]
                col_left = col["left_bound"]
                col_right = col["right_bound"]
                col_cx = col["cx"]

                # Find candidates belonging to this column zone
                matching_items: List[Tuple[int, Dict[str, Any]]] = []
                for item in cluster:
                    idx, reg = item
                    rb = reg["bbox"]
                    rcx = (rb[0] + rb[2]) / 2.0

                    # Primary alignment check: center X falls inside column boundaries
                    if col_left <= rcx <= col_right:
                        matching_items.append(item)
                    else:
                        # Secondary overlap check with column header bbox
                        h_overlap = max(0, min(col["x2"], rb[2]) - max(col["x1"], rb[0]))
                        if h_overlap > 0 and h_overlap / max(1, rb[2] - rb[0]) >= 0.40:
                            matching_items.append(item)

                if matching_items:
                    # Mark indices as claimed
                    for m_idx, _ in matching_items:
                        claimed_table_indices.add(m_idx)

                    # Merge text and bounding box
                    matching_items.sort(key=lambda m: m[1]["bbox"][0])
                    cell_text = " ".join(
                        m[1].get("text", m[1].get("raw_text", "")).strip() for m in matching_items
                    ).strip()

                    cell_x1 = min(m[1]["bbox"][0] for m in matching_items)
                    cell_y1 = min(m[1]["bbox"][1] for m in matching_items)
                    cell_x2 = max(m[1]["bbox"][2] for m in matching_items)
                    cell_y2 = max(m[1]["bbox"][3] for m in matching_items)
                    cell_bbox = [cell_x1, cell_y1, cell_x2, cell_y2]

                    if col_vtype == "h":
                        # Queue for TrOCR inference on cropped region
                        row_dict[col_name] = cell_text  # Temporary PaddleOCR fallback
                        trocr_crop_requests.append((r_idx, c_idx, col_name, cell_bbox))
                    else:
                        # Digital text: use PaddleOCR directly
                        row_dict[col_name] = cell_text

                    raw_cell_records.append({
                        "row": r_idx + 1,
                        "column": col_name,
                        "value": cell_text,
                        "value_type": col_vtype,
                        "bbox": cell_bbox,
                    })
                else:
                    # Missing value: remains empty string without shifting
                    row_dict[col_name] = ""

            # Only append row if at least one column has a value
            if any(val.strip() for val in row_dict.values()):
                structured_rows.append(row_dict)

        # Step 6: Run TrOCR on all handwritten 'h' cell regions
        if trocr_crop_requests and image_pil is not None and trocr_infer_fn is not None:
            crop_images: List[Image.Image] = []
            img_w, img_h = image_pil.size

            for _, _, _, bbox in trocr_crop_requests:
                pad_x = 4
                pad_y = 3
                cx1 = max(0, bbox[0] - pad_x)
                cy1 = max(0, bbox[1] - pad_y)
                cx2 = min(img_w, bbox[2] + pad_x)
                cy2 = min(img_h, bbox[3] + pad_y)
                crop_pil = image_pil.crop((cx1, cy1, cx2, cy2))
                crop_images.append(crop_pil)

            try:
                trocr_results = trocr_infer_fn(crop_images)
                for req_i, (r_idx, _, col_name, _) in enumerate(trocr_crop_requests):
                    if r_idx < len(structured_rows) and req_i < len(trocr_results):
                        extracted_trocr = trocr_results[req_i].strip()
                        if extracted_trocr:
                            structured_rows[r_idx][col_name] = extracted_trocr
            except Exception as e:
                logger.error(f"[HandwritingTable] TrOCR inference error on table cells: {str(e)}")

        header_names = [h["column_name"] for h in detected_headers]
        return header_names, structured_rows, raw_cell_records, claimed_table_indices

    @classmethod
    def process_handwriting_extraction(
        cls,
        image_pil: Image.Image,
        ocr_regions: List[Dict[str, Any]],
        template: Optional[HandwritingScanningTemplate] = None,
        trocr_infer_fn: Optional[Callable[[List[Image.Image]], List[str]]] = None,
    ) -> HandwritingOcrResponse:
        """
        Main Handwriting Extraction Pipeline:
        1. Uses active HandwritingScanningTemplate (default if omitted).
        2. Detects table headers & extracts structured rows with strict horizontal alignment.
        3. Identifies normal field labels (PaddleOCR) and applies direction-based extraction ('right', 'left', 'up', 'down').
        4. Runs TrOCR only on cropped value regions for 'h' fields and 'h' table columns.
        5. Preserves empty values '' when no text is found (never guessing or shifting columns).
        """
        active_template = template or DEFAULT_HANDWRITING_TEMPLATE
        logger.info(f"[HandwritingPipeline] Starting extraction with template '{active_template.name}' ({len(active_template.fields)} fields, {len(active_template.table_columns)} table columns)")

        # Prepare reserved texts set
        reserved_texts = set()
        for f in active_template.fields:
            reserved_texts.add(cls.normalize_text(f.field_name))
        for c in active_template.table_columns:
            reserved_texts.add(cls.normalize_text(c.column_name))

        # -------------------------------------------------------------
        # STAGE 1: Table Extraction (Prioritize table zone so cells aren't claimed as form fields)
        # -------------------------------------------------------------
        table_headers, table_rows, _, claimed_indices = cls.extract_table(
            ocr_regions=ocr_regions,
            table_columns=active_template.table_columns,
            image_pil=image_pil,
            trocr_infer_fn=trocr_infer_fn,
        )

        # -------------------------------------------------------------
        # STAGE 2: Normal Field Label Detection & Directional Value Search
        # -------------------------------------------------------------
        # Find which OCR region matches each field's digital label
        field_label_map: Dict[str, Tuple[int, Dict[str, Any], Optional[str]]] = {}
        for f_cfg in active_template.fields:
            fname = f_cfg.field_name
            for idx, reg in enumerate(ocr_regions):
                if idx in claimed_indices:
                    continue
                txt = reg.get("text", reg.get("raw_text", ""))
                is_match, inline_val, _ = cls.match_field_label(txt, fname)
                if is_match:
                    field_label_map[fname] = (idx, reg, inline_val)
                    claimed_indices.add(idx)
                    break

        field_results: List[HandwritingFieldExtractionResult] = []
        field_values_map: Dict[str, str] = {}
        trocr_field_crops: List[Tuple[int, List[int]]] = []  # (field_result_index, bbox)

        for f_cfg in active_template.fields:
            fname = f_cfg.field_name
            vtype = f_cfg.value_type  # 'h' or 'd'
            direction = f_cfg.look_for  # 'right', 'left', 'up', 'down'

            if fname not in field_label_map:
                # Label not detected
                field_results.append(
                    HandwritingFieldExtractionResult(
                        field_name=fname,
                        field_type="digital",
                        value_type=vtype,
                        look_for=direction,
                        value="",
                        raw_value="",
                        label_bbox=None,
                        value_bbox=None,
                        confidence=0.0,
                        source="trocr" if vtype == "h" else "paddleocr",
                    )
                )
                field_values_map[fname] = ""
                continue

            lbl_idx, lbl_reg, inline_val = field_label_map[fname]
            lbl_bbox = list(lbl_reg.get("bbox", [0, 0, 0, 0]))

            # Check if value was inline inside the same box (e.g. "Shift: A")
            if inline_val and inline_val.strip():
                clean_inline = inline_val.strip()
                val_bbox = [
                    lbl_bbox[0] + int((lbl_bbox[2] - lbl_bbox[0]) * 0.45),
                    lbl_bbox[1],
                    lbl_bbox[2],
                    lbl_bbox[3],
                ]

                res = HandwritingFieldExtractionResult(
                    field_name=fname,
                    field_type="digital",
                    value_type=vtype,
                    look_for=direction,
                    value=clean_inline,
                    raw_value=inline_val,
                    label_bbox=lbl_bbox,
                    value_bbox=val_bbox,
                    confidence=float(lbl_reg.get("confidence", 0.95)),
                    source="paddleocr" if vtype == "d" else "trocr",
                )
                curr_idx = len(field_results)
                field_results.append(res)
                field_values_map[fname] = clean_inline

                if vtype == "h":
                    trocr_field_crops.append((curr_idx, val_bbox))
                continue

            # Otherwise, use direction-based spatial extraction: extract_value_from_direction
            extraction = cls.extract_value_from_direction(
                field_bbox=lbl_bbox,
                direction=direction,
                ocr_regions=ocr_regions,
                value_type=vtype,
                excluded_indices=claimed_indices,
                reserved_texts=reserved_texts,
                image_size=image_pil.size if image_pil else (2500, 3500),
            )

            if extraction["found"]:
                for c_idx in extraction["indices"]:
                    claimed_indices.add(c_idx)

                res = HandwritingFieldExtractionResult(
                    field_name=fname,
                    field_type="digital",
                    value_type=vtype,
                    look_for=direction,
                    value=extraction["text"],
                    raw_value=extraction["text"],
                    label_bbox=lbl_bbox,
                    value_bbox=extraction["bbox"],
                    confidence=extraction["confidence"],
                    source="paddleocr" if vtype == "d" else "trocr",
                )
                curr_idx = len(field_results)
                field_results.append(res)
                field_values_map[fname] = extraction["text"]

                if vtype == "h" and extraction["bbox"]:
                    trocr_field_crops.append((curr_idx, extraction["bbox"]))
            else:
                # No value found in direction: return empty string
                field_results.append(
                    HandwritingFieldExtractionResult(
                        field_name=fname,
                        field_type="digital",
                        value_type=vtype,
                        look_for=direction,
                        value="",
                        raw_value="",
                        label_bbox=lbl_bbox,
                        value_bbox=None,
                        confidence=0.0,
                        source="trocr" if vtype == "h" else "paddleocr",
                    )
                )
                field_values_map[fname] = ""

        # -------------------------------------------------------------
        # STAGE 3: Run TrOCR on 'h' field value crops
        # -------------------------------------------------------------
        if trocr_field_crops and image_pil is not None and trocr_infer_fn is not None:
            field_crops: List[Image.Image] = []
            img_w, img_h = image_pil.size

            for _, bbox in trocr_field_crops:
                pad_x = 4
                pad_y = 3
                cx1 = max(0, bbox[0] - pad_x)
                cy1 = max(0, bbox[1] - pad_y)
                cx2 = min(img_w, bbox[2] + pad_x)
                cy2 = min(img_h, bbox[3] + pad_y)
                crop_pil = image_pil.crop((cx1, cy1, cx2, cy2))
                field_crops.append(crop_pil)

            try:
                trocr_res = trocr_infer_fn(field_crops)
                for i, (res_idx, _) in enumerate(trocr_field_crops):
                    if i < len(trocr_res) and res_idx < len(field_results):
                        t_val = trocr_res[i].strip()
                        if t_val:
                            field_results[res_idx].value = t_val
                            field_values_map[field_results[res_idx].field_name] = t_val
            except Exception as e:
                logger.error(f"[HandwritingPipeline] TrOCR field crop inference error: {str(e)}")

        # -------------------------------------------------------------
        # Format Structured Output Text
        # -------------------------------------------------------------
        lines: List[str] = []
        for f in field_results:
            lines.append(f"{f.field_name}: {f.value}")

        if table_rows:
            lines.append("\nTable Data:")
            lines.append(" | ".join(table_headers))
            for row in table_rows:
                lines.append(" | ".join(row.get(h, "") for h in table_headers))

        structured_text = "\n".join(lines).strip()
        raw_text = "\n".join(r.get("raw_text", r.get("text", "")) for r in ocr_regions if r.get("text")).strip()

        return HandwritingOcrResponse(
            success=True,
            filename=None,
            template_name=active_template.name,
            fields=field_results,
            field_values=field_values_map,
            table_headers=table_headers,
            table_rows=table_rows,
            structured_text=structured_text,
            raw_text=raw_text,
            total_pages=1,
            processing_time_ms=0.0,
            device="",
        )
