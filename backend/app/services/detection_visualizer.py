import os
import re
from pathlib import Path
from typing import List, Dict, Any, Optional
from PIL import Image, ImageDraw, ImageFont

from app.core.logger import logger
from app.models.schemas import HandwritingOcrResponse


class DetectionVisualizer:
    """
    Debug-only visualizer for Chandra V2 / Detected Region OCR pipelines.
    Generates annotated debug images highlighting:
      1. Raw detected region boxes (before filtering/post-processing).
      2. Assigned field label boxes.
      3. Assigned value/input boxes (with distinct visual styling/color).
      4. Spatial connector lines linking labels to their assigned values.
    Saves debug images inside the /detection directory without modifying
    any detection, filtering, or downstream extraction logic.
    """

    # Color Palette (RGB)
    COLOR_RAW_REGION = (245, 158, 11)     # Amber / Orange for raw detected regions
    COLOR_LABEL_BOX = (37, 99, 235)       # Royal Blue for detected field labels
    COLOR_VALUE_BOX = (16, 185, 129)      # Emerald Green for detected value/input boxes
    COLOR_CONNECTOR = (236, 72, 153)      # Magenta / Pink for label-to-value spatial links
    COLOR_TABLE_CELL = (14, 165, 233)     # Sky Blue for table cells
    COLOR_BANNER_BG = (15, 23, 42)        # Dark Slate for legend & tag backgrounds
    COLOR_TEXT_WHITE = (255, 255, 255)    # White text

    @classmethod
    def get_detection_directory(cls) -> Path:
        """
        Returns the absolute path to the detection debug folder.
        Creates the folder if it does not already exist.
        """
        backend_dir = Path(__file__).resolve().parent.parent.parent
        detection_dir = backend_dir / "detection"
        detection_dir.mkdir(parents=True, exist_ok=True)
        return detection_dir

    @classmethod
    def save_debug_image(
        cls,
        base_image: Image.Image,
        ocr_regions: List[Dict[str, Any]],
        extraction_result: HandwritingOcrResponse,
        filename: Optional[str] = None,
        page_idx: int = 1,
        custom_output_dir: Optional[Path] = None,
    ) -> Path:
        """
        Draws raw detected regions, label boxes, and value/input boxes on a copy
        of the base image, saves it to the /detection folder, and logs the path.

        Visual Debugging Only: Never mutates base_image or extraction_result.
        """
        try:
            target_dir = custom_output_dir or cls.get_detection_directory()
            target_dir.mkdir(parents=True, exist_ok=True)

            # Build safe source-tied filename
            safe_source = "document"
            if filename:
                clean = re.sub(r"[^\w\-_]", "_", Path(filename).stem)
                if clean.strip("_"):
                    safe_source = clean.strip("_")

            debug_filename = f"detected_regions_{safe_source}_page_{page_idx}.png"
            output_path = target_dir / debug_filename

            # Create RGB copy to draw on
            annotated = base_image.copy().convert("RGB")
            draw = ImageDraw.Draw(annotated, "RGBA")

            img_w, img_h = annotated.size

            # Dynamic font sizing based on document resolution
            base_font_size = max(14, int(img_w / 110))
            small_font_size = max(11, int(base_font_size * 0.75))
            title_font_size = max(18, int(base_font_size * 1.3))

            try:
                font_main = ImageFont.truetype("arial.ttf", size=base_font_size)
                font_small = ImageFont.truetype("arial.ttf", size=small_font_size)
                font_title = ImageFont.truetype("arialbd.ttf", size=title_font_size)
            except Exception:
                font_main = ImageFont.load_default()
                font_small = ImageFont.load_default()
                font_title = ImageFont.load_default()

            # -----------------------------------------------------------------
            # 1. RAW DETECTED REGION BOXES (Before Filtering / Post-Processing)
            # -----------------------------------------------------------------
            for idx, reg in enumerate(ocr_regions, start=1):
                bbox = reg.get("bbox")
                if not bbox or len(bbox) != 4:
                    continue

                x1, y1, x2, y2 = bbox
                text = reg.get("text", reg.get("raw_text", "")).strip()
                conf = float(reg.get("confidence", 0.0))

                # Outline raw detected box
                draw.rectangle([(x1, y1), (x2, y2)], outline=cls.COLOR_RAW_REGION, width=2)

                # Small tag above or inside the top of the box
                tag = f"#{idx} '{text[:22]}' ({conf:.2f})"
                tag_w = len(tag) * (small_font_size // 2 + 2) + 6
                tag_h = small_font_size + 6
                tag_y1 = max(0, y1 - tag_h)
                tag_y2 = y1 if y1 >= tag_h else y1 + tag_h

                # Semi-transparent tag background
                draw.rectangle(
                    [(x1, tag_y1), (x1 + tag_w, tag_y2)],
                    fill=(245, 158, 11, 200),
                )
                draw.text(
                    (x1 + 3, tag_y1 + 2),
                    tag,
                    fill=(0, 0, 0),
                    font=font_small,
                )

            # -----------------------------------------------------------------
            # 2. FIELD LABEL & VALUE / INPUT BOXES (Extracted by Chandra)
            # -----------------------------------------------------------------
            for fld in extraction_result.fields:
                fname = fld.field_name
                val = fld.value.strip() if fld.value else ""
                lbl_box = fld.label_bbox
                val_box = fld.value_bbox
                direction = getattr(fld, "look_for", "right")

                # Draw Label Box (Royal Blue)
                if lbl_box and len(lbl_box) == 4:
                    lx1, ly1, lx2, ly2 = lbl_box
                    draw.rectangle([(lx1, ly1), (lx2, ly2)], outline=cls.COLOR_LABEL_BOX, width=4)

                    lbl_tag = f"[LABEL] {fname}"
                    lbl_tag_w = len(lbl_tag) * (base_font_size // 2 + 2) + 8
                    lbl_tag_h = base_font_size + 6
                    lbl_y1 = max(0, ly1 - lbl_tag_h)

                    draw.rectangle(
                        [(lx1, lbl_y1), (lx1 + lbl_tag_w, ly1)],
                        fill=cls.COLOR_LABEL_BOX,
                    )
                    draw.text((lx1 + 4, lbl_y1 + 2), lbl_tag, fill=cls.COLOR_TEXT_WHITE, font=font_main)

                # Draw Value / Input Box (Emerald Green - visually distinct)
                if val_box and len(val_box) == 4:
                    vx1, vy1, vx2, vy2 = val_box
                    # Draw thick distinctive box with inner fill accent
                    draw.rectangle([(vx1, vy1), (vx2, vy2)], outline=cls.COLOR_VALUE_BOX, width=4)
                    draw.rectangle([(vx1, vy1), (vx2, vy2)], fill=(16, 185, 129, 35))

                    val_tag = f"[INPUT/VALUE: {fname}] = '{val}'" if val else f"[INPUT BOX: {fname}] (empty)"
                    val_tag_w = len(val_tag) * (base_font_size // 2 + 2) + 8
                    val_tag_h = base_font_size + 6
                    val_y1 = max(0, vy1 - val_tag_h)

                    draw.rectangle(
                        [(vx1, val_y1), (vx1 + val_tag_w, vy1)],
                        fill=cls.COLOR_VALUE_BOX,
                    )
                    draw.text((vx1 + 4, val_y1 + 2), val_tag, fill=cls.COLOR_TEXT_WHITE, font=font_main)

                # Draw Spatial Connector Line (Magenta) linking Label to Value
                if lbl_box and val_box and len(lbl_box) == 4 and len(val_box) == 4:
                    lc_x = (lbl_box[0] + lbl_box[2]) // 2
                    lc_y = (lbl_box[1] + lbl_box[3]) // 2
                    vc_x = (val_box[0] + val_box[2]) // 2
                    vc_y = (val_box[1] + val_box[3]) // 2

                    draw.line([(lc_x, lc_y), (vc_x, vc_y)], fill=cls.COLOR_CONNECTOR, width=3)
                    # Midpoint tag showing search direction
                    mid_x = (lc_x + vc_x) // 2
                    mid_y = (lc_y + vc_y) // 2
                    dir_tag = f"dir: {direction}"
                    dir_tag_w = len(dir_tag) * (small_font_size // 2 + 2) + 6
                    draw.rectangle(
                        [(mid_x - dir_tag_w // 2, mid_y - 8), (mid_x + dir_tag_w // 2, mid_y + 10)],
                        fill=(15, 23, 42, 220),
                    )
                    draw.text(
                        (mid_x - dir_tag_w // 2 + 3, mid_y - 7),
                        dir_tag,
                        fill=cls.COLOR_CONNECTOR,
                        font=font_small,
                    )

            # -----------------------------------------------------------------
            # 3. DEBUG LEGEND HEADER BANNER
            # -----------------------------------------------------------------
            legend_h = max(55, title_font_size + 30)
            draw.rectangle([(0, 0), (img_w, legend_h)], fill=(15, 23, 42, 230))

            title_text = f"Chandra V2 Detected Region Debug — Source: {safe_source} | Page: {page_idx}"
            draw.text((15, 8), title_text, fill=cls.COLOR_TEXT_WHITE, font=font_title)

            # Legend keys
            legend_items = [
                (cls.COLOR_RAW_REGION, "Raw Detected Regions"),
                (cls.COLOR_LABEL_BOX, "Field Label Boxes"),
                (cls.COLOR_VALUE_BOX, "Value / Input Boxes"),
                (cls.COLOR_CONNECTOR, "Label->Value Assignment Link"),
            ]
            key_x = 15
            key_y = title_font_size + 14
            for color, desc in legend_items:
                draw.rectangle([(key_x, key_y + 2), (key_x + 14, key_y + 14)], fill=color)
                draw.text((key_x + 18, key_y), desc, fill=cls.COLOR_TEXT_WHITE, font=font_small)
                key_x += len(desc) * (small_font_size // 2 + 2) + 38

            # Save annotated image
            annotated.save(output_path, format="PNG")
            logger.info(f"[Chandra2-DetectRegion] Saved debug visualization image to: {output_path.resolve()}")
            return output_path

        except Exception as e:
            logger.warning(f"[Chandra2-DetectRegion] Failed to generate debug visualization image: {str(e)}", exc_info=True)
            return Path()
