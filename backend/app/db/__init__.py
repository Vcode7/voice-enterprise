"""
Database module for Voice ERP SQLite engine.
"""
from .connection import get_db_connection, db_session
from .init_db import init_database
from .repositories import (
    TransactionsRepo,
    ReceiptsRepo,
    BudgetsRepo,
    DebtsRepo,
    DataEntriesRepo,
    TemplatesRepo,
    LookupTablesRepo,
    HandwritingTemplatesRepo,
    SettingsRepo,
    GenericRepo,
    DatabaseOpsRepo,
    OcrResultsRepo,
)

__all__ = [
    "get_db_connection",
    "db_session",
    "init_database",
    "TransactionsRepo",
    "ReceiptsRepo",
    "BudgetsRepo",
    "DebtsRepo",
    "DataEntriesRepo",
    "TemplatesRepo",
    "LookupTablesRepo",
    "HandwritingTemplatesRepo",
    "SettingsRepo",
    "GenericRepo",
    "DatabaseOpsRepo",
    "OcrResultsRepo",
]
