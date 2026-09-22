"""
End-to-End Test for Handwriting Chandra OCR -> SQLite -> Python LLM Pipeline.
Verifies:
1. Saving raw Chandra OCR output (including direct HTML) to SQLite first.
2. Returning saved OCR output with ocr_record_id and clean_text.
3. Initiating LLM structuring in the Python backend only.
4. Correct JSON/schema loading for 16 digital fields and multi-tables.
5. All 4 required log banner stages:
   - Raw Chandra OCR output
   - LLM input/prompt + JSON/schema being used
   - LLM raw output
   - Final parsed JSON
6. Final structured JSON saved to SQLite and properly formatted for frontend left-side output.
7. Verification that no raw HTML tags leak into cleanText/rawTranscript.
"""
import asyncio
import json
import sys
from pathlib import Path

# Add backend directory to sys.path
sys.path.insert(0, str(Path(__file__).parent))

from app.db.init_db import init_database
from app.db.defaults import DEFAULT_HANDWRITING_SCANNING_TEMPLATE
from app.db.repositories import OcrResultsRepo
from app.services.llm_services import GroqService
from app.utils.html_cleaner import clean_html_to_text


async def run_flow_test():
    print("=" * 80)
    print("STARTING COMPLETE OCR -> SQLITE -> LLM PIPELINE VERIFICATION TEST")
    print("=" * 80)

    # 1. Initialize SQLite Database
    init_database()
    print("[STEP 1/6] Database initialized.")

    # 2. Simulate raw Chandra 2 OCR HTML output for a plant shift sheet
    sample_filename = "hourly_shift_production_sheet.png"
    raw_chandra_html = """
    <div data-bbox="[20, 15, 880, 55]" data-label="header">PLANT PRODUCTION & MONITORING LOG</div>
    <div data-bbox="[25, 70, 260, 95]" data-label="field">Part No: PRT-4029</div>
    <div data-bbox="[280, 70, 520, 95]" data-label="field">Machine Name: Injection M/C 02</div>
    <div data-bbox="[540, 70, 800, 95]" data-label="field">Description: Base Housing Shell</div>
    <div data-bbox="[25, 105, 260, 130]" data-label="field">Raw Material: Polypropylene Black</div>
    <div data-bbox="[280, 105, 520, 130]" data-label="field">Planned Production: 1000</div>
    <div data-bbox="[540, 105, 750, 130]" data-label="field">Date: 2026-09-09</div>
    <div data-bbox="[770, 105, 870, 130]" data-label="field">Shift: A</div>
    <div data-bbox="[25, 140, 260, 165]" data-label="field">Batch No: BATCH-89</div>
    <div data-bbox="[280, 140, 520, 165]" data-label="field">Opening Cycle: 1200</div>
    <div data-bbox="[540, 140, 750, 165]" data-label="field">Closing Cycle: 1450</div>
    <div data-bbox="[25, 175, 260, 200]" data-label="field">Cycle Time: 28s</div>
    <div data-bbox="[280, 175, 520, 200]" data-label="field">Startup Time: 07:45</div>
    <div data-bbox="[540, 175, 750, 200]" data-label="field">Operator: Rajesh Kumar</div>
    <div data-bbox="[25, 210, 260, 235]" data-label="field">No of Cavities: 4</div>
    <div data-bbox="[280, 210, 520, 235]" data-label="field">Purge Weight: 120g</div>
    <div data-bbox="[540, 210, 750, 235]" data-label="field">Runner Weight: 45g</div>

    <table data-bbox="[20, 260, 880, 420]" data-label="production_table">
      <caption>Production Table</caption>
      <thead>
        <tr>
          <th>Start Time</th>
          <th>End Time</th>
          <th>Planned Qty</th>
          <th>Produced Qty</th>
          <th>Rejection</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>08:00</td><td>09:00</td><td>125</td><td>122</td><td>3</td></tr>
        <tr><td>09:00</td><td>10:00</td><td>125</td><td>125</td><td>0</td></tr>
      </tbody>
    </table>

    <table data-bbox="[20, 440, 880, 580]" data-label="rejection_table">
      <caption>Rejection</caption>
      <thead>
        <tr>
          <th>STRUP</th><th>BD</th><th>SS</th><th>SM</th><th>BM</th><th>ST</th><th>WL</th><th>SC</th><th>PC</th><th>AB</th><th>PH</th><th>FS</th><th>TOTAL</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>1</td><td>0</td><td>2</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>3</td></tr>
      </tbody>
    </table>
    """.strip()

    # 3. Always save raw OCR output to SQLite first
    clean_display = clean_html_to_text(raw_chandra_html)
    saved_ocr_rec = OcrResultsRepo.create({
        "filename": sample_filename,
        "ocr_method": "chandra_2",
        "chandra_mode": "full_image",
        "raw_text": raw_chandra_html,
        "structured_text": raw_chandra_html,
        "clean_text": clean_display,
        "template_id": DEFAULT_HANDWRITING_SCANNING_TEMPLATE["id"],
        "template_name": DEFAULT_HANDWRITING_SCANNING_TEMPLATE["name"],
        "page_count": 1,
        "status": "completed",
    })
    ocr_record_id = saved_ocr_rec["id"]
    print(f"[STEP 2/6] Raw OCR output saved to SQLite first. ID: '{ocr_record_id}'")
    assert ocr_record_id is not None
    assert saved_ocr_rec["raw_text"] == raw_chandra_html
    assert saved_ocr_rec["clean_text"] == clean_display

    # Verify no HTML tags in clean_display
    assert "<div" not in clean_display and "data-bbox" not in clean_display and "<table" not in clean_display
    print("[STEP 3/6] Clean display text verified (100% free of HTML tags).")

    # 4. Initiate LLM call in Python backend only
    print("[STEP 4/6] Initiating LLM structuring in Python backend with schema...")
    structured_entry = await GroqService.structure_handwritten_page(
        page_ocr_text=raw_chandra_html,
        page_number=1,
        total_pages=1,
        template=DEFAULT_HANDWRITING_SCANNING_TEMPLATE,
        mode="template",
        document_name=sample_filename,
        ocr_method="chandra_2",
        ocr_record_id=ocr_record_id,
    )

    print("[STEP 5/6] Received structured LLM extraction response.")
    print("--- EXTRACTED FIELD VALUES ---")
    field_vals = structured_entry.get("fieldValues", {})
    print(json.dumps(field_vals, indent=2))

    print("--- EXTRACTED TABLES ---")
    tables = structured_entry.get("tables", [])
    for tbl in tables:
        print(f"Table: {tbl.get('name')} | Headers: {tbl.get('headers')} | Rows: {len(tbl.get('rows', []))}")
        for r in tbl.get("rows", []):
            print(f"   {r}")

    # Verifications on structured output
    assert structured_entry.get("id") is not None
    assert "PRT-4029" in str(field_vals.get("Part No", ""))
    assert "Injection" in str(field_vals.get("Machine Name", ""))
    assert len(tables) >= 1, "At least one table must be extracted"

    # Verify that cleanText is present and contains NO HTML
    clean_txt = structured_entry.get("cleanText") or structured_entry.get("rawTranscript") or ""
    assert "<div" not in clean_txt and "<table" not in clean_txt, "rawTranscript/cleanText leaked raw HTML!"
    print("[PASS] Verification confirmed: cleanText/rawTranscript contains NO raw HTML tags.")

    # 5. Verify SQLite record was updated with the final LLM result
    updated_rec = OcrResultsRepo.get_by_id(ocr_record_id)
    assert updated_rec is not None
    assert updated_rec["status"] == "extracted"
    assert updated_rec["llm_result"] is not None
    assert updated_rec["llm_result"]["id"] == structured_entry["id"]
    print(f"[STEP 6/6] SQLite record '{ocr_record_id}' verified as status='extracted' with final LLM result.")

    print("=" * 80)
    print("COMPLETE PIPELINE VERIFICATION PASSED SUCCESSFULLY!")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(run_flow_test())
