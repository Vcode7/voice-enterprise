import os
import sqlite3
from contextlib import contextmanager
from typing import Generator
from app.config import settings
from app.core.logger import logger


def get_db_path() -> str:
    db_path = settings.SQLITE_DB_PATH
    db_dir = os.path.dirname(db_path)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    return db_path


def get_db_connection() -> sqlite3.Connection:
    """
    Creates and configures a SQLite connection with WAL mode and row factory.
    """
    db_path = get_db_path()
    conn = sqlite3.connect(
        db_path,
        timeout=15.0,
        check_same_thread=False,
        isolation_level=None,  # Autocommit mode; transactions managed explicitly or per statement
    )
    conn.row_factory = sqlite3.Row

    # Performance and concurrency pragmas
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 5000;")

    return conn


@contextmanager
def db_session() -> Generator[sqlite3.Connection, None, None]:
    """
    Context manager providing a managed SQLite connection.
    Begins transaction, commits on completion, rollbacks on error.
    """
    conn = get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE;")
        yield conn
        conn.execute("COMMIT;")
    except Exception as e:
        try:
            conn.execute("ROLLBACK;")
        except Exception:
            pass
        logger.error(f"[SQLite Session Error] {str(e)}", exc_info=True)
        raise
    finally:
        conn.close()
