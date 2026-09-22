import pytest
from app.services.field_extractor import SpatialFieldExtractor
from app.models.schemas import ExtractedFieldMatch


def test_inline_label_and_value_extraction():
    """Test extracting field when label and value are inside the same OCR text block."""
    ocr_blocks = [
        {"text": "Part No: 34125", "raw_text": "Part No: 34125", "bbox": [100, 100, 350, 140], "confidence": 0.98, "source": "paddleocr"},
        {"text": "Machine Name: CNC Machine", "raw_text": "Machine Name: CNC Machine", "bbox": [100, 150, 420, 190], "confidence": 0.97, "source": "paddleocr"},
        {"text": "Quantity: 10", "raw_text": "Quantity: 10", "bbox": [100, 200, 280, 240], "confidence": 0.99, "source": "paddleocr"},
        {"text": "RANDOM UNRELATED HEADER TEXT", "raw_text": "RANDOM UNRELATED HEADER TEXT", "bbox": [50, 20, 800, 60], "confidence": 0.95, "source": "paddleocr"},
    ]

    template_fields = ["Part No", "Machine Name", "Quantity"]

    matches, structured_text = SpatialFieldExtractor.extract_fields(
        ocr_blocks=ocr_blocks,
        template_fields=template_fields,
    )

    assert len(matches) == 3
    assert matches[0].field_name == "Part No"
    assert matches[0].value == "34125"
    assert matches[0].match_direction == "inline"
    assert matches[0].label_bbox == [100, 100, 350, 140]

    assert matches[1].field_name == "Machine Name"
    assert matches[1].value == "CNC Machine"
    assert matches[1].match_direction == "inline"

    assert matches[2].field_name == "Quantity"
    assert matches[2].value == "10"
    assert matches[2].match_direction == "inline"

    expected_text = "Part No: 34125\nMachine Name: CNC Machine\nQuantity: 10"
    assert structured_text == expected_text
    assert "RANDOM UNRELATED HEADER" not in structured_text


def test_right_of_label_spatial_matching():
    """Test searching horizontally AFTER/RIGHT of label for value in separate block."""
    ocr_blocks = [
        {"text": "Part No.", "raw_text": "Part No.", "bbox": [200, 214, 337, 264], "confidence": 0.95, "source": "paddleocr"},
        {"text": "99465634", "raw_text": "99465634", "bbox": [482, 216, 851, 289], "confidence": 0.92, "source": "trocr"},
        {"text": "Date", "raw_text": "Date", "bbox": [212, 436, 292, 473], "confidence": 0.99, "source": "paddleocr"},
        {"text": "13/8/96", "raw_text": "13/8/96", "bbox": [575, 428, 836, 485], "confidence": 0.88, "source": "trocr"},
        {"text": "FOOTER DISCLAIMER NOT CONFIGURED", "raw_text": "FOOTER DISCLAIMER", "bbox": [100, 900, 700, 950], "confidence": 0.90, "source": "paddleocr"},
    ]

    template_fields = ["Part No", "Date"]

    matches, structured_text = SpatialFieldExtractor.extract_fields(
        ocr_blocks=ocr_blocks,
        template_fields=template_fields,
    )

    assert len(matches) == 2
    assert matches[0].field_name == "Part No"
    assert matches[0].value == "99465634"
    assert matches[0].match_direction == "right"
    assert matches[0].label_bbox == [200, 214, 337, 264]
    assert matches[0].value_bbox == [482, 216, 851, 289]
    assert matches[0].spatial_distance is not None

    assert matches[1].field_name == "Date"
    assert matches[1].value == "13/8/96"
    assert matches[1].match_direction == "right"

    assert structured_text == "Part No: 99465634\nDate: 13/8/96"
    assert "FOOTER DISCLAIMER" not in structured_text


def test_below_label_spatial_matching():
    """Test searching vertically BELOW label for value in separate block."""
    ocr_blocks = [
        {"text": "Machine Name:", "raw_text": "Machine Name:", "bbox": [1167, 234, 1380, 268], "confidence": 0.98, "source": "paddleocr"},
        {"text": "CNC Milling 03", "raw_text": "CNC Milling 03", "bbox": [1183, 280, 1460, 340], "confidence": 0.89, "source": "trocr"},
        {"text": "Shift:", "raw_text": "Shift:", "bbox": [209, 487, 287, 537], "confidence": 0.98, "source": "paddleocr"},
        {"text": "B", "raw_text": "B", "bbox": [320, 487, 380, 537], "confidence": 0.93, "source": "trocr"},
    ]

    template_fields = ["Machine Name", "Shift"]

    matches, structured_text = SpatialFieldExtractor.extract_fields(
        ocr_blocks=ocr_blocks,
        template_fields=template_fields,
    )

    assert len(matches) == 2
    assert matches[0].field_name == "Machine Name"
    assert matches[0].value == "CNC Milling 03"
    assert matches[0].match_direction == "below"
    assert matches[0].label_bbox == [1167, 234, 1380, 268]
    assert matches[0].value_bbox == [1183, 280, 1460, 340]

    assert matches[1].field_name == "Shift"
    assert matches[1].value == "B"
    assert matches[1].match_direction == "right"

    assert structured_text == "Machine Name: CNC Milling 03\nShift: B"


def test_multi_token_consecutive_gathering():
    """Test gathering multiple contiguous tokens for a value on the same line."""
    ocr_blocks = [
        {"text": "Description", "raw_text": "Description", "bbox": [204, 270, 398, 318], "confidence": 0.96, "source": "paddleocr"},
        {"text": "FR", "raw_text": "FR", "bbox": [480, 272, 560, 330], "confidence": 0.85, "source": "trocr"},
        {"text": "BTM", "raw_text": "BTM", "bbox": [580, 272, 700, 330], "confidence": 0.90, "source": "trocr"},
    ]

    template_fields = ["Description"]

    matches, structured_text = SpatialFieldExtractor.extract_fields(
        ocr_blocks=ocr_blocks,
        template_fields=template_fields,
    )

    assert len(matches) == 1
    assert matches[0].field_name == "Description"
    assert matches[0].value == "FR BTM"
    assert matches[0].value_bbox == [480, 272, 700, 330]
    assert structured_text == "Description: FR BTM"


def test_only_configured_fields_extracted():
    """Test that unrelated fields or unselected fields are never returned."""
    ocr_blocks = [
        {"text": "Part No: PRT-4029", "raw_text": "Part No: PRT-4029", "bbox": [100, 100, 350, 140], "confidence": 0.98, "source": "paddleocr"},
        {"text": "Machine Name: Injection 01", "raw_text": "Machine Name: Injection 01", "bbox": [100, 150, 420, 190], "confidence": 0.97, "source": "paddleocr"},
        {"text": "Operator: John Doe", "raw_text": "Operator: John Doe", "bbox": [100, 200, 350, 240], "confidence": 0.95, "source": "paddleocr"},
        {"text": "Batch No: B-992", "raw_text": "Batch No: B-992", "bbox": [100, 250, 350, 290], "confidence": 0.96, "source": "paddleocr"},
        {"text": "Notes: Smooth run", "raw_text": "Notes: Smooth run", "bbox": [100, 300, 350, 340], "confidence": 0.90, "source": "paddleocr"},
    ]

    # Only request 2 fields
    template_fields = ["Part No", "Machine Name"]

    matches, structured_text = SpatialFieldExtractor.extract_fields(
        ocr_blocks=ocr_blocks,
        template_fields=template_fields,
    )

    assert len(matches) == 2
    field_names = [m.field_name for m in matches]
    assert field_names == ["Part No", "Machine Name"]
    assert "Operator" not in structured_text
    assert "Batch No" not in structured_text
    assert "Notes" not in structured_text
    assert structured_text == "Part No: PRT-4029\nMachine Name: Injection 01"
