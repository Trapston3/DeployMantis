"""
MantisLaunch store — dual-mode: asyncpg (PostgreSQL) or stdlib sqlite3.

Table schema:
  mantis_launch_snapshots(
      id            SERIAL / INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_hash TEXT UNIQUE NOT NULL,  -- SHA-256 hash of snapshot metadata
      captured_at   TEXT NOT NULL,         -- ISO-8601 UTC
      snapshot_json TEXT NOT NULL          -- full environment metadata as JSON
  )

An index on ``snapshot_hash`` is created for fast retrieval.

Mode is controlled by ``IS_SQLITE`` in ``db.connection``:
  IS_SQLITE=true  → synchronous sqlite3 helpers wrapped in asyncio.to_thread()
  IS_SQLITE=false → asyncpg pool

Public API (all async except init_db):
  init_db()                                 → sync, idempotent
  insert_snapshot(hash, captured_at, json)  → async None
  get_snapshot(snapshot_hash)               → async Optional[Dict]
  list_snapshots()                          → async List[Dict]
"""

import asyncio
import logging
import os
import sqlite3
from typing import Any, Dict, List, Optional

from db.connection import IS_SQLITE, get_pool

logger = logging.getLogger("deploymantis.mantis_launch.store")

# ── SQLite path (used only when IS_SQLITE=true) ───────────────────────────────
_DB_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
_DB_PATH = os.path.join(_DB_DIR, "mantis_launch.db")


# ── Internal SQLite helpers ───────────────────────────────────────────────────

def _connect() -> sqlite3.Connection:
    """Return a WAL-mode SQLite connection (SQLite mode only)."""
    os.makedirs(_DB_DIR, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


# ── Synchronous SQLite implementations (executed inside asyncio.to_thread) ────

def _sqlite_insert_snapshot(
    snapshot_hash: str, captured_at: str, snapshot_json: str
) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO mantis_launch_snapshots
                (snapshot_hash, captured_at, snapshot_json)
            VALUES (?, ?, ?)
            """,
            (snapshot_hash, captured_at, snapshot_json),
        )
        conn.commit()
    logger.info("MantisLaunch: snapshot stored with hash %s", snapshot_hash)


def _sqlite_get_snapshot(snapshot_hash: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            """
            SELECT id, snapshot_hash, captured_at, snapshot_json
            FROM   mantis_launch_snapshots
            WHERE  snapshot_hash = ?
            LIMIT  1
            """,
            (snapshot_hash,),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return dict(row)


def _sqlite_list_snapshots() -> List[Dict[str, Any]]:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            """
            SELECT snapshot_hash, captured_at
            FROM   mantis_launch_snapshots
            ORDER  BY captured_at DESC
            """
        )
        rows = cur.fetchall()
    return [dict(row) for row in rows]


# ── PostgreSQL implementations ────────────────────────────────────────────────

async def _pg_insert_snapshot(
    snapshot_hash: str, captured_at: str, snapshot_json: str
) -> None:
    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO mantis_launch_snapshots (snapshot_hash, captured_at, snapshot_json)
            VALUES ($1, $2, $3)
            ON CONFLICT (snapshot_hash) DO UPDATE SET
                captured_at   = EXCLUDED.captured_at,
                snapshot_json = EXCLUDED.snapshot_json
            """,
            snapshot_hash, captured_at, snapshot_json,
        )
    logger.info("MantisLaunch: snapshot stored with hash %s", snapshot_hash)


async def _pg_get_snapshot(snapshot_hash: str) -> Optional[Dict[str, Any]]:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, snapshot_hash, captured_at, snapshot_json
            FROM   mantis_launch_snapshots
            WHERE  snapshot_hash = $1
            LIMIT  1
            """,
            snapshot_hash,
        )
    if row is None:
        return None
    return dict(row)


async def _pg_list_snapshots() -> List[Dict[str, Any]]:
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT snapshot_hash, captured_at
            FROM   mantis_launch_snapshots
            ORDER  BY captured_at DESC
            """
        )
    return [dict(row) for row in rows]


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
            CREATE TABLE IF NOT EXISTS mantis_launch_snapshots (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_hash TEXT    UNIQUE NOT NULL,
                captured_at   TEXT    NOT NULL,
                snapshot_json TEXT    NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_mantis_launch_snapshots_hash
            ON mantis_launch_snapshots (snapshot_hash)
            """
        )
        conn.commit()
    logger.info("MantisLaunch DB initialised at %s", os.path.abspath(_DB_PATH))


async def insert_snapshot(snapshot_hash: str, captured_at: str, snapshot_json: str) -> None:
    """Insert or replace a launch snapshot.

    Args:
        snapshot_hash: SHA-256 hash of the snapshot configuration.
        captured_at:   ISO-8601 UTC timestamp string.
        snapshot_json: Full snapshot configuration serialized to a JSON string.
    """
    if IS_SQLITE:
        await asyncio.to_thread(
            _sqlite_insert_snapshot, snapshot_hash, captured_at, snapshot_json
        )
    else:
        await _pg_insert_snapshot(snapshot_hash, captured_at, snapshot_json)


async def get_snapshot(snapshot_hash: str) -> Optional[Dict[str, Any]]:
    """Return a specific snapshot by its hash, or None if not found.

    Returns:
        A dict with keys ``id``, ``snapshot_hash``, ``captured_at``, ``snapshot_json``
        or ``None`` if not found.
    """
    if IS_SQLITE:
        return await asyncio.to_thread(_sqlite_get_snapshot, snapshot_hash)
    return await _pg_get_snapshot(snapshot_hash)


async def list_snapshots() -> List[Dict[str, Any]]:
    """Return all stored snapshots ordered by captured_at DESC.

    Returns:
        A list of dicts with keys ``snapshot_hash`` and ``captured_at``.
    """
    if IS_SQLITE:
        return await asyncio.to_thread(_sqlite_list_snapshots)
    return await _pg_list_snapshots()
