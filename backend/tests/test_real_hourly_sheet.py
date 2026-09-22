import json
from pathlib import Path
import pytest
from app.services.field_extractor import SpatialFieldExtractor


def test_real_hourly_sheet_field_extraction():
    report_json_path = Path("ocr_evaluation_results/page_01/08_final_detailed_report.json")
    if not report_json_path.exists():
        pytest.skip("Evaluation results not found yet")

    with open(report_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    blocks = data["blocks"]
    assert len(blocks) > 0

    # Configured template fields
    template_fields = [
        "Part No",
        "Machine Name",
        "Description",
        "Raw Material",
        "Planned Prodn",
        "Opening Counter",
        "Closing Counter",
        "Date",
        "Shift",
        "Batch No",
    ]

    matches, structured_text = SpatialFieldExtractor.extract_fields(
        ocr_blocks=blocks,
        template_fields=template_fields,
        image_width=2479,
        image_height=3508,
    )

    assert len(matches) == len(template_fields)
    match_dict = {m.field_name: m for m in matches}

    # Verify Part No
    assert "Part No" in match_dict
    assert "99465634" in match_dict["Part No"].value
    assert match_dict["Part No"].label_bbox is not None
    assert match_dict["Part No"].value_bbox is not None

    # Verify Description
    assert "Description" in match_dict
    assert "FR BTM" in match_dict["Description"].value.upper() or "FR" in match_dict["Description"].value.upper()

    # Verify Raw Material
    assert "Raw Material" in match_dict
    assert len(match_dict["Raw Material"].value) > 0

    # Verify Closing Counter
    assert "Closing Counter" in match_dict
    assert "1363" in match_dict["Closing Counter"].value

    # Verify Shift
    assert "Shift" in match_dict
    assert "B" in match_dict["Shift"].value.upper()

    # Verify structured text contains only configured fields
    assert "Part No:" in structured_text
    assert "Description:" in structured_text
    assert "Shift:" in structured_text
    assert "Closing Counter:" in structured_text
    assert "BD-Black Dots" not in structured_text
    assert "Safety Shoe" not in structured_text

    print("\n" + "=" * 60)
    print("STRUCTURED FIELD-SPECIFIC OUTPUT:")
    print("=" * 60)
    print(structured_text)
    print("=" * 60)
