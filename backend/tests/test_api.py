import io
import json
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.main import app

client = TestClient(app)


def create_dummy_image_bytes(text: str = "Part No: PRT-4029") -> bytes:
    """Creates a sample in-memory PNG image."""
    img = Image.new("RGB", (500, 140), color=(255, 255, 255))
    d = ImageDraw.Draw(img)
    d.text((25, 35), text, fill=(0, 0, 0))
    d.text((25, 85), "Shift: Morning  Qty: 150", fill=(0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "service" in data
    assert "version" in data
    assert "pipeline" in data


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "models_loaded" in data
    assert "config" in data
    assert data["config"]["image_preprocessing"] is True


def test_get_and_update_ocr_settings():
    # GET settings
    get_res = client.get("/settings/ocr")
    assert get_res.status_code == 200
    cfg = get_res.json()
    assert "image_preprocessing" in cfg
    assert "table_lookup_correction" in cfg

    # POST update settings (e.g. toggle deskew)
    cfg["enable_deskew"] = False
    post_res = client.post("/settings/ocr", json=cfg)
    assert post_res.status_code == 200
    assert post_res.json()["enable_deskew"] is False

    # Restore default
    cfg["enable_deskew"] = True
    client.post("/settings/ocr", json=cfg)


def test_ocr_unsupported_file_type():
    file_content = b"This is plain text"
    response = client.post(
        "/ocr",
        files={"file": ("test.txt", file_content, "text/plain")},
    )
    assert response.status_code == 415
    assert "Unsupported file format" in response.json()["detail"]


def test_ocr_empty_file():
    response = client.post(
        "/ocr",
        files={"file": ("empty.png", b"", "image/png")},
    )
    assert response.status_code == 422
    assert "empty" in response.json()["detail"].lower()


@pytest.mark.skip(reason="Legacy TrOCR endpoint deprecated; single-engine Chandra V2 architecture in place")
def test_ocr_image_upload_with_lookup_table():
    img_bytes = create_dummy_image_bytes("Part No: PRT-4029")
    lookup_payload = json.dumps({"Part Number": ["PRT-4029", "PRT-1002", "PRT-9900"]})

    response = client.post(
        "/ocr",
        files={"file": ("sample_doc.png", img_bytes, "image/png")},
        data={"lookup_tables_json": lookup_payload},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["total_pages"] == 1
    assert len(data["entries"]) == 1

    entry = data["entries"][0]
    assert entry["page"] == 1
    assert isinstance(entry["text"], str)
    assert isinstance(entry["raw_text"], str)
    assert isinstance(entry["blocks"], list)

    # Check block structure
    for b in entry["blocks"]:
        assert "text" in b
        assert "raw_text" in b
        assert "source" in b
        assert "bbox" in b
        assert "confidence" in b
        assert "confidence_level" in b
        assert b["confidence_level"] in ("HIGH", "MEDIUM", "LOW")
        assert "is_valid" in b


@pytest.mark.skip(reason="Legacy TrOCR endpoint deprecated; single-engine Chandra V2 architecture in place")
def test_ocr_image_upload_with_template_fields():
    img_bytes = create_dummy_image_bytes("Part No: PRT-4029")
    template_fields_payload = json.dumps(["Part No", "Shift", "Quantity"])

    response = client.post(
        "/ocr",
        files={"file": ("sample_doc.png", img_bytes, "image/png")},
        data={"template_fields_json": template_fields_payload},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "extracted_fields" in data
    assert len(data["extracted_fields"]) > 0

    entry = data["entries"][0]
    assert "extracted_fields" in entry
    assert len(entry["extracted_fields"]) == 3

    field_names = [f["field_name"] for f in entry["extracted_fields"]]
    assert "Part No" in field_names
    assert "Shift" in field_names
    assert "Quantity" in field_names

    # Check bounding box coordinates retention
    part_no_field = next(f for f in entry["extracted_fields"] if f["field_name"] == "Part No")
    assert part_no_field["value"] != ""
    assert part_no_field["label_bbox"] is not None
    assert part_no_field["confidence"] > 0.0


def test_handwriting_template_endpoint():
    response = client.get("/ocr/handwriting/template")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Handwriting Scanning Template"
    assert len(data["fields"]) == 16
    assert len(data["table_columns"]) == 5
    field_names = [f["field_name"] for f in data["fields"]]
    assert "Part No" in field_names
    assert "Machine Name" in field_names
    assert "Shift" in field_names


def test_handwriting_document_ocr_endpoint():
    img_bytes = create_dummy_image_bytes("Part No: PRT-4029")
    response = client.post(
        "/ocr/handwriting",
        files={"file": ("handwritten_doc.png", img_bytes, "image/png")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "fields" in data
    assert "table_rows" in data
    assert data["template_name"] == "Handwriting Scanning Template"


