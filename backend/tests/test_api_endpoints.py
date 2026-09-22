"""
Comprehensive automated tests for migrated FastAPI API endpoints and SQLite database.
"""

import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health():
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json().get("status") == "healthy"


def test_transactions_crud():
    # 1. List
    res = client.get("/api/transactions")
    assert res.status_code == 200
    assert isinstance(res.json(), list)

    # 2. Create
    new_tx = {
        "amount": 1500,
        "category": "Shopping",
        "description": "Test Shopping Expense",
        "transactionType": "expense",
    }
    create_res = client.post("/api/transactions", json=new_tx)
    assert create_res.status_code == 201
    created_data = create_res.json()
    tx_id = created_data["id"]
    assert created_data["amount"] == 1500

    # 3. Get by ID
    get_res = client.get(f"/api/transactions/{tx_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == tx_id

    # 4. Update
    put_res = client.put(f"/api/transactions/{tx_id}", json={"amount": 1800, "category": "Shopping"})
    assert put_res.status_code == 200
    assert put_res.json()["amount"] == 1800

    # 5. Delete
    del_res = client.delete(f"/api/transactions/{tx_id}")
    assert del_res.status_code == 200
    assert del_res.json().get("success") is True


def test_receipts_crud():
    # Next number
    num_res = client.get("/api/receipts/next-number")
    assert num_res.status_code == 200
    assert "receiptNumber" in num_res.json()

    # Create
    new_rcpt = {
        "customerName": "Test Customer",
        "grandTotal": 2500,
        "items": [{"description": "Item A", "amount": 2500}],
    }
    create_res = client.post("/api/receipts", json=new_rcpt)
    assert create_res.status_code == 201
    rcpt_id = create_res.json()["id"]

    # Get
    get_res = client.get(f"/api/receipts/{rcpt_id}")
    assert get_res.status_code == 200

    # Delete
    del_res = client.delete(f"/api/receipts/{rcpt_id}")
    assert del_res.status_code == 200


def test_budgets_crud():
    # Set budget
    res = client.post("/api/budgets", json={"category": "TestCategory", "amount": 3500})
    assert res.status_code == 201
    b_id = res.json()["id"]

    # List
    list_res = client.get("/api/budgets")
    assert list_res.status_code == 200
    assert any(b["category"] == "TestCategory" for b in list_res.json())

    # Delete
    del_res = client.delete(f"/api/budgets/{b_id}")
    assert del_res.status_code == 200


def test_debts_crud():
    # Record debt
    res = client.post("/api/debts", json={"personName": "Test Person", "amount": 500, "type": "given"})
    assert res.status_code == 201
    d_id = res.json()["id"]

    # Toggle settled
    toggle_res = client.patch(f"/api/debts/{d_id}/toggle")
    assert toggle_res.status_code == 200
    assert toggle_res.json()["settled"] is True

    # Repayment
    repay_res = client.post("/api/debts", json={"action": "repayment", "personName": "Test Person", "amount": 200})
    assert repay_res.status_code == 200

    # Delete
    del_res = client.delete(f"/api/debts/{d_id}")
    assert del_res.status_code == 200


def test_templates_and_lookup_tables():
    # Templates
    tmpls_res = client.get("/api/templates")
    assert tmpls_res.status_code == 200
    assert len(tmpls_res.json()) >= 2

    # Lookup Tables
    lk_res = client.get("/api/lookup-tables")
    assert lk_res.status_code == 200
    assert len(lk_res.json()) >= 1


def test_settings_crud():
    res = client.get("/api/settings")
    assert res.status_code == 200
    current = res.json()
    assert "currency" in current

    # Update
    put_res = client.put("/api/settings", json={"businessName": "Updated Test Business"})
    assert put_res.status_code == 200
    assert put_res.json()["businessName"] == "Updated Test Business"


def test_data_entries_crud():
    list_res = client.get("/api/data-entries")
    assert list_res.status_code == 200
    entries = list_res.json()
    assert isinstance(entries, list)

    # Create new data entry
    new_entry = {
        "templateId": "test_tmpl",
        "templateName": "Test Entry",
        "fieldValues": {"part_no": "PRT-999"},
    }
    create_res = client.post("/api/data-entries", json=new_entry)
    assert create_res.status_code == 201
    e_id = create_res.json()["id"]

    # Get
    get_res = client.get(f"/api/data-entries/{e_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == e_id

    # Delete
    del_res = client.delete(f"/api/data-entries/{e_id}")
    assert del_res.status_code == 200


def test_status_endpoints():
    groq_res = client.get("/api/groq/status")
    assert groq_res.status_code == 200
    assert "isConfigured" in groq_res.json()

    gemini_res = client.get("/api/gemini/status")
    assert gemini_res.status_code == 200
    assert "isConfigured" in gemini_res.json()

    hw_tmpl_res = client.get("/api/handwritten/template")
    assert hw_tmpl_res.status_code == 200

    hw_models_res = client.get("/api/handwritten/models")
    assert hw_models_res.status_code == 200


def test_export():
    res = client.get("/api/export?format=json")
    assert res.status_code == 200
    data = res.json()
    assert "version" in data
    assert "dataEntries" in data
    assert "templates" in data


def test_database_stats():
    res1 = client.get("/api/stats")
    assert res1.status_code == 200
    d1 = res1.json()
    assert d1["storageEngine"] == "SQLite"
    assert "counts" in d1

    res2 = client.get("/api/database/stats")
    assert res2.status_code == 200
    d2 = res2.json()
    assert d2["storageEngine"] == "SQLite"
    assert d2["counts"]["templates"] >= 1
