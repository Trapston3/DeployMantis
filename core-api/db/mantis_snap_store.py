"""
MantisSnap store — dual-mode: asyncpg (PostgreSQL) or stdlib sqlite3.

Table schema:
  mantis_snap(
      id            SERIAL / INTEGER PRIMARY KEY AUTOINCREMENT,
      branch        TEXT NOT NULL,
      captured_at   TEXT NOT NULL,   -- ISO-8601 UTC
      snapshot_json TEXT NOT NULL
  )

Index on (branch, captured_at DESC) lets the GET path resolve the latest
snapshot for a branch in O(log n) without a full table scan.

Mode is controlled by ``IS_SQLITE`` in ``db.connection``:
  IS_SQLITE=true  → synchronous sqlite3 helpers wrapped in asyncio.to_thread()
  IS_SQLITE=false → asyncpg pool

Public API (all async except init_db):
  init_db()                                   → sync, idempotent
  insert_snapshot(branch, captured_at, json)  → async int  (row id)
  get_latest_snapshot(branch)                 → async Optional[dict]
"""

import asyncio
import logging
import os
import sqlite3
from typing import Optional

from db.connection import IS_SQLITE, get_pool

logger = logging.getLogger("deploymantis.mantis_snap.store")

# ── SQLite path (used only when IS_SQLITE=true) ───────────────────────────────
_DB_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
_DB_PATH = os.path.join(_DB_DIR, "mantis_snap.db")


# ── Internal SQLite helpers ───────────────────────────────────────────────────

def _connect() -> sqlite3.Connection:
    """Return a WAL-mode SQLite connection (SQLite mode only)."""
    os.makedirs(_DB_DIR, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


# ── Synchronous SQLite implementations (executed inside asyncio.to_thread) ────

def _sqlite_insert_snapshot(branch: str, captured_at: str, snapshot_json: str) -> int:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO mantis_snap (branch, captured_at, snapshot_json) VALUES (?, ?, ?)",
            (branch, captured_at, snapshot_json),
        )
        conn.commit()
        row_id: int = cur.lastrowid  # type: ignore[assignment]
    logger.info("MantisSnap: snapshot %d stored for branch '%s'", row_id, branch)
    return row_id


def _sqlite_get_latest_snapshot(branch: str) -> Optional[dict]:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            """
            SELECT id, branch, captured_at, snapshot_json
            FROM   mantis_snap
            WHERE  branch = ?
            ORDER  BY captured_at DESC
            LIMIT  1
            """,
            (branch,),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return dict(row)


# ── PostgreSQL implementations ────────────────────────────────────────────────

async def _pg_insert_snapshot(branch: str, captured_at: str, snapshot_json: str) -> int:
    async with get_pool().acquire() as conn:
        row_id: int = await conn.fetchval(
            """
            INSERT INTO mantis_snap (branch, captured_at, snapshot_json)
            VALUES ($1, $2, $3)
            RETURNING id
            """,
            branch, captured_at, snapshot_json,
        )
    logger.info("MantisSnap: snapshot %d stored for branch '%s'", row_id, branch)
    return row_id


async def _pg_get_latest_snapshot(branch: str) -> Optional[dict]:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, branch, captured_at, snapshot_json
            FROM   mantis_snap
            WHERE  branch = $1
            ORDER  BY captured_at DESC
            LIMIT  1
            """,
            branch,
        )
    if row is None:
        return None
    return dict(row)


# ── Public API ────────────────────────────────────────────────────────────────

def init_db() -> None:
    """Create the table and index if they do not yet exist.

    No-op in PostgreSQL mode — ``migrate.py`` handles schema creation.
    Synchronous — safe to call at module level or from a sync startup hook.
    Idempotent: safe to call multiple times.
    """
    if not IS_SQLITE:
        return
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS mantis_snap (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                branch        TEXT    NOT NULL,
                captured_at   TEXT    NOT NULL,
                snapshot_json TEXT    NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_mantis_snap_branch_time
            ON mantis_snap (branch, captured_at DESC)
            """
        )
        conn.commit()
    logger.info("MantisSnap DB initialised at %s", os.path.abspath(_DB_PATH))


async def insert_snapshot(branch: str, captured_at: str, snapshot_json: str) -> int:
    """Insert a new snapshot row and return its integer primary key.

    Args:
        branch:        Git branch name (or user-supplied override).
        captured_at:   ISO-8601 UTC timestamp string.
        snapshot_json: Full snapshot payload serialised to a JSON string.

    Returns:
        The auto-assigned integer primary key of the new row.
    """
    if IS_SQLITE:
        return await asyncio.to_thread(
            _sqlite_insert_snapshot, branch, captured_at, snapshot_json
        )
    return await _pg_insert_snapshot(branch, captured_at, snapshot_json)


async def get_latest_snapshot(branch: str) -> Optional[dict]:
    """Return the most recent snapshot dict for *branch*, or None.

    The query selects the single row with the highest captured_at for the
    given branch — O(log n) via the composite index.

    Returns:
        A dict with keys ``id``, ``branch``, ``captured_at``, ``snapshot_json``
        (the last field is still a raw JSON string — deserialisation is the
        router's responsibility), or ``None`` if no rows exist for the branch.
    """
    if IS_SQLITE:
        return await asyncio.to_thread(_sqlite_get_latest_snapshot, branch)
    return await _pg_get_latest_snapshot(branch)
