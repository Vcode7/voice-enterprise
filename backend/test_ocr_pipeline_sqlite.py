"""
Unit & Integration Test: SQLite Persistence for Chandra OCR & LLM Pipeline
Tests:
1. Table creation for `ocr_results`
2. Storing raw Chandra OCR output (HTML)
3. Updating record with final parsed LLM result
4. Fetching by ID and fetching recent records
"""
import os
import sys
import json
from pathlib import Path

# Add parent directory to sys.path
sys.path.insert(0, str(Path(__file__).parent))

from app.db.init_db import init_database
from app.db.repositories import OcrResultsRepo


def test_sqlite_persistence():
    print("=" * 60)
    print("RUNNING TEST: SQLite Persistence for Chandra OCR")
    print("=" * 60)

    # 1. Initialize DB to ensure table exists
    init_database()
    print("[PASS] Database initialized successfully.")

    # 2. Test saving raw HTML Chandra OCR output
    raw_chandra_html = """
    <div data-bbox="[25, 20, 500, 60]" data-label="header">PLANT SHIFT PRODUCTION LOG</div>
    <div data-bbox="[25, 70, 250, 95]" data-label="field">Part No: PRT-4029</div>
    <div data-bbox="[25, 100, 250, 125]" data-label="field">Machine Name: Injection Machine 01</div>
    <table data-bbox="[25, 150, 800, 300]">
      <thead>
        <tr><th>Start Time</th><th>End Time</th><th>Planned Qty</th><th>Produced Qty</th><th>Rejection</th></tr>
      </thead>
      <tbody>
        <tr><td>08:00</td><td>09:00</td><td>100</td><td>98</td><td>2</td></tr>
        <tr><td>09:00</td><td>10:00</td><td>100</td><td>100</td><td>0</td></tr>
      </tbody>
    </table>
    """.strip()

    clean_text = "PLANT SHIFT PRODUCTION LOG\nPart No: PRT-4029\nMachine Name: Injection Machine 01\nStart Time | End Time | Planned Qty | Produced Qty | Rejection\n08:00 | 09:00 | 100 | 98 | 2\n09:00 | 10:00 | 100 | 100 | 0"

    test_record = {
        "filename": "shift_log_test.png",
        "ocr_method": "chandra_2",
        "chandra_mode": "full_image",
        "raw_text": raw_chandra_html,
        "structured_text": raw_chandra_html,
        "clean_text": clean_text,
        "template_id": "handwriting_scanning_default",
        "template_name": "Handwriting Scanning Template",
        "page_count": 1,
        "status": "completed",
        "data": {"sample_meta": "verification"},
    }

    created = OcrResultsRepo.create(test_record)
    assert created is not None, "Failed to create OCR record"
    record_id = created["id"]
    print(f"[PASS] Created OCR record in SQLite: id='{record_id}'")
    assert created["raw_text"] == raw_chandra_html, "Raw HTML was not stored accurately"
    assert created["clean_text"] == clean_text, "Clean text was not stored accurately"

    # 3. Test retrieving record by ID
    fetched = OcrResultsRepo.get_by_id(record_id)
    assert fetched is not None, f"Could not find record '{record_id}'"
    assert fetched["id"] == record_id
    assert fetched["filename"] == "shift_log_test.png"
    assert fetched["status"] == "completed"
    assert fetched["data"] == {"sample_meta": "verification"}
    print(f"[PASS] Retrieved record by ID '{record_id}' with complete raw HTML.")

    # 4. Test updating with LLM result
    mock_llm_result = {
        "id": f"entry_hw_{record_id}",
        "title": "Shift Log (Page 1)",
        "fieldValues": {
            "Part No": "PRT-4029",
            "Machine Name": "Injection Machine 01",
        },
        "tables": [
            {
                "name": "Production Table",
                "headers": ["Start Time", "End Time", "Planned Qty", "Produced Qty", "Rejection"],
                "rows": [
                    {"Start Time": "08:00", "End Time": "09:00", "Planned Qty": "100", "Produced Qty": "98", "Rejection": "2"},
                ],
            }
        ],
        "confidenceScore": 96,
    }

    updated = OcrResultsRepo.update_llm_result(record_id, mock_llm_result)
    assert updated is not None, "Failed to update LLM result"
    assert updated["status"] == "extracted", "Status was not updated to 'extracted'"
    assert updated["llm_result"] == mock_llm_result, "LLM result was not stored accurately"
    print(f"[PASS] Updated record with LLM result: status='{updated['status']}'")

    # 5. Test get_recent
    recent = OcrResultsRepo.get_recent(limit=5)
    assert len(recent) > 0, "No records returned from get_recent"
    assert any(r["id"] == record_id for r in recent), f"Record '{record_id}' missing in recent list"
    print(f"[PASS] Verified get_recent() contains record '{record_id}'.")

    print("=" * 60)
    print("ALL SQLITE PERSISTENCE TESTS PASSED!")
    print("=" * 60)


if __name__ == "__main__":
    test_sqlite_persistence()
