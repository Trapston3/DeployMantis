"""
asyncpg connection pool singleton.

IS_SQLITE resolution (evaluated once at import time):
  1. If IS_SQLITE env var is explicitly set → use that value ("true"/"false").
  2. Otherwise: default to True when DATABASE_URL is absent, False when it is present.

Usage:
  from db.connection import IS_SQLITE, get_pool, init_pool, close_pool

  # application startup
  await init_pool()

  # inside any async store function (PG mode only)
  async with get_pool().acquire() as conn:
      row = await conn.fetchrow(...)

  # application shutdown
  await close_pool()
"""

import logging
import os
from typing import Optional

import asyncpg

logger = logging.getLogger("deploymantis.db.connection")

# ── Mode determination (evaluated once at import time) ────────────────────────
_explicit = os.getenv("IS_SQLITE")
if _explicit is not None:
    IS_SQLITE: bool = _explicit.strip().lower() == "true"
else:
    # No explicit flag → fall back to SQLite when DATABASE_URL is absent
    IS_SQLITE = not bool(os.getenv("DATABASE_URL"))

# ── Pool singleton ────────────────────────────────────────────────────────────
_pool: Optional[asyncpg.Pool] = None


async def init_pool() -> None:
    """Initialise the asyncpg connection pool.  No-op in SQLite mode."""
    global _pool
    if IS_SQLITE:
        logger.info("IS_SQLITE=true — skipping asyncpg pool, using SQLite fallback")
        return
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError(
            "DATABASE_URL must be set in the environment when IS_SQLITE is false."
        )
    _pool = await asyncpg.create_pool(
        dsn=database_url,
        min_size=2,
        max_size=10,
        command_timeout=30,
    )
    # Log only the host:port/dbname portion — never log credentials
    safe_url = database_url.split("@")[-1] if "@" in database_url else database_url
    logger.info("asyncpg pool initialised → %s", safe_url)


async def close_pool() -> None:
    """Close the pool gracefully.  No-op in SQLite mode or if never initialised."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("asyncpg pool closed")


def get_pool() -> asyncpg.Pool:
    """Return the active pool.

    Raises:
        RuntimeError: if called before ``init_pool()`` completes.
    """
    if _pool is None:
        raise RuntimeError(
            "asyncpg pool is not initialised. "
            "Ensure init_pool() was awaited during application startup."
        )
    return _pool
