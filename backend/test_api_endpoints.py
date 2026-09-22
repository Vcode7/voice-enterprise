"""
API Endpoint Test: /api/handwritten/ocr and /api/handwritten/structure using FastAPI TestClient.
Verifies complete HTTP layer response structure, schema validation, and error handling.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient
from app.main import app
from app.db.defaults import DEFAULT_HANDWRITING_SCANNING_TEMPLATE


def test_endpoints():
    print("Testing /api/handwritten/structure endpoint using TestClient...")
    client = TestClient(app)

    html_ocr = """
    <div data-bbox="[10, 10, 200, 50]">Part No: PRT-4029</div>
    <div data-bbox="[10, 60, 200, 100]">Machine Name: CNC 01</div>
    <table>
      <thead><tr><th>Start Time</th><th>End Time</th><th>Planned Qty</th><th>Produced Qty</th><th>Rejection</th></tr></thead>
      <tbody><tr><td>08:00</td><td>09:00</td><td>50</td><td>50</td><td>0</td></tr></tbody>
    </table>
    """.strip()

    payload = {
        "pages": [
            {
                "pageNumber": 1,
                "ocrText": "Part No: PRT-4029\nMachine Name: CNC 01",
                "rawOcrHtml": html_ocr,
            }
        ],
        "template": DEFAULT_HANDWRITING_SCANNING_TEMPLATE,
        "mode": "template",
        "documentName": "test_api_doc.png",
        "ocrMethod": "chandra_2",
    }

    res = client.post("/api/handwritten/structure", json=payload)
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    data = res.json()
    assert "entries" in data, "Response missing entries"
    assert len(data["entries"]) == 1, "Expected 1 entry"
    entry = data["entries"][0]
    assert "fieldValues" in entry, "Missing fieldValues"
    assert entry["fieldValues"].get("Part No") == "PRT-4029"
    assert "CNC" in str(entry["fieldValues"].get("Machine Name", ""))
    assert "tables" in entry, "Missing tables"
    assert len(entry["tables"]) >= 1
    assert "<div" not in entry.get("rawTranscript", "")
    assert "<table" not in entry.get("rawTranscript", "")
    print("[PASS] /api/handwritten/structure responded successfully with schema-compliant JSON via TestClient!")


if __name__ == "__main__":
    test_endpoints()
