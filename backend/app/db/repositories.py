import os
import json
import random
import string
import time
from datetime import datetime
from typing import List, Optional, Dict, Any

from app.db.connection import get_db_connection
from app.db.defaults import (
    DEFAULT_SETTINGS,
    DEFAULT_PARTS_LOOKUP_TABLE,
    NEW_DEFAULT_TEMPLATE,
    INDEPTH_TEMPLATE,
    DEFAULT_HANDWRITING_SCANNING_TEMPLATE,
)
from app.core.logger import logger


def _gen_id(prefix: str) -> str:
    rand_suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
    return f"{prefix}_{int(time.time() * 1000)}_{rand_suffix}"


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


# ----------------------------------------------------
# 1. Transactions Repository
# ----------------------------------------------------
class TransactionsRepo:
    @staticmethod
    def get_all() -> List[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM transactions ORDER BY date DESC, created_at DESC;")
            rows = cursor.fetchall()
            return [json.loads(r["data"]) for r in rows]
        finally:
            conn.close()

    @staticmethod
    def get_by_id(tx_id: str) -> Optional[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM transactions WHERE id = ?;", (tx_id,))
            row = cursor.fetchone()
            return json.loads(row["data"]) if row else None
        finally:
            conn.close()

    @staticmethod
    def create(data: Dict[str, Any]) -> Dict[str, Any]:
        conn = get_db_connection()
        try:
            tx_id = data.get("id") or _gen_id("tx")
            now = _now_iso()
            created_at = data.get("createdAt") or data.get("created_at") or now
            date = data.get("date") or now.split("T")[0]

            item: Dict[str, Any] = {
                "id": tx_id,
                "amount": float(data.get("amount", 0)),
                "currency": data.get("currency") or "INR",
                "merchant": data.get("merchant") or None,
                "category": data.get("category") or "Other",
                "paymentMethod": data.get("paymentMethod") or data.get("payment_method") or None,
                "transactionType": data.get("transactionType") or data.get("transaction_type") or "expense",
                "description": data.get("description") or None,
                "transcript": data.get("transcript") or None,
                "date": date,
                "createdAt": created_at,
            }

            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO transactions (id, amount, currency, merchant, category, payment_method, transaction_type, description, transcript, date, created_at, data)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    amount = excluded.amount,
                    currency = excluded.currency,
                    merchant = excluded.merchant,
                    category = excluded.category,
                    payment_method = excluded.payment_method,
                    transaction_type = excluded.transaction_type,
                    description = excluded.description,
                    transcript = excluded.transcript,
                    date = excluded.date,
                    data = excluded.data;
                """,
                (
                    item["id"],
                    item["amount"],
                    item["currency"],
                    item["merchant"],
                    item["category"],
                    item["paymentMethod"],
                    item["transactionType"],
                    item["description"],
                    item["transcript"],
                    item["date"],
                    item["createdAt"],
                    json.dumps(item),
                ),
            )
            return item
        finally:
            conn.close()

    @staticmethod
    def create_many(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        created = []
        for item in items:
            created.append(TransactionsRepo.create(item))
        return created

    @staticmethod
    def update(tx_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        existing = TransactionsRepo.get_by_id(tx_id)
        if not existing:
            return None
        existing.update(updates)
        return TransactionsRepo.create(existing)

    @staticmethod
    def delete(tx_id: str) -> bool:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM transactions WHERE id = ?;", (tx_id,))
            return cursor.rowcount > 0
        finally:
            conn.close()

    @staticmethod
    def clear() -> None:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM transactions;")
        finally:
            conn.close()


# ----------------------------------------------------
# 2. Receipts Repository
# ----------------------------------------------------
class ReceiptsRepo:
    @staticmethod
    def get_all() -> List[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM receipts ORDER BY date DESC, created_at DESC;")
            rows = cursor.fetchall()
            return [json.loads(r["data"]) for r in rows]
        finally:
            conn.close()

    @staticmethod
    def get_by_id(rcpt_id: str) -> Optional[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM receipts WHERE id = ?;", (rcpt_id,))
            row = cursor.fetchone()
            return json.loads(row["data"]) if row else None
        finally:
            conn.close()

    @staticmethod
    def get_next_receipt_number() -> str:
        conn = get_db_connection()
        try:
            settings_data = SettingsRepo.get()
            prefix = settings_data.get("receiptPrefix") or "INV-"
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM receipts;")
            count = cursor.fetchone()[0]
            return f"{prefix}{1001 + count}"
        finally:
            conn.close()

    @staticmethod
    def create(data: Dict[str, Any]) -> Dict[str, Any]:
        conn = get_db_connection()
        try:
            rcpt_id = data.get("id") or _gen_id("rcpt")
            now = _now_iso()
            created_at = data.get("createdAt") or data.get("created_at") or now
            date = data.get("date") or now.split("T")[0]
            receipt_number = data.get("receiptNumber") or data.get("receipt_number") or ReceiptsRepo.get_next_receipt_number()

            item: Dict[str, Any] = {
                "id": rcpt_id,
                "receiptNumber": receipt_number,
                "date": date,
                "customerName": data.get("customerName") or data.get("customer_name") or None,
                "customerPhone": data.get("customerPhone") or data.get("customer_phone") or None,
                "items": data.get("items") or [],
                "subtotal": float(data.get("subtotal", 0)),
                "discount": float(data.get("discount", 0)),
                "tax": float(data.get("tax", 0)),
                "taxPercent": float(data.get("taxPercent", 0) or data.get("tax_percent", 0)),
                "taxType": data.get("taxType") or data.get("tax_type") or "none",
                "cgst": float(data.get("cgst", 0)),
                "sgst": float(data.get("sgst", 0)),
                "igst": float(data.get("igst", 0)),
                "grandTotal": float(data.get("grandTotal", 0) or data.get("grand_total", 0)),
                "currency": data.get("currency") or "INR",
                "transcript": data.get("transcript") or None,
                "createdAt": created_at,
            }

            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO receipts (
                    id, receipt_number, date, customer_name, customer_phone,
                    subtotal, discount, tax, tax_percent, tax_type,
                    cgst, sgst, igst, grand_total, currency, transcript, created_at, data
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    receipt_number = excluded.receipt_number,
                    date = excluded.date,
                    customer_name = excluded.customer_name,
                    customer_phone = excluded.customer_phone,
                    subtotal = excluded.subtotal,
                    discount = excluded.discount,
                    tax = excluded.tax,
                    tax_percent = excluded.tax_percent,
                    tax_type = excluded.tax_type,
                    cgst = excluded.cgst,
                    sgst = excluded.sgst,
                    igst = excluded.igst,
                    grand_total = excluded.grand_total,
                    currency = excluded.currency,
                    transcript = excluded.transcript,
                    data = excluded.data;
                """,
                (
                    item["id"],
                    item["receiptNumber"],
                    item["date"],
                    item["customerName"],
                    item["customerPhone"],
                    item["subtotal"],
                    item["discount"],
                    item["tax"],
                    item["taxPercent"],
                    item["taxType"],
                    item["cgst"],
                    item["sgst"],
                    item["igst"],
                    item["grandTotal"],
                    item["currency"],
                    item["transcript"],
                    item["createdAt"],
                    json.dumps(item),
                ),
            )
            return item
        finally:
            conn.close()

    @staticmethod
    def create_many(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        created = []
        for item in items:
            created.append(ReceiptsRepo.create(item))
        return created

    @staticmethod
    def update(rcpt_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        existing = ReceiptsRepo.get_by_id(rcpt_id)
        if not existing:
            return None
        existing.update(updates)
        return ReceiptsRepo.create(existing)

    @staticmethod
    def delete(rcpt_id: str) -> bool:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM receipts WHERE id = ?;", (rcpt_id,))
            return cursor.rowcount > 0
        finally:
            conn.close()

    @staticmethod
    def clear() -> None:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM receipts;")
        finally:
            conn.close()


# ----------------------------------------------------
# 3. Budgets Repository
# ----------------------------------------------------
class BudgetsRepo:
    @staticmethod
    def get_all() -> List[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM budgets ORDER BY category ASC;")
            rows = cursor.fetchall()
            return [json.loads(r["data"]) for r in rows]
        finally:
            conn.close()

    @staticmethod
    def set_budget(category: str, amount: float, period: str = "monthly") -> Dict[str, Any]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM budgets WHERE category = ? COLLATE NOCASE;", (category,))
            row = cursor.fetchone()
            existing = json.loads(row["data"]) if row else None

            b_id = existing["id"] if existing else _gen_id("budget")
            created_at = existing["createdAt"] if existing else _now_iso()

            item = {
                "id": b_id,
                "category": category,
                "amount": float(amount),
                "period": period,
                "createdAt": created_at,
            }

            cursor.execute(
                """
                INSERT INTO budgets (id, category, amount, period, created_at, data)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(category) DO UPDATE SET
                    amount = excluded.amount,
                    period = excluded.period,
                    data = excluded.data;
                """,
                (item["id"], item["category"], item["amount"], item["period"], item["createdAt"], json.dumps(item)),
            )
            return item
        finally:
            conn.close()

    @staticmethod
    def delete(b_id: str) -> bool:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM budgets WHERE id = ?;", (b_id,))
            return cursor.rowcount > 0
        finally:
            conn.close()

    @staticmethod
    def clear() -> None:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM budgets;")
        finally:
            conn.close()


# ----------------------------------------------------
# 4. Debts Repository
# ----------------------------------------------------
class DebtsRepo:
    @staticmethod
    def get_all() -> List[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM debts ORDER BY updated_at DESC;")
            rows = cursor.fetchall()
            return [json.loads(r["data"]) for r in rows]
        finally:
            conn.close()

    @staticmethod
    def record_debt(
        person_name: str,
        amount: float,
        debt_type: str,
        notes: Optional[str] = None,
        date: Optional[str] = None,
    ) -> Dict[str, Any]:
        conn = get_db_connection()
        try:
            now = _now_iso()
            debt_id = _gen_id("debt")
            item = {
                "id": debt_id,
                "personName": person_name,
                "amount": float(amount),
                "type": debt_type,
                "settled": False,
                "notes": notes or None,
                "date": date or now.split("T")[0],
                "updatedAt": now,
            }

            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO debts (id, person_name, amount, type, settled, notes, date, updated_at, data)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    item["id"],
                    item["personName"],
                    item["amount"],
                    item["type"],
                    0,
                    item["notes"],
                    item["date"],
                    item["updatedAt"],
                    json.dumps(item),
                ),
            )
            return item
        finally:
            conn.close()

    @staticmethod
    def record_repayment(person_name: str, amount: float) -> Optional[Dict[str, Any]]:
        debts = DebtsRepo.get_all()
        active = next(
            (d for d in debts if not d.get("settled") and person_name.lower() in d.get("personName", "").lower()),
            None,
        )
        if not active:
            return None

        remaining = max(0.0, float(active.get("amount", 0)) - float(amount))
        is_settled = remaining <= 0.0
        now = _now_iso()

        active["amount"] = remaining
        active["settled"] = is_settled
        active["updatedAt"] = now

        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE debts
                SET amount = ?, settled = ?, updated_at = ?, data = ?
                WHERE id = ?;
                """,
                (remaining, 1 if is_settled else 0, now, json.dumps(active), active["id"]),
            )
            return active
        finally:
            conn.close()

    @staticmethod
    def toggle_settled(debt_id: str) -> Optional[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM debts WHERE id = ?;", (debt_id,))
            row = cursor.fetchone()
            if not row:
                return None
            doc = json.loads(row["data"])
            doc["settled"] = not doc.get("settled", False)
            doc["updatedAt"] = _now_iso()

            cursor.execute(
                """
                UPDATE debts
                SET settled = ?, updated_at = ?, data = ?
                WHERE id = ?;
                """,
                (1 if doc["settled"] else 0, doc["updatedAt"], json.dumps(doc), debt_id),
            )
            return doc
        finally:
            conn.close()

    @staticmethod
    def delete(debt_id: str) -> bool:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM debts WHERE id = ?;", (debt_id,))
            return cursor.rowcount > 0
        finally:
            conn.close()

    @staticmethod
    def clear() -> None:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM debts;")
        finally:
            conn.close()


# ----------------------------------------------------
# 5. Templates Repository
# ----------------------------------------------------
class TemplatesRepo:
    @staticmethod
    def get_all() -> List[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM templates;")
            rows = cursor.fetchall()
            if not rows:
                # Seed defaults
                for tmpl in [NEW_DEFAULT_TEMPLATE, INDEPTH_TEMPLATE]:
                    TemplatesRepo.save(tmpl)
                return [NEW_DEFAULT_TEMPLATE, INDEPTH_TEMPLATE]
            return [json.loads(r["data"]) for r in rows]
        finally:
            conn.close()

    @staticmethod
    def get_by_id(tmpl_id: str) -> Optional[Dict[str, Any]]:
        all_tmpls = TemplatesRepo.get_all()
        return next((t for t in all_tmpls if t.get("id") == tmpl_id), None)

    @staticmethod
    def save(template: Dict[str, Any]) -> Dict[str, Any]:
        conn = get_db_connection()
        try:
            tmpl_id = template.get("id") or _gen_id("tmpl")
            now = _now_iso()
            item = dict(template)
            item["id"] = tmpl_id
            item["updatedAt"] = now
            if "createdAt" not in item:
                item["createdAt"] = now

            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO templates (id, name, description, is_default, has_table, table_title, created_at, updated_at, data)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description,
                    is_default = excluded.is_default,
                    has_table = excluded.has_table,
                    table_title = excluded.table_title,
                    updated_at = excluded.updated_at,
                    data = excluded.data;
                """,
                (
                    item["id"],
                    item.get("name", "Untitled Template"),
                    item.get("description", ""),
                    1 if item.get("isDefault") else 0,
                    1 if item.get("hasTable") else 0,
                    item.get("tableTitle", ""),
                    item["createdAt"],
                    item["updatedAt"],
                    json.dumps(item),
                ),
            )
            return item
        finally:
            conn.close()

    @staticmethod
    def delete(tmpl_id: str) -> bool:
        if tmpl_id == NEW_DEFAULT_TEMPLATE["id"]:
            return False  # Protect default
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM templates WHERE id = ?;", (tmpl_id,))
            return cursor.rowcount > 0
        finally:
            conn.close()

    @staticmethod
    def reset_defaults() -> List[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM templates;")
            for tmpl in [NEW_DEFAULT_TEMPLATE, INDEPTH_TEMPLATE]:
                now = _now_iso()
                item = dict(tmpl)
                item["updatedAt"] = now
                cursor.execute(
                    """
                    INSERT INTO templates (id, name, description, is_default, has_table, table_title, created_at, updated_at, data)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    (
                        item["id"],
                        item["name"],
                        item.get("description", ""),
                        1 if item.get("isDefault") else 0,
                        1 if item.get("hasTable") else 0,
                        item.get("tableTitle", ""),
                        item.get("createdAt", now),
                        item["updatedAt"],
                        json.dumps(item),
                    ),
                )
            return [NEW_DEFAULT_TEMPLATE, INDEPTH_TEMPLATE]
        finally:
            conn.close()


# ----------------------------------------------------
# 6. Lookup Tables Repository
# ----------------------------------------------------
class LookupTablesRepo:
    @staticmethod
    def get_all() -> List[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM lookup_tables;")
            rows = cursor.fetchall()
            if not rows:
                LookupTablesRepo.save(DEFAULT_PARTS_LOOKUP_TABLE)
                return [DEFAULT_PARTS_LOOKUP_TABLE]
            return [json.loads(r["data"]) for r in rows]
        finally:
            conn.close()

    @staticmethod
    def get_by_id(table_id: str) -> Optional[Dict[str, Any]]:
        all_tables = LookupTablesRepo.get_all()
        return next((t for t in all_tables if t.get("id") == table_id), None)

    @staticmethod
    def save(table: Dict[str, Any]) -> Dict[str, Any]:
        conn = get_db_connection()
        try:
            tbl_id = table.get("id") or _gen_id("lookup")
            now = _now_iso()
            item = dict(table)
            item["id"] = tbl_id
            item["updatedAt"] = now
            if "createdAt" not in item:
                item["createdAt"] = now

            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO lookup_tables (id, name, description, created_at, updated_at, data)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description,
                    updated_at = excluded.updated_at,
                    data = excluded.data;
                """,
                (
                    item["id"],
                    item.get("name", "Untitled Lookup Table"),
                    item.get("description", ""),
                    item["createdAt"],
                    item["updatedAt"],
                    json.dumps(item),
                ),
            )
            return item
        finally:
            conn.close()

    @staticmethod
    def merge_data(
        table_id: str,
        incoming_columns: List[str],
        incoming_rows: List[Dict[str, Any]],
        key_column: str,
        strategy: str = "update",
    ) -> Optional[Dict[str, Any]]:
        table = LookupTablesRepo.get_by_id(table_id)
        if not table:
            return None

        existing_columns: List[str] = list(table.get("columns") or [])
        existing_rows: List[Dict[str, Any]] = list(table.get("rows") or [])

        # 1. Merge new columns
        new_columns = []
        for col in incoming_columns:
            if col and col not in existing_columns:
                existing_columns.append(col)
                new_columns.append(col)

        # 2. Build index of existing rows on key_column
        def _norm_key(v: Any) -> str:
            if v is None:
                return ""
            return str(v).strip().lower()

        key_map: Dict[str, int] = {}
        for idx, row in enumerate(existing_rows):
            k = _norm_key(row.get(key_column))
            if k and k not in key_map:
                key_map[k] = idx

        added_count = 0
        updated_count = 0
        duplicate_count = 0

        # 3. Process incoming rows
        for inc_row in incoming_rows:
            inc_k = _norm_key(inc_row.get(key_column))

            if inc_k and inc_k in key_map:
                # Conflict / match found
                if strategy == "skip":
                    duplicate_count += 1
                elif strategy == "append":
                    new_row = dict(inc_row)
                    new_row["id"] = f"row_{len(existing_rows) + 1}_{_gen_id('r')[:4]}"
                    existing_rows.append(new_row)
                    added_count += 1
                else:  # "update" default: merge incoming fields without wiping existing ones
                    existing_row = existing_rows[key_map[inc_k]]
                    has_changes = False
                    for col, val in inc_row.items():
                        if col == "id":
                            continue
                        if val is not None and str(val).strip() != "":
                            if existing_row.get(col) != val:
                                existing_row[col] = val
                                has_changes = True
                    if has_changes:
                        updated_count += 1
                    else:
                        duplicate_count += 1
            else:
                # Brand new record
                new_row = dict(inc_row)
                if not new_row.get("id"):
                    new_row["id"] = f"row_{len(existing_rows) + 1}_{_gen_id('r')[:4]}"
                existing_rows.append(new_row)
                if inc_k:
                    key_map[inc_k] = len(existing_rows) - 1
                added_count += 1

        table["columns"] = existing_columns
        table["rows"] = existing_rows
        saved_table = LookupTablesRepo.save(table)

        return {
            "table": saved_table,
            "stats": {
                "addedRows": added_count,
                "updatedRows": updated_count,
                "duplicateRows": duplicate_count,
                "newColumns": new_columns,
                "totalRows": len(existing_rows),
            },
        }

    @staticmethod
    def delete(table_id: str) -> bool:
        if table_id == DEFAULT_PARTS_LOOKUP_TABLE["id"]:
            return False  # Protect default
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM lookup_tables WHERE id = ?;", (table_id,))
            return cursor.rowcount > 0
        finally:
            conn.close()

    @staticmethod
    def reset_defaults() -> List[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM lookup_tables;")
            now = _now_iso()
            item = dict(DEFAULT_PARTS_LOOKUP_TABLE)
            item["updatedAt"] = now
            cursor.execute(
                """
                INSERT INTO lookup_tables (id, name, description, created_at, updated_at, data)
                VALUES (?, ?, ?, ?, ?, ?);
                """,
                (item["id"], item["name"], item.get("description", ""), item["createdAt"], item["updatedAt"], json.dumps(item)),
            )
            return [DEFAULT_PARTS_LOOKUP_TABLE]
        finally:
            conn.close()


# ----------------------------------------------------
# 7. Handwriting Templates Repository
# ----------------------------------------------------
class HandwritingTemplatesRepo:
    @staticmethod
    def get_all() -> List[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM handwriting_templates;")
            rows = cursor.fetchall()
            if not rows:
                HandwritingTemplatesRepo.save(DEFAULT_HANDWRITING_SCANNING_TEMPLATE)
                return [DEFAULT_HANDWRITING_SCANNING_TEMPLATE]
            return [json.loads(r["data"]) for r in rows]
        finally:
            conn.close()

    @staticmethod
    def get_by_id(tmpl_id: str) -> Optional[Dict[str, Any]]:
        all_tmpls = HandwritingTemplatesRepo.get_all()
        return next((t for t in all_tmpls if t.get("id") == tmpl_id), None)

    @staticmethod
    def get_active() -> Dict[str, Any]:
        all_tmpls = HandwritingTemplatesRepo.get_all()
        return all_tmpls[0] if all_tmpls else DEFAULT_HANDWRITING_SCANNING_TEMPLATE

    @staticmethod
    def save(template: Dict[str, Any]) -> Dict[str, Any]:
        conn = get_db_connection()
        try:
            tmpl_id = template.get("id") or _gen_id("hw_tmpl")
            now = _now_iso()
            item = dict(template)
            item["id"] = tmpl_id
            item["updatedAt"] = now

            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO handwriting_templates (id, name, description, is_default, updated_at, data)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description,
                    is_default = excluded.is_default,
                    updated_at = excluded.updated_at,
                    data = excluded.data;
                """,
                (
                    item["id"],
                    item.get("name", "Handwriting Scanning Template"),
                    item.get("description", ""),
                    1 if item.get("isDefault") else 0,
                    item["updatedAt"],
                    json.dumps(item),
                ),
            )
            return item
        finally:
            conn.close()

    @staticmethod
    def delete(tmpl_id: str) -> bool:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM handwriting_templates WHERE id = ?;", (tmpl_id,))
            deleted = cursor.rowcount > 0
            cursor.execute("SELECT COUNT(*) FROM handwriting_templates;")
            if cursor.fetchone()[0] == 0:
                HandwritingTemplatesRepo.save(DEFAULT_HANDWRITING_SCANNING_TEMPLATE)
            return deleted
        finally:
            conn.close()

    @staticmethod
    def reset() -> List[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM handwriting_templates;")
            now = _now_iso()
            item = dict(DEFAULT_HANDWRITING_SCANNING_TEMPLATE)
            item["updatedAt"] = now
            cursor.execute(
                """
                INSERT INTO handwriting_templates (id, name, description, is_default, updated_at, data)
                VALUES (?, ?, ?, ?, ?, ?);
                """,
                (item["id"], item["name"], item.get("description", ""), 1, item["updatedAt"], json.dumps(item)),
            )
            return [DEFAULT_HANDWRITING_SCANNING_TEMPLATE]
        finally:
            conn.close()


# ----------------------------------------------------
# 8. Data Entries (ERP Records) Repository
# ----------------------------------------------------
class DataEntriesRepo:
    @staticmethod
    def get_all() -> List[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM data_entries ORDER BY date DESC, created_at DESC;")
            rows = cursor.fetchall()
            return [json.loads(r["data"]) for r in rows]
        finally:
            conn.close()

    @staticmethod
    def get_by_id(entry_id: str) -> Optional[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM data_entries WHERE id = ?;", (entry_id,))
            row = cursor.fetchone()
            return json.loads(row["data"]) if row else None
        finally:
            conn.close()

    @staticmethod
    def create(data: Dict[str, Any]) -> Dict[str, Any]:
        conn = get_db_connection()
        try:
            entry_id = data.get("id") or _gen_id("entry")
            now = _now_iso()
            created_at = data.get("createdAt") or data.get("created_at") or now
            updated_at = now
            date = data.get("date") or now.split("T")[0]
            entries_list = data.get("entries")
            total_entries = data.get("totalEntries") or (len(entries_list) if entries_list else 1)

            item: Dict[str, Any] = {
                "id": entry_id,
                "templateId": data.get("templateId") or data.get("template_id") or "default",
                "templateName": data.get("templateName") or data.get("template_name") or "Data Record",
                "isFlexible": bool(data.get("isFlexible") or data.get("is_flexible")),
                "title": data.get("title") or None,
                "fieldValues": data.get("fieldValues") or data.get("field_values") or {},
                "flexibleFields": data.get("flexibleFields") or data.get("flexible_fields") or None,
                "tableTitle": data.get("tableTitle") or data.get("table_title") or None,
                "tableHeaders": data.get("tableHeaders") or data.get("table_headers") or None,
                "tableRows": data.get("tableRows") or data.get("table_rows") or [],
                "tables": data.get("tables") or None,
                "rawTranscript": data.get("rawTranscript") or data.get("raw_transcript") or None,
                "entries": entries_list or None,
                "totalEntries": total_entries,
                "date": date,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }

            if "sapUploadStatus" in data:
                item["sapUploadStatus"] = data.get("sapUploadStatus")
            if "sapDocumentNumber" in data:
                item["sapDocumentNumber"] = data.get("sapDocumentNumber")
            if "sapLastUpload" in data:
                item["sapLastUpload"] = data.get("sapLastUpload")
            if "sapErrorMessage" in data:
                item["sapErrorMessage"] = data.get("sapErrorMessage")

            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO data_entries (
                    id, template_id, template_name, is_flexible, title, total_entries, date, created_at, updated_at, data
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    template_id = excluded.template_id,
                    template_name = excluded.template_name,
                    is_flexible = excluded.is_flexible,
                    title = excluded.title,
                    total_entries = excluded.total_entries,
                    date = excluded.date,
                    updated_at = excluded.updated_at,
                    data = excluded.data;
                """,
                (
                    item["id"],
                    item["templateId"],
                    item["templateName"],
                    1 if item["isFlexible"] else 0,
                    item["title"],
                    item["totalEntries"],
                    item["date"],
                    item["createdAt"],
                    item["updatedAt"],
                    json.dumps(item),
                ),
            )
            return item
        finally:
            conn.close()

    @staticmethod
    def create_many(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        created = []
        for item in items:
            created.append(DataEntriesRepo.create(item))
        return created

    @staticmethod
    def update(entry_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        existing = DataEntriesRepo.get_by_id(entry_id)
        if not existing:
            return None
        existing.update(updates)
        existing["updatedAt"] = _now_iso()
        return DataEntriesRepo.create(existing)

    @staticmethod
    def delete(entry_id: str) -> bool:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM data_entries WHERE id = ?;", (entry_id,))
            return cursor.rowcount > 0
        finally:
            conn.close()

    @staticmethod
    def clear() -> None:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM data_entries;")
        finally:
            conn.close()


# ----------------------------------------------------
# 9. Settings Repository
# ----------------------------------------------------
class SettingsRepo:
    @staticmethod
    def get() -> Dict[str, Any]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM settings WHERE key = 'app_settings';")
            row = cursor.fetchone()
            if not row:
                now = _now_iso()
                cursor.execute(
                    "INSERT INTO settings (key, data, updated_at) VALUES (?, ?, ?);",
                    ("app_settings", json.dumps(DEFAULT_SETTINGS), now),
                )
                return DEFAULT_SETTINGS
            doc = json.loads(row["data"])
            # Strip internal mongo _key or _id if present in data
            doc.pop("_id", None)
            doc.pop("_key", None)
            return doc
        finally:
            conn.close()

    @staticmethod
    def update(updates: Dict[str, Any]) -> Dict[str, Any]:
        conn = get_db_connection()
        try:
            current = SettingsRepo.get()
            current.update(updates)
            now = _now_iso()
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO settings (key, data, updated_at)
                VALUES ('app_settings', ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    data = excluded.data,
                    updated_at = excluded.updated_at;
                """,
                (json.dumps(current), now),
            )
            return current
        finally:
            conn.close()


# ----------------------------------------------------
# 10. Generic Documents Repository (for companies, suppliers, items, customers, sap_*, etc.)
# ----------------------------------------------------
class GenericRepo:
    @staticmethod
    def get_all(collection_name: str) -> List[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT data FROM generic_documents WHERE collection_name = ?;", (collection_name,))
            rows = cursor.fetchall()
            return [json.loads(r["data"]) for r in rows]
        finally:
            conn.close()

    @staticmethod
    def get_by_id(collection_name: str, doc_id: str) -> Optional[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT data FROM generic_documents WHERE collection_name = ? AND id = ?;",
                (collection_name, doc_id),
            )
            row = cursor.fetchone()
            return json.loads(row["data"]) if row else None
        finally:
            conn.close()

    @staticmethod
    def upsert(collection_name: str, doc_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        conn = get_db_connection()
        try:
            now = _now_iso()
            item = dict(data)
            item["id"] = doc_id
            created_at = item.get("createdAt") or now
            updated_at = item.get("updatedAt") or now

            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO generic_documents (collection_name, id, data, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(collection_name, id) DO UPDATE SET
                    data = excluded.data,
                    updated_at = excluded.updated_at;
                """,
                (collection_name, doc_id, json.dumps(item), created_at, updated_at),
            )
            return item
        finally:
            conn.close()

    @staticmethod
    def delete(collection_name: str, doc_id: str) -> bool:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM generic_documents WHERE collection_name = ? AND id = ?;",
                (collection_name, doc_id),
            )
            return cursor.rowcount > 0
        finally:
            conn.close()

    @staticmethod
    def clear(collection_name: str) -> None:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM generic_documents WHERE collection_name = ?;",
                (collection_name,),
            )
        finally:
            conn.close()


# ----------------------------------------------------
# 11. Database Operations Repository (Clear, Seed, Export, Import)
# ----------------------------------------------------
class DatabaseOpsRepo:
    @staticmethod
    def clear_all(target: str = "all") -> Dict[str, Any]:
        if target in ("all", "transactions"):
            TransactionsRepo.clear()
        if target in ("all", "receipts"):
            ReceiptsRepo.clear()
        if target in ("all", "budgets"):
            BudgetsRepo.clear()
        if target in ("all", "debts"):
            DebtsRepo.clear()
        if target in ("all", "data_entries"):
            DataEntriesRepo.clear()

        return {"success": True, "message": f"Database target '{target}' cleared successfully."}

    @staticmethod
    def seed_demo_data() -> Dict[str, int]:
        today = datetime.utcnow().strftime("%Y-%m-%d")
        now = _now_iso()

        sample_txs = [
            {
                "id": "demo_tx_1",
                "amount": 17500,
                "currency": "INR",
                "merchant": "Company Corp",
                "category": "Salary",
                "paymentMethod": "Bank Transfer",
                "transactionType": "income",
                "description": "Monthly Salary",
                "transcript": "I received 17500 as my salary.",
                "date": today,
                "createdAt": now,
            },
            {
                "id": "demo_tx_2",
                "amount": 450,
                "currency": "INR",
                "merchant": "Fresh Grocery Supermarket",
                "category": "Groceries",
                "paymentMethod": "Amazon Pay",
                "transactionType": "expense",
                "description": "Paid ₹450 to Grocery Shop",
                "transcript": "I paid 450 rupees to the grocery shop.",
                "date": today,
                "createdAt": now,
            },
        ]
        TransactionsRepo.create_many(sample_txs)

        BudgetsRepo.set_budget("Groceries", 5000, "monthly")
        BudgetsRepo.set_budget("Food", 4000, "monthly")

        DebtsRepo.record_debt("Ramesh Sharma", 1500, "given", "Loan for groceries", today)

        sample_entry = {
            "id": "demo_entry_1",
            "templateId": NEW_DEFAULT_TEMPLATE["id"],
            "templateName": NEW_DEFAULT_TEMPLATE["name"],
            "isFlexible": False,
            "fieldValues": {
                "part_no": "PRT-4029",
                "machine_name": "Injection Machine 01",
                "description": "Housing Gear Box",
                "raw_material": "ABS Resin Grade A",
                "prod_n_qty": "500 pcs",
                "reg_n_qty": "12 pcs",
                "ok_qty": "488 pcs",
                "date": today,
                "shift": "A",
            },
            "tableRows": [],
            "rawTranscript": "Logged 500 pcs on Injection Machine 01 for Housing Gear Box.",
            "totalEntries": 1,
            "date": today,
            "createdAt": now,
            "updatedAt": now,
        }
        DataEntriesRepo.create(sample_entry)

        return {
            "transactionsCount": len(sample_txs),
            "receiptsCount": 0,
            "budgetsCount": 2,
            "debtsCount": 1,
            "dataEntriesCount": 1,
        }

    @staticmethod
    def export_backup() -> Dict[str, Any]:
        return {
            "version": 3,
            "exportedAt": _now_iso(),
            "transactions": TransactionsRepo.get_all(),
            "receipts": ReceiptsRepo.get_all(),
            "budgets": BudgetsRepo.get_all(),
            "debts": DebtsRepo.get_all(),
            "templates": TemplatesRepo.get_all(),
            "lookupTables": LookupTablesRepo.get_all(),
            "handwritingTemplates": HandwritingTemplatesRepo.get_all(),
            "dataEntries": DataEntriesRepo.get_all(),
            "settings": SettingsRepo.get(),
        }

    @staticmethod
    def import_data(payload: Dict[str, Any]) -> Dict[str, Any]:
        tx_list = payload.get("transactions", [])
        rcpt_list = payload.get("receipts", [])
        tmpl_list = payload.get("templates", [])
        entries_list = payload.get("dataEntries", [])

        imported_tx = TransactionsRepo.create_many(tx_list) if tx_list else []
        imported_rcpts = ReceiptsRepo.create_many(rcpt_list) if rcpt_list else []
        imported_entries = DataEntriesRepo.create_many(entries_list) if entries_list else []

        for tmpl in tmpl_list:
            if isinstance(tmpl, dict) and tmpl.get("id"):
                TemplatesRepo.save(tmpl)

        total_found = len(tx_list) + len(rcpt_list) + len(tmpl_list) + len(entries_list)
        imported_count = len(imported_tx) + len(imported_rcpts) + len(imported_entries) + len(tmpl_list)

        return {
            "totalFound": total_found,
            "importedCount": imported_count,
            "skippedCount": total_found - imported_count,
            "errors": [],
        }

    @staticmethod
    def get_stats() -> Dict[str, Any]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            counts = {}
            for table in [
                "transactions",
                "receipts",
                "budgets",
                "debts",
                "templates",
                "lookup_tables",
                "handwriting_templates",
                "data_entries",
                "generic_documents",
                "ocr_results",
            ]:
                try:
                    cursor.execute(f"SELECT COUNT(*) FROM {table};")
                    counts[table] = cursor.fetchone()[0]
                except Exception:
                    counts[table] = 0

            from app.db.connection import get_db_path
            db_path = get_db_path()
            size_bytes = os.path.getsize(db_path) if os.path.exists(db_path) else 0

            return {
                "storageEngine": "SQLite",
                "journalMode": "WAL",
                "databasePath": db_path,
                "databaseSizeBytes": size_bytes,
                "databaseSizeKB": round(size_bytes / 1024, 2),
                "counts": counts,
            }
        finally:
            conn.close()


# ----------------------------------------------------
# 12. OCR Results Repository (Raw OCR & LLM Pipeline)
# ----------------------------------------------------
class OcrResultsRepo:
    @staticmethod
    def create(data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Saves raw OCR output to SQLite immediately upon OCR completion.
        Preserves complete raw OCR output including raw HTML layout, bounding boxes, and text.
        """
        conn = get_db_connection()
        try:
            ocr_id = data.get("id") or _gen_id("ocr")
            now = _now_iso()
            filename = data.get("filename") or "document"
            ocr_method = data.get("ocr_method") or "chandra_2"
            chandra_mode = data.get("chandra_mode") or "full_image"
            raw_text = data.get("raw_text") or ""
            structured_text = data.get("structured_text") or raw_text
            clean_text = data.get("clean_text") or ""
            template_id = data.get("template_id")
            template_name = data.get("template_name")
            page_count = int(data.get("page_count") or 1)
            status = data.get("status") or "completed"
            created_at = data.get("created_at") or now
            raw_payload = data.get("data")
            llm_result = data.get("llm_result")

            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO ocr_results (
                    id, filename, ocr_method, chandra_mode, raw_text, structured_text,
                    clean_text, template_id, template_name, page_count, status,
                    created_at, data, llm_result
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    ocr_id,
                    filename,
                    ocr_method,
                    chandra_mode,
                    raw_text,
                    structured_text,
                    clean_text,
                    template_id,
                    template_name,
                    page_count,
                    status,
                    created_at,
                    json.dumps(raw_payload) if raw_payload is not None else None,
                    json.dumps(llm_result) if llm_result is not None else None,
                ),
            )
            logger.info(f"[OcrResultsRepo] Saved raw OCR output into SQLite: id='{ocr_id}', file='{filename}', method='{ocr_method}', chars={len(raw_text)}")
            return {
                "id": ocr_id,
                "filename": filename,
                "ocr_method": ocr_method,
                "chandra_mode": chandra_mode,
                "raw_text": raw_text,
                "structured_text": structured_text,
                "clean_text": clean_text,
                "template_id": template_id,
                "template_name": template_name,
                "page_count": page_count,
                "status": status,
                "created_at": created_at,
                "llm_result": llm_result,
            }
        finally:
            conn.close()

    @staticmethod
    def get_by_id(ocr_id: str) -> Optional[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM ocr_results WHERE id = ?;", (ocr_id,))
            row = cursor.fetchone()
            if not row:
                return None
            res = dict(row)
            if res.get("data"):
                try:
                    res["data"] = json.loads(res["data"])
                except Exception:
                    pass
            if res.get("llm_result"):
                try:
                    res["llm_result"] = json.loads(res["llm_result"])
                except Exception:
                    pass
            return res
        finally:
            conn.close()

    @staticmethod
    def update_llm_result(ocr_id: str, llm_result: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE ocr_results
                SET llm_result = ?, status = 'extracted'
                WHERE id = ?;
                """,
                (json.dumps(llm_result), ocr_id),
            )
            logger.info(f"[OcrResultsRepo] Updated SQLite record '{ocr_id}' with final parsed LLM result.")
            return OcrResultsRepo.get_by_id(ocr_id)
        finally:
            conn.close()

    @staticmethod
    def get_recent(limit: int = 20) -> List[Dict[str, Any]]:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM ocr_results ORDER BY created_at DESC LIMIT ?;", (limit,))
            rows = cursor.fetchall()
            results = []
            for r in rows:
                item = dict(r)
                if item.get("data"):
                    try:
                        item["data"] = json.loads(item["data"])
                    except Exception:
                        pass
                if item.get("llm_result"):
                    try:
                        item["llm_result"] = json.loads(item["llm_result"])
                    except Exception:
                        pass
                results.append(item)
            return results
        finally:
            conn.close()
