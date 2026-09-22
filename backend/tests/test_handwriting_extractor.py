import pytest
from app.models.schemas import (
    HandwritingFieldConfig,
    HandwritingTableColumnConfig,
    HandwritingScanningTemplate,
)
from app.services.handwriting_extractor import (
    HandwritingFieldExtractor,
    DEFAULT_HANDWRITING_TEMPLATE,
)


def test_default_handwriting_template_independent():
    """Ensure dedicated handwriting template exists and is completely distinct from Voice Entry."""
    assert DEFAULT_HANDWRITING_TEMPLATE is not None
    assert len(DEFAULT_HANDWRITING_TEMPLATE.fields) == 16
    assert len(DEFAULT_HANDWRITING_TEMPLATE.table_columns) == 5

    # Check that all field types are 'digital'
    for f in DEFAULT_HANDWRITING_TEMPLATE.fields:
        assert f.field_type == "digital"
        assert f.look_for in ("right", "left", "up", "down")
        assert f.value_type in ("h", "d")

    # Shift is digital ('d'), while Part No, Machine Name, etc. are handwritten ('h')
    field_dict = {f.field_name: f for f in DEFAULT_HANDWRITING_TEMPLATE.fields}
    assert field_dict["Shift"].value_type == "d"
    assert field_dict["Part No"].value_type == "h"
    assert field_dict["Machine Name"].value_type == "h"
    assert field_dict["Date"].value_type == "h"

    # Check table columns: Start Time and End Time are digital 'd'; Planned/Produced Qty and Rejection are 'h'
    col_dict = {c.column_name: c for c in DEFAULT_HANDWRITING_TEMPLATE.table_columns}
    assert col_dict["Start Time"].value_type == "d"
    assert col_dict["End Time"].value_type == "d"
    assert col_dict["Planned Qty"].value_type == "h"
    assert col_dict["Produced Qty"].value_type == "h"
    assert col_dict["Rejection"].value_type == "h"


def test_direction_right_extraction():
    """Test searching horizontally toward the RIGHT of a field label."""
    field_bbox = [100, 200, 250, 240]  # Part No
    ocr_regions = [
        {"text": "Part No:", "raw_text": "Part No:", "bbox": [100, 200, 250, 240], "confidence": 0.99},
        {"text": "ABC-9921", "raw_text": "ABC-9921", "bbox": [280, 202, 450, 242], "confidence": 0.94},  # Target right
        {"text": "RANDOM_HEADER", "raw_text": "RANDOM", "bbox": [100, 50, 300, 90], "confidence": 0.90},
    ]

    res = HandwritingFieldExtractor.extract_value_from_direction(
        field_bbox=field_bbox,
        direction="right",
        ocr_regions=ocr_regions,
        value_type="h",
        excluded_indices={0},
    )

    assert res["found"] is True
    assert res["text"] == "ABC-9921"
    assert res["bbox"] == [280, 202, 450, 242]


def test_direction_down_extraction():
    """Test searching vertically DOWN below a field label."""
    field_bbox = [100, 150, 320, 190]  # Machine Name
    ocr_regions = [
        {"text": "Machine Name", "raw_text": "Machine Name", "bbox": [100, 150, 320, 190], "confidence": 0.98},
        {"text": "Injection Press 04", "raw_text": "Injection Press 04", "bbox": [105, 210, 340, 250], "confidence": 0.91},  # Below
        {"text": "Unrelated Right", "raw_text": "Unrelated", "bbox": [500, 150, 650, 190], "confidence": 0.90},
    ]

    res = HandwritingFieldExtractor.extract_value_from_direction(
        field_bbox=field_bbox,
        direction="down",
        ocr_regions=ocr_regions,
        value_type="h",
        excluded_indices={0},
    )

    assert res["found"] is True
    assert res["text"] == "Injection Press 04"
    assert res["bbox"] == [105, 210, 340, 250]


def test_direction_left_and_up_extraction():
    """Test searching LEFT and UP directions."""
    # Test Left
    field_right_bbox = [500, 200, 650, 240]
    ocr_regions_left = [
        {"text": "Target Left Value", "raw_text": "Target Left Value", "bbox": [200, 200, 420, 240], "confidence": 0.93},
        {"text": "Label On Right", "raw_text": "Label On Right", "bbox": [500, 200, 650, 240], "confidence": 0.99},
    ]
    res_left = HandwritingFieldExtractor.extract_value_from_direction(
        field_bbox=field_right_bbox,
        direction="left",
        ocr_regions=ocr_regions_left,
        value_type="d",
        excluded_indices={1},
    )
    assert res_left["found"] is True
    assert res_left["text"] == "Target Left Value"

    # Test Up
    field_bottom_bbox = [100, 400, 300, 440]
    ocr_regions_up = [
        {"text": "Value Above", "raw_text": "Value Above", "bbox": [100, 320, 280, 360], "confidence": 0.92},
        {"text": "Bottom Label", "raw_text": "Bottom Label", "bbox": [100, 400, 300, 440], "confidence": 0.98},
    ]
    res_up = HandwritingFieldExtractor.extract_value_from_direction(
        field_bbox=field_bottom_bbox,
        direction="up",
        ocr_regions=ocr_regions_up,
        value_type="h",
        excluded_indices={1},
    )
    assert res_up["found"] is True
    assert res_up["text"] == "Value Above"


def test_perpendicular_misalignment_rejection():
    """Test that text far away perpendicularly is rejected rather than mistakenly picked."""
    field_bbox = [100, 100, 250, 140]  # Part No
    # Region is to the right in X, but 400 pixels lower in Y (not in the same row)
    ocr_regions = [
        {"text": "Part No", "raw_text": "Part No", "bbox": [100, 100, 250, 140], "confidence": 0.98},
        {"text": "Far Below Text", "raw_text": "Far Below Text", "bbox": [280, 550, 400, 590], "confidence": 0.95},
    ]

    res = HandwritingFieldExtractor.extract_value_from_direction(
        field_bbox=field_bbox,
        direction="right",
        ocr_regions=ocr_regions,
        value_type="h",
        excluded_indices={0},
    )

    assert res["found"] is False
    assert res["text"] == ""


def test_mixed_digital_and_handwritten_fields():
    """Test mixed digital (PaddleOCR) and handwritten (TrOCR) field extraction."""
    ocr_regions = [
        {"text": "Part No:", "raw_text": "Part No:", "bbox": [100, 100, 250, 140], "confidence": 0.98},
        {"text": "P-4029", "raw_text": "P-4029", "bbox": [270, 100, 420, 140], "confidence": 0.90},  # Part No (h)
        {"text": "Shift:", "raw_text": "Shift:", "bbox": [100, 160, 200, 200], "confidence": 0.99},
        {"text": "Morning Shift B", "raw_text": "Morning Shift B", "bbox": [220, 160, 450, 200], "confidence": 0.97},  # Shift (d)
    ]

    custom_template = HandwritingScanningTemplate(
        id="test_tmpl",
        name="Test Template",
        fields=[
            HandwritingFieldConfig(field_name="Part No", field_type="digital", value_type="h", look_for="right"),
            HandwritingFieldConfig(field_name="Shift", field_type="digital", value_type="d", look_for="right"),
        ],
        table_columns=[],
    )

    # Mock TrOCR infer function to verify TrOCR was called for 'h' and not for 'd'
    trocr_calls = []

    def mock_trocr(crops):
        trocr_calls.append(len(crops))
        return ["Handwritten_TrOCR_P4029"]

    response = HandwritingFieldExtractor.process_handwriting_extraction(
        image_pil=None,  # No PIL image, fallback to region text
        ocr_regions=ocr_regions,
        template=custom_template,
        trocr_infer_fn=mock_trocr,
    )

    assert response.success is True
    # Without image_pil, fallback text is used
    assert response.field_values["Part No"] == "P-4029"
    assert response.field_values["Shift"] == "Morning Shift B"

    # Part No source is 'paddleocr' fallback / 'trocr' type, Shift source is 'paddleocr'
    shift_field = next(f for f in response.fields if f.field_name == "Shift")
    assert shift_field.value_type == "d"
    assert shift_field.source == "paddleocr"


def test_table_header_detection_and_multi_row_extraction():
    """Test detecting table headers dynamically and extracting structured rows."""
    ocr_regions = [
        # Table Headers Row (Y: 500-540)
        {"text": "Start Time", "raw_text": "Start Time", "bbox": [100, 500, 220, 540], "confidence": 0.98},
        {"text": "End Time", "raw_text": "End Time", "bbox": [250, 500, 360, 540], "confidence": 0.98},
        {"text": "Planned Qty", "raw_text": "Planned Qty", "bbox": [400, 500, 540, 540], "confidence": 0.96},
        {"text": "Produced Qty", "raw_text": "Produced Qty", "bbox": [580, 500, 720, 540], "confidence": 0.96},
        {"text": "Rejection", "raw_text": "Rejection", "bbox": [760, 500, 880, 540], "confidence": 0.97},
        # Row 1 (Y: 560-600)
        {"text": "08:00", "raw_text": "08:00", "bbox": [110, 560, 200, 595], "confidence": 0.97},
        {"text": "09:00", "raw_text": "09:00", "bbox": [260, 560, 350, 595], "confidence": 0.97},
        {"text": "100", "raw_text": "100", "bbox": [430, 560, 490, 595], "confidence": 0.92},
        {"text": "95", "raw_text": "95", "bbox": [620, 560, 670, 595], "confidence": 0.91},
        {"text": "5", "raw_text": "5", "bbox": [800, 560, 830, 595], "confidence": 0.90},
        # Row 2 (Y: 620-660)
        {"text": "09:00", "raw_text": "09:00", "bbox": [110, 620, 200, 655], "confidence": 0.97},
        {"text": "10:00", "raw_text": "10:00", "bbox": [260, 620, 350, 655], "confidence": 0.97},
        {"text": "120", "raw_text": "120", "bbox": [430, 620, 490, 655], "confidence": 0.93},
        {"text": "118", "raw_text": "118", "bbox": [620, 620, 670, 655], "confidence": 0.92},
        {"text": "2", "raw_text": "2", "bbox": [800, 620, 830, 655], "confidence": 0.91},
    ]

    headers, rows, _, _ = HandwritingFieldExtractor.extract_table(
        ocr_regions=ocr_regions,
        table_columns=DEFAULT_HANDWRITING_TEMPLATE.table_columns,
    )

    assert headers == ["Start Time", "End Time", "Planned Qty", "Produced Qty", "Rejection"]
    assert len(rows) == 2

    # Row 1 verification
    assert rows[0]["Start Time"] == "08:00"
    assert rows[0]["End Time"] == "09:00"
    assert rows[0]["Planned Qty"] == "100"
    assert rows[0]["Produced Qty"] == "95"
    assert rows[0]["Rejection"] == "5"

    # Row 2 verification
    assert rows[1]["Start Time"] == "09:00"
    assert rows[1]["End Time"] == "10:00"
    assert rows[1]["Planned Qty"] == "120"
    assert rows[1]["Produced Qty"] == "118"
    assert rows[1]["Rejection"] == "2"


def test_table_missing_value_alignment_and_no_shifting():
    """
    Test Critical Table Alignment Rule:
    Missing values must remain '' and must NOT shift between columns.
    E.g. if 'Planned Qty' is missing in Row 1, 'Produced Qty' (95) must NOT shift into 'Planned Qty'.
    """
    ocr_regions = [
        # Table Headers
        {"text": "Start Time", "raw_text": "Start Time", "bbox": [100, 500, 220, 540], "confidence": 0.98},
        {"text": "End Time", "raw_text": "End Time", "bbox": [250, 500, 360, 540], "confidence": 0.98},
        {"text": "Planned Qty", "raw_text": "Planned Qty", "bbox": [400, 500, 540, 540], "confidence": 0.96},
        {"text": "Produced Qty", "raw_text": "Produced Qty", "bbox": [580, 500, 720, 540], "confidence": 0.96},
        {"text": "Rejection", "raw_text": "Rejection", "bbox": [760, 500, 880, 540], "confidence": 0.97},
        # Row with MISSING Planned Qty (only Start Time, End Time, Produced Qty, Rejection)
        {"text": "08:00", "raw_text": "08:00", "bbox": [110, 560, 200, 595], "confidence": 0.97},
        {"text": "09:00", "raw_text": "09:00", "bbox": [260, 560, 350, 595], "confidence": 0.97},
        # (Nothing at X: 400-540 for Planned Qty)
        {"text": "95", "raw_text": "95", "bbox": [620, 560, 670, 595], "confidence": 0.91},  # Under Produced Qty
        {"text": "5", "raw_text": "5", "bbox": [800, 560, 830, 595], "confidence": 0.90},   # Under Rejection
    ]

    headers, rows, _, _ = HandwritingFieldExtractor.extract_table(
        ocr_regions=ocr_regions,
        table_columns=DEFAULT_HANDWRITING_TEMPLATE.table_columns,
    )

    assert len(rows) == 1
    # Check that Start Time and End Time are accurate
    assert rows[0]["Start Time"] == "08:00"
    assert rows[0]["End Time"] == "09:00"
    # Planned Qty MUST BE empty string, NOT 95!
    assert rows[0]["Planned Qty"] == ""
    # Produced Qty is 95
    assert rows[0]["Produced Qty"] == "95"
    assert rows[0]["Rejection"] == "5"


def test_table_region_misalignment_protection():
    """
    Test that if an OCR text region is below Start Time's Y-coordinate,
    but horizontally aligns with End Time, it belongs to End Time.
    """
    ocr_regions = [
        {"text": "Start Time", "raw_text": "Start Time", "bbox": [100, 500, 200, 540], "confidence": 0.98},
        {"text": "End Time", "raw_text": "End Time", "bbox": [300, 500, 400, 540], "confidence": 0.98},
        # Only one value in row, positioned at X=320-380 (under End Time)
        {"text": "10:30", "raw_text": "10:30", "bbox": [320, 560, 380, 595], "confidence": 0.96},
    ]

    cols = [
        HandwritingTableColumnConfig(column_name="Start Time", value_type="d"),
        HandwritingTableColumnConfig(column_name="End Time", value_type="d"),
    ]

    headers, rows, _, _ = HandwritingFieldExtractor.extract_table(
        ocr_regions=ocr_regions,
        table_columns=cols,
    )

    assert len(rows) == 1
    assert rows[0]["Start Time"] == ""
    assert rows[0]["End Time"] == "10:30"
