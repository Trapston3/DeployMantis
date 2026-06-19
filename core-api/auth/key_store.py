"""
Auth key store — dual-mode: asyncpg (PostgreSQL) or stdlib sqlite3.

Mode is controlled by ``IS_SQLITE`` in ``db.connection``:
  IS_SQLITE=true  → public async functions delegate to synchronous sqlite3
                    helpers wrapped in asyncio.to_thread().
  IS_SQLITE=false → public async functions use the asyncpg pool directly.

Public API (all async except init_db):
  init_db()                  → sync, idempotent — safe at module level / startup
  create_key(...)            → async str
  lookup_key(raw_key)        → async Optional[Dict]
  count_tenant_keys(tenant)  → async int   [new — replaces raw _connect() in middleware]
"""

import asyncio
import hashlib
import json
import logging
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from db.connection import IS_SQLITE, get_pool

logger = logging.getLogger("deploymantis.auth.store")

# ── SQLite path (used only when IS_SQLITE=true) ───────────────────────────────
_DB_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
_DB_PATH = os.path.join(_DB_DIR, "org_keys.db")


# ── Internal SQLite helpers ───────────────────────────────────────────────────

def _connect() -> sqlite3.Connection:
    """Return a WAL-mode SQLite connection (SQLite mode only)."""
    os.makedirs(_DB_DIR, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


def _hash_key(key: str) -> str:
    """Compute SHA-256 hex digest of a raw API key."""
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


# ── Synchronous SQLite implementations (executed inside asyncio.to_thread) ────

def _sqlite_create_key(tenant_id: str, org_name: str, scopes: List[str]) -> str:
    raw_key = f"mantis_live_{secrets.token_hex(24)}"
    key_hash = _hash_key(raw_key)
    scopes_json = json.dumps(scopes)
    created_at = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO org_keys (tenant_id, key_hash, scopes, org_name, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (tenant_id, key_hash, scopes_json, org_name, created_at),
        )
        conn.commit()
    logger.info("Auth: Created API key for tenant_id=%s, org=%s", tenant_id, org_name)
    return raw_key


def _sqlite_lookup_key(raw_key: str) -> Optional[Dict[str, Any]]:
    key_hash = _hash_key(raw_key)
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            """
            SELECT tenant_id, scopes, org_name, created_at
            FROM org_keys
            WHERE key_hash = ?
            LIMIT 1
            """,
            (key_hash,),
        )
        row = cur.fetchone()
    if row is None:
        return None
    data = dict(row)
    data["scopes"] = json.loads(data["scopes"])
    return data


def _sqlite_count_tenant_keys(tenant_id: str) -> int:
    with _connect() as conn:
        cur = conn.execute(
            "SELECT COUNT(*) FROM org_keys WHERE tenant_id = ?",
            (tenant_id,),
        )
        return cur.fetchone()[0]


# ── PostgreSQL implementations ────────────────────────────────────────────────

async def _pg_create_key(tenant_id: str, org_name: str, scopes: List[str]) -> str:
    raw_key = f"mantis_live_{secrets.token_hex(24)}"
    key_hash = _hash_key(raw_key)
    scopes_json = json.dumps(scopes)
    created_at = datetime.now(timezone.utc).isoformat()
    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO org_keys (tenant_id, key_hash, scopes, org_name, created_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (tenant_id) DO UPDATE SET
                key_hash   = EXCLUDED.key_hash,
                scopes     = EXCLUDED.scopes,
                org_name   = EXCLUDED.org_name,
                created_at = EXCLUDED.created_at
            """,
            tenant_id, key_hash, scopes_json, org_name, created_at,
        )
    logger.info("Auth: Created API key for tenant_id=%s, org=%s", tenant_id, org_name)
    return raw_key


async def _pg_lookup_key(raw_key: str) -> Optional[Dict[str, Any]]:
    key_hash = _hash_key(raw_key)
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT tenant_id, scopes, org_name, created_at
            FROM org_keys
            WHERE key_hash = $1
            LIMIT 1
            """,
            key_hash,
        )
    if row is None:
        return None
    data = dict(row)
    data["scopes"] = json.loads(data["scopes"])
    return data


async def _pg_count_tenant_keys(tenant_id: str) -> int:
    async with get_pool().acquire() as conn:
        return await conn.fetchval(
            "SELECT COUNT(*) FROM org_keys WHERE tenant_id = $1",
            tenant_id,
        )


# ── Public API ────────────────────────────────────────────────────────────────

def init_db() -> None:
    """Create the org_keys table if it does not yet exist.

    No-op in PostgreSQL mode — ``migrate.py`` handles schema creation.
    Synchronous so it can be called safely at module level or from a
    synchronous startup hook.
    """
    if not IS_SQLITE:
        return
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS org_keys (
                tenant_id   TEXT PRIMARY KEY,
                key_hash    TEXT UNIQUE NOT NULL,
                scopes      TEXT NOT NULL,
                org_name    TEXT NOT NULL,
                created_at  TEXT NOT NULL
            )
            """
        )
        conn.commit()
    logger.info("Auth DB initialised at %s", os.path.abspath(_DB_PATH))


async def create_key(tenant_id: str, org_name: str, scopes: List[str]) -> str:
    """Generate a new API key, store its hash and metadata, and return the raw key."""
    if IS_SQLITE:
        return await asyncio.to_thread(_sqlite_create_key, tenant_id, org_name, scopes)
    return await _pg_create_key(tenant_id, org_name, scopes)


async def lookup_key(raw_key: str) -> Optional[Dict[str, Any]]:
    """Look up tenant metadata by raw API key.  Returns None if not found."""
    if IS_SQLITE:
        return await asyncio.to_thread(_sqlite_lookup_key, raw_key)
    return await _pg_lookup_key(raw_key)


async def count_tenant_keys(tenant_id: str) -> int:
    """Return the number of API keys registered for *tenant_id*.

    Used by the BillingMiddleware to enforce purchased seat limits without
    opening a raw database connection from outside the store layer.
    """
    if IS_SQLITE:
        return await asyncio.to_thread(_sqlite_count_tenant_keys, tenant_id)
    return await _pg_count_tenant_keys(tenant_id)
