"""
MantisStyle SQLite Store
========================
Lightweight, stdlib-only helper. Zero external pip dependencies.

Table schema (auto-created on first call to init_db):

  mantis_style(
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_json TEXT NOT NULL,         -- JSON representation of the style profile
      updated_at   TEXT NOT NULL          -- ISO-8601 UTC timestamp
  )
"""

import os
import sqlite3
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("deploymantis.mantis_style.store")

# Resolve DB path relative to THIS file so it works regardless of cwd.
_DB_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
_DB_PATH = os.path.join(_DB_DIR, "mantis_style.db")


def _connect() -> sqlite3.Connection:
    """Return a connection with WAL mode for safe concurrent reads."""
    os.makedirs(_DB_DIR, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


def init_db() -> None:
    """Create the table if it does not yet exist.

    Called once at application startup or router import.
    """
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS mantis_style (
                id           INTEGER PRIMARY KEY,
                profile_json TEXT    NOT NULL,
                updated_at   TEXT    NOT NULL
            )
            """
        )
        conn.commit()
    logger.info("MantisStyle DB initialised at %s", os.path.abspath(_DB_PATH))


def store_profile(profile_json: str) -> None:
    """Insert or replace the single active style profile."""
    updated_at = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        # We always overwrite the single record at ID=1
        conn.execute(
            """
            INSERT OR REPLACE INTO mantis_style (id, profile_json, updated_at)
            VALUES (1, ?, ?)
            """,
            (profile_json, updated_at),
        )
        conn.commit()
    logger.info("MantisStyle: profile updated in DB at %s", updated_at)


def get_profile() -> Optional[str]:
    """Retrieve the cached profile_json string if it exists."""
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            """
            SELECT profile_json
            FROM   mantis_style
            WHERE  id = 1
            LIMIT  1
            """
        )
        row = cur.fetchone()

    if row is None:
        return None
    return row["profile_json"]
