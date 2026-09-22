import json
from datetime import datetime
from app.db.connection import get_db_connection
from app.db.defaults import (
    DEFAULT_SETTINGS,
    DEFAULT_PARTS_LOOKUP_TABLE,
    NEW_DEFAULT_TEMPLATE,
    INDEPTH_TEMPLATE,
    DEFAULT_HANDWRITING_SCANNING_TEMPLATE,
)
from app.core.logger import logger


def init_database() -> None:
    """
    Initializes SQLite database schema, constraints, indexes, and initial defaults.
    Safe to execute multiple times (idempotent).
    """
    conn = get_db_connection()
    try:
        cursor = conn.cursor()

        # 1. Transactions
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            amount REAL NOT NULL,
            currency TEXT DEFAULT 'INR',
            merchant TEXT,
            category TEXT DEFAULT 'Other',
            payment_method TEXT,
            transaction_type TEXT DEFAULT 'expense',
            description TEXT,
            transcript TEXT,
            date TEXT NOT NULL,
            created_at TEXT NOT NULL,
            data JSON NOT NULL
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC, created_at DESC);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);")

        # 2. Receipts
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS receipts (
            id TEXT PRIMARY KEY,
            receipt_number TEXT NOT NULL,
            date TEXT NOT NULL,
            customer_name TEXT,
            customer_phone TEXT,
            subtotal REAL DEFAULT 0,
            discount REAL DEFAULT 0,
            tax REAL DEFAULT 0,
            tax_percent REAL DEFAULT 0,
            tax_type TEXT DEFAULT 'none',
            cgst REAL DEFAULT 0,
            sgst REAL DEFAULT 0,
            igst REAL DEFAULT 0,
            grand_total REAL NOT NULL,
            currency TEXT DEFAULT 'INR',
            transcript TEXT,
            created_at TEXT NOT NULL,
            data JSON NOT NULL
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(date DESC, created_at DESC);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_receipts_number ON receipts(receipt_number);")

        # 3. Budgets
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS budgets (
            id TEXT PRIMARY KEY,
            category TEXT UNIQUE NOT NULL COLLATE NOCASE,
            amount REAL NOT NULL,
            period TEXT DEFAULT 'monthly',
            created_at TEXT NOT NULL,
            data JSON NOT NULL
        );
        """)

        # 4. Debts
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS debts (
            id TEXT PRIMARY KEY,
            person_name TEXT NOT NULL,
            amount REAL NOT NULL,
            type TEXT NOT NULL,
            settled INTEGER DEFAULT 0,
            notes TEXT,
            date TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            data JSON NOT NULL
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_debts_person ON debts(person_name);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_debts_updated ON debts(updated_at DESC);")

        # 5. Templates
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            is_default INTEGER DEFAULT 0,
            has_table INTEGER DEFAULT 0,
            table_title TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            data JSON NOT NULL
        );
        """)

        # 6. Handwriting Templates
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS handwriting_templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            is_default INTEGER DEFAULT 0,
            updated_at TEXT NOT NULL,
            data JSON NOT NULL
        );
        """)

        # 7. Lookup Tables
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS lookup_tables (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            data JSON NOT NULL
        );
        """)

        # 8. Data Entries (ERP Records)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS data_entries (
            id TEXT PRIMARY KEY,
            template_id TEXT NOT NULL,
            template_name TEXT NOT NULL,
            is_flexible INTEGER DEFAULT 0,
            title TEXT,
            total_entries INTEGER DEFAULT 1,
            date TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            data JSON NOT NULL
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_entries_date ON data_entries(date DESC, created_at DESC);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_entries_template ON data_entries(template_id);")

        # 9. Settings
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            data JSON NOT NULL,
            updated_at TEXT NOT NULL
        );
        """)

        # 10. Generic Documents (companies, suppliers, items, customers, sap_*, prescriptions)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS generic_documents (
            collection_name TEXT NOT NULL,
            id TEXT NOT NULL,
            data JSON NOT NULL,
            created_at TEXT,
            updated_at TEXT,
            PRIMARY KEY (collection_name, id)
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_generic_collection ON generic_documents(collection_name);")

        # 11. OCR Results (Raw OCR outputs from Chandra 2, layout HTML, clean text, and downstream LLM extractions)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS ocr_results (
            id TEXT PRIMARY KEY,
            filename TEXT,
            ocr_method TEXT DEFAULT 'chandra_2',
            chandra_mode TEXT DEFAULT 'full_image',
            raw_text TEXT NOT NULL,
            structured_text TEXT,
            clean_text TEXT,
            template_id TEXT,
            template_name TEXT,
            page_count INTEGER DEFAULT 1,
            status TEXT DEFAULT 'completed',
            created_at TEXT NOT NULL,
            data JSON,
            llm_result JSON
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_ocr_results_created ON ocr_results(created_at DESC);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_ocr_results_template ON ocr_results(template_id);")

        # Seed Settings if empty
        cursor.execute("SELECT COUNT(*) FROM settings WHERE key = 'app_settings';")
        if cursor.fetchone()[0] == 0:
            now_iso = datetime.utcnow().isoformat() + "Z"
            cursor.execute(
                "INSERT INTO settings (key, data, updated_at) VALUES (?, ?, ?);",
                ("app_settings", json.dumps(DEFAULT_SETTINGS), now_iso),
            )
            logger.info("Seeded default app_settings in SQLite.")

        # Seed Templates if empty
        cursor.execute("SELECT COUNT(*) FROM templates;")
        if cursor.fetchone()[0] == 0:
            for tmpl in [NEW_DEFAULT_TEMPLATE, INDEPTH_TEMPLATE]:
                cursor.execute(
                    """
                    INSERT INTO templates (id, name, description, is_default, has_table, table_title, created_at, updated_at, data)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    (
                        tmpl["id"],
                        tmpl["name"],
                        tmpl.get("description", ""),
                        1 if tmpl.get("isDefault") else 0,
                        1 if tmpl.get("hasTable") else 0,
                        tmpl.get("tableTitle", ""),
                        tmpl.get("createdAt", datetime.utcnow().isoformat() + "Z"),
                        tmpl.get("updatedAt", datetime.utcnow().isoformat() + "Z"),
                        json.dumps(tmpl),
                    ),
                )
            logger.info("Seeded default data templates in SQLite.")

        # Seed Lookup Tables if empty
        cursor.execute("SELECT COUNT(*) FROM lookup_tables;")
        if cursor.fetchone()[0] == 0:
            cursor.execute(
                """
                INSERT INTO lookup_tables (id, name, description, created_at, updated_at, data)
                VALUES (?, ?, ?, ?, ?, ?);
                """,
                (
                    DEFAULT_PARTS_LOOKUP_TABLE["id"],
                    DEFAULT_PARTS_LOOKUP_TABLE["name"],
                    DEFAULT_PARTS_LOOKUP_TABLE.get("description", ""),
                    DEFAULT_PARTS_LOOKUP_TABLE.get("createdAt", datetime.utcnow().isoformat() + "Z"),
                    DEFAULT_PARTS_LOOKUP_TABLE.get("updatedAt", datetime.utcnow().isoformat() + "Z"),
                    json.dumps(DEFAULT_PARTS_LOOKUP_TABLE),
                ),
            )
            logger.info("Seeded default lookup table in SQLite.")

        # Seed Handwriting Template if empty
        cursor.execute("SELECT COUNT(*) FROM handwriting_templates;")
        if cursor.fetchone()[0] == 0:
            cursor.execute(
                """
                INSERT INTO handwriting_templates (id, name, description, is_default, updated_at, data)
                VALUES (?, ?, ?, ?, ?, ?);
                """,
                (
                    DEFAULT_HANDWRITING_SCANNING_TEMPLATE["id"],
                    DEFAULT_HANDWRITING_SCANNING_TEMPLATE["name"],
                    DEFAULT_HANDWRITING_SCANNING_TEMPLATE.get("description", ""),
                    1 if DEFAULT_HANDWRITING_SCANNING_TEMPLATE.get("isDefault") else 0,
                    DEFAULT_HANDWRITING_SCANNING_TEMPLATE.get("updatedAt", datetime.utcnow().isoformat() + "Z"),
                    json.dumps(DEFAULT_HANDWRITING_SCANNING_TEMPLATE),
                ),
            )
            logger.info("Seeded default handwriting scanning template in SQLite.")

        logger.info("SQLite database schema initialized successfully.")

    finally:
        conn.close()
