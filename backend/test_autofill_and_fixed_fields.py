import sys
import os
import json
import asyncio

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(__file__))

from app.db.repositories import LookupTablesRepo
from app.services.llm_services import GroqService

def test_lookup_merge():
    print("=" * 60)
    print("1. TESTING LOOKUP TABLE MERGE DATA")
    print("=" * 60)

    # 1. Create a dummy lookup table
    dummy_table = {
        "id": "test_merge_lookup_table",
        "name": "Test Merge Table",
        "description": "Table for automated merge test",
        "columns": ["Part No", "Machine Name", "Description"],
        "rows": [
            {"id": "r1", "Part No": "PRT-001", "Machine Name": "Mach-A", "Description": "Desc 1"},
            {"id": "r2", "Part No": "PRT-002", "Machine Name": "Mach-B", "Description": "Desc 2"},
        ]
    }
    LookupTablesRepo.save(dummy_table)
    print("Initial table created with 2 rows and 3 columns.")

    # 2. Test Strategy: "update" (merge incoming data)
    # Incoming data has:
    # - PRT-001 with updated Description and new column "Raw Material"
    # - PRT-003 as brand new part
    incoming_cols = ["Part No", "Description", "Raw Material"]
    incoming_rows = [
        {"Part No": "PRT-001", "Description": "Updated Desc 1", "Raw Material": "Steel"},
        {"Part No": "PRT-003", "Description": "Desc 3", "Raw Material": "Alloy"},
    ]

    res_update = LookupTablesRepo.merge_data(
        table_id="test_merge_lookup_table",
        incoming_columns=incoming_cols,
        incoming_rows=incoming_rows,
        key_column="Part No",
        strategy="update"
    )

    stats = res_update["stats"]
    updated_tbl = res_update["table"]
    print("\nMerge (Strategy: 'update') Stats:", stats)
    assert stats["addedRows"] == 1, f"Expected 1 added row, got {stats['addedRows']}"
    assert stats["updatedRows"] == 1, f"Expected 1 updated row, got {stats['updatedRows']}"
    assert "Raw Material" in stats["newColumns"], "Expected 'Raw Material' in new columns"
    assert stats["totalRows"] == 3, f"Expected 3 total rows, got {stats['totalRows']}"

    # Verify PRT-001 preserved Machine Name and got new Description & Raw Material
    row1 = next(r for r in updated_tbl["rows"] if r["Part No"] == "PRT-001")
    assert row1["Machine Name"] == "Mach-A", "Existing Machine Name should NOT be wiped"
    assert row1["Description"] == "Updated Desc 1", "Description should be updated"
    assert row1["Raw Material"] == "Steel", "Raw Material should be added"
    print("PASS: Strategy 'update' merged successfully without overwriting previous mappings!")

    # 3. Test Strategy: "skip" (incoming duplicates ignored)
    incoming_skip = [
        {"Part No": "PRT-001", "Description": "Should be ignored"},
        {"Part No": "PRT-004", "Description": "Desc 4"},
    ]
    res_skip = LookupTablesRepo.merge_data(
        table_id="test_merge_lookup_table",
        incoming_columns=["Part No", "Description"],
        incoming_rows=incoming_skip,
        key_column="Part No",
        strategy="skip"
    )
    print("\nMerge (Strategy: 'skip') Stats:", res_skip["stats"])
    assert res_skip["stats"]["duplicateRows"] == 1, "Expected 1 duplicate skipped"
    assert res_skip["stats"]["addedRows"] == 1, "Expected 1 added row"
    row1_after_skip = next(r for r in res_skip["table"]["rows"] if r["Part No"] == "PRT-001")
    assert row1_after_skip["Description"] == "Updated Desc 1", "Row 1 should remain unchanged"
    print("PASS: Strategy 'skip' correctly preserved existing row!")

    # Cleanup test table
    LookupTablesRepo.delete("test_merge_lookup_table")
    print("\nCleaned up test table.")


async def test_fixed_value_enforcement():
    print("\n" + "=" * 60)
    print("2. TESTING FIXED VALUE ENFORCEMENT IN LLM STRUCTURING")
    print("=" * 60)

    # Template with 2 fixed fields:
    # 1. Single fixed value: "Machine Name" -> "NEW-150"
    # 2. Allowed fixed values list: "Shift" -> ["A", "B", "C"]
    test_template = {
        "id": "tmpl_test_fixed",
        "name": "Test Fixed Field Template",
        "fields": [
            {
                "id": "f1",
                "name": "Part No",
                "field_name": "Part No",
                "type": "text"
            },
            {
                "id": "f2",
                "name": "Machine Name",
                "field_name": "Machine Name",
                "is_fixed": True,
                "fixed_value": "NEW-150"
            },
            {
                "id": "f3",
                "name": "Shift",
                "field_name": "Shift",
                "is_fixed": True,
                "fixed_values": ["Shift-A", "Shift-B", "Shift-C"]
            }
        ],
        "tables": []
    }

    # Simulate raw OCR text where Machine Name might be OCR misread or absent,
    # and Shift is slightly noisy ("Shift B" or "B")
    mock_ocr = "Part No: PRT-9999\nOperator: John\nShift: B\nMachine: Random Hallucination Mach-99"

    print("Running structure_handwritten_page with mock OCR text...")
    result = await GroqService.structure_handwritten_page(
        page_ocr_text=mock_ocr,
        page_number=1,
        total_pages=1,
        template=test_template,
        mode="template",
        document_name="test_doc.pdf"
    )

    print("Structured LLM Result FieldValues:")
    print(json.dumps(result.get("fieldValues"), indent=2))

    field_vals = result.get("fieldValues", {})
    # Single fixed value must strictly be "NEW-150"
    mach = field_vals.get("Machine Name") or field_vals.get("f2")
    assert mach == "NEW-150", f"Expected 'NEW-150', got '{mach}'"
    print("PASS: Machine Name enforced to exact fixed value 'NEW-150'!")

    # Allowed fixed list must be strictly one of ["Shift-A", "Shift-B", "Shift-C"]
    shift = field_vals.get("Shift") or field_vals.get("f3")
    assert shift in ["Shift-A", "Shift-B", "Shift-C"], f"Expected one of ['Shift-A', 'Shift-B', 'Shift-C'], got '{shift}'"
    print(f"PASS: Shift enforced to allowed fixed value '{shift}' from configured list!")

    print("\nALL AUTOMATED VERIFICATION TESTS PASSED SUCCESSFULLY!")


async def test_strict_lookup_in_call2():
    print("\n" + "=" * 60)
    print("3. TESTING STRICT LOOKUP BASE FIELD IN CALL 2 AND AUTOFILL")
    print("=" * 60)

    # Ensure DEFAULT_PARTS_LOOKUP_TABLE exists in SQLite
    from app.db.defaults import DEFAULT_PARTS_LOOKUP_TABLE
    LookupTablesRepo.save(DEFAULT_PARTS_LOOKUP_TABLE)

    test_strict_template = {
        "id": "tmpl_test_strict_lookup",
        "name": "Test Strict Lookup Template",
        "fields": [
            {"id": "f_part", "name": "Part No", "field_name": "Part No", "type": "text"},
            {"id": "f_machine", "name": "Machine Name", "field_name": "Machine Name", "type": "text"},
            {"id": "f_desc", "name": "Description", "field_name": "Description", "type": "text"},
            {"id": "f_mat", "name": "Raw Material", "field_name": "Raw Material", "type": "text"},
        ],
        "tables": [],
        "lookupConfig": {
            "enabled": True,
            "tableId": "lookup_parts_catalog",
            "mainFieldKey": "Part No",
            "mainTableColumn": "Part No",
            "fieldMappings": [
                {"fieldKey": "Machine Name", "tableColumn": "Machine Name"},
                {"fieldKey": "Description", "tableColumn": "Description"},
                {"fieldKey": "Raw Material", "tableColumn": "Raw Material"},
            ],
            "strictValidation": True,
        }
    }

    # Simulate OCR text where Part No has handwriting noise: "PRT 4029" instead of "PRT-4029"
    mock_ocr = "Part No: PRT 4029\nShift: A\nOperator: Alice"

    print("Running structure_handwritten_page with strict lookup template...")
    result = await GroqService.structure_handwritten_page(
        page_ocr_text=mock_ocr,
        page_number=1,
        total_pages=1,
        template=test_strict_template,
        mode="template",
        document_name="strict_lookup_test.pdf"
    )

    field_vals = result.get("fieldValues", {})
    print("Structured LLM Result FieldValues:")
    print(json.dumps(field_vals, indent=2))

    # Part No should be resolved to canonical "PRT-4029"
    part_no = field_vals.get("Part No")
    assert part_no == "PRT-4029", f"Expected 'PRT-4029', got '{part_no}'"
    print("PASS: Part No successfully normalized to canonical 'PRT-4029' via Call 2!")

    # Mapped fields should be auto-filled from lookup table
    assert field_vals.get("Machine Name") == "Injection Machine 01", f"Expected 'Injection Machine 01', got '{field_vals.get('Machine Name')}'"
    assert field_vals.get("Description") == "Housing Gear Box", f"Expected 'Housing Gear Box', got '{field_vals.get('Description')}'"
    assert field_vals.get("Raw Material") == "ABS Resin Grade A", f"Expected 'ABS Resin Grade A', got '{field_vals.get('Raw Material')}'"
    print("PASS: Dependent fields (Machine Name, Description, Raw Material) auto-filled from lookup catalog!")

    # Test rejection when part is unregistered in strict mode
    mock_ocr_unregistered = "Part No: UNKNOWN-PART-999\nShift: A"
    result_unreg = await GroqService.structure_handwritten_page(
        page_ocr_text=mock_ocr_unregistered,
        page_number=1,
        total_pages=1,
        template=test_strict_template,
        mode="template",
        document_name="strict_unreg_test.pdf"
    )
    unreg_vals = result_unreg.get("fieldValues", {})
    assert unreg_vals.get("Part No") == "", f"Expected unregistered part to be rejected to '', got '{unreg_vals.get('Part No')}'"
    print("PASS: Unregistered part rejected to '' under strict validation!")


if __name__ == "__main__":
    test_lookup_merge()
    asyncio.run(test_fixed_value_enforcement())
    asyncio.run(test_strict_lookup_in_call2())

