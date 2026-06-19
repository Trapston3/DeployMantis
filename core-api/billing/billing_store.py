"""
Billing store — dual-mode: asyncpg (PostgreSQL) or stdlib sqlite3.

Mode is controlled by ``IS_SQLITE`` in ``db.connection``:
  IS_SQLITE=true  → public async functions delegate to synchronous sqlite3
                    helpers wrapped in asyncio.to_thread().
  IS_SQLITE=false → public async functions use the asyncpg pool directly.

Public API (all async except init_db):
  init_db()                                      → sync, idempotent
  upsert_billing(...)                            → async None
  get_billing(tenant_id)                         → async Optional[Dict]
  get_billing_by_subscription(sub_id, cust_id)   → async Optional[Dict]  [new]
"""

import asyncio
import logging
import os
import sqlite3
from typing import Any, Dict, Optional

from db.connection import IS_SQLITE, get_pool

logger = logging.getLogger("deploymantis.billing.store")

# ── SQLite path (used only when IS_SQLITE=true) ───────────────────────────────
_DB_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
_DB_PATH = os.path.join(_DB_DIR, "org_billing.db")


# ── Internal SQLite helpers ───────────────────────────────────────────────────

def _connect() -> sqlite3.Connection:
    """Return a WAL-mode SQLite connection (SQLite mode only)."""
    os.makedirs(_DB_DIR, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


# ── Synchronous SQLite implementations (executed inside asyncio.to_thread) ────

def _sqlite_upsert_billing(
    tenant_id: str,
    stripe_customer_id: Optional[str],
    stripe_subscription_id: Optional[str],
    plan: str,
    status: Optional[str],
    seats_purchased: int,
    current_period_end: Optional[str],
) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO org_billing (
                tenant_id, stripe_customer_id, stripe_subscription_id,
                plan, status, seats_purchased, current_period_end
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tenant_id) DO UPDATE SET
                stripe_customer_id     = excluded.stripe_customer_id,
                stripe_subscription_id = excluded.stripe_subscription_id,
                plan                   = excluded.plan,
                status                 = excluded.status,
                seats_purchased        = excluded.seats_purchased,
                current_period_end     = excluded.current_period_end
            """,
            (
                tenant_id, stripe_customer_id, stripe_subscription_id,
                plan, status, seats_purchased, current_period_end,
            ),
        )
        conn.commit()
    logger.info(
        "Billing: Upserted tenant_id=%s with plan=%s status=%s", tenant_id, plan, status
    )


def _sqlite_get_billing(tenant_id: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            """
            SELECT tenant_id, stripe_customer_id, stripe_subscription_id,
                   plan, status, seats_purchased, current_period_end
            FROM org_billing
            WHERE tenant_id = ?
            LIMIT 1
            """,
            (tenant_id,),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return dict(row)


def _sqlite_get_billing_by_subscription(
    subscription_id: str, customer_id: str
) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            """
            SELECT tenant_id, stripe_customer_id, stripe_subscription_id,
                   plan, status, seats_purchased, current_period_end
            FROM org_billing
            WHERE stripe_subscription_id = ? OR stripe_customer_id = ?
            LIMIT 1
            """,
            (subscription_id, customer_id),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return dict(row)


# ── PostgreSQL implementations ────────────────────────────────────────────────

async def _pg_upsert_billing(
    tenant_id: str,
    stripe_customer_id: Optional[str],
    stripe_subscription_id: Optional[str],
    plan: str,
    status: Optional[str],
    seats_purchased: int,
    current_period_end: Optional[str],
) -> None:
    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO org_billing (
                tenant_id, stripe_customer_id, stripe_subscription_id,
                plan, status, seats_purchased, current_period_end
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (tenant_id) DO UPDATE SET
                stripe_customer_id     = EXCLUDED.stripe_customer_id,
                stripe_subscription_id = EXCLUDED.stripe_subscription_id,
                plan                   = EXCLUDED.plan,
                status                 = EXCLUDED.status,
                seats_purchased        = EXCLUDED.seats_purchased,
                current_period_end     = EXCLUDED.current_period_end
            """,
            tenant_id, stripe_customer_id, stripe_subscription_id,
            plan, status, seats_purchased, current_period_end,
        )
    logger.info(
        "Billing: Upserted tenant_id=%s with plan=%s status=%s", tenant_id, plan, status
    )


async def _pg_get_billing(tenant_id: str) -> Optional[Dict[str, Any]]:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT tenant_id, stripe_customer_id, stripe_subscription_id,
                   plan, status, seats_purchased, current_period_end
            FROM org_billing
            WHERE tenant_id = $1
            LIMIT 1
            """,
            tenant_id,
        )
    if row is None:
        return None
    return dict(row)


async def _pg_get_billing_by_subscription(
    subscription_id: str, customer_id: str
) -> Optional[Dict[str, Any]]:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT tenant_id, stripe_customer_id, stripe_subscription_id,
                   plan, status, seats_purchased, current_period_end
            FROM org_billing
            WHERE stripe_subscription_id = $1 OR stripe_customer_id = $2
            LIMIT 1
            """,
            subscription_id, customer_id,
        )
    if row is None:
        return None
    return dict(row)


# ── Public API ────────────────────────────────────────────────────────────────

def init_db() -> None:
    """Create the org_billing table if it does not yet exist.

    No-op in PostgreSQL mode — ``migrate.py`` handles schema creation.
    Synchronous so it can be called safely at module level or from a
    synchronous startup hook.
    """
    if not IS_SQLITE:
        return
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS org_billing (
                tenant_id               TEXT PRIMARY KEY,
                stripe_customer_id      TEXT,
                stripe_subscription_id  TEXT,
                plan                    TEXT NOT NULL,
                status                  TEXT,
                seats_purchased         INTEGER DEFAULT 1,
                current_period_end      TEXT
            )
            """
        )
        conn.commit()
    logger.info("Billing DB initialised at %s", os.path.abspath(_DB_PATH))


async def upsert_billing(
    tenant_id: str,
    stripe_customer_id: Optional[str],
    stripe_subscription_id: Optional[str],
    plan: str,
    status: Optional[str],
    seats_purchased: int,
    current_period_end: Optional[str],
) -> None:
    """Insert or update billing status for a tenant (idempotent)."""
    if IS_SQLITE:
        await asyncio.to_thread(
            _sqlite_upsert_billing,
            tenant_id, stripe_customer_id, stripe_subscription_id,
            plan, status, seats_purchased, current_period_end,
        )
    else:
        await _pg_upsert_billing(
            tenant_id, stripe_customer_id, stripe_subscription_id,
            plan, status, seats_purchased, current_period_end,
        )


async def get_billing(tenant_id: str) -> Optional[Dict[str, Any]]:
    """Get billing details for a specific tenant.  Returns None if not found."""
    if IS_SQLITE:
        return await asyncio.to_thread(_sqlite_get_billing, tenant_id)
    return await _pg_get_billing(tenant_id)


async def get_billing_by_subscription(
    subscription_id: str, customer_id: str
) -> Optional[Dict[str, Any]]:
    """Look up a billing record by Stripe subscription ID or customer ID.

    Used by the webhook handler to resolve ``tenant_id`` when the subscription
    event metadata does not include it directly.  Replaces the raw
    ``billing_store._connect()`` call that previously existed in the billing
    router's webhook handler.
    """
    if IS_SQLITE:
        return await asyncio.to_thread(
            _sqlite_get_billing_by_subscription, subscription_id, customer_id
        )
    return await _pg_get_billing_by_subscription(subscription_id, customer_id)
