"""
PostgreSQL migration runner.

Scans ``core-api/migrations/*.sql`` in lexicographic order and applies any
file that has not yet been recorded in the ``_migrations`` tracking table.

In SQLite mode this is a no-op — each store's ``init_db()`` manages its own
schema via stdlib sqlite3.
"""

import logging
from pathlib import Path

logger = logging.getLogger("deploymantis.db.migrate")

# Migrations directory is two levels above this file: core-api/migrations/
MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


async def run_migrations() -> None:
    """Apply all pending SQL migration files to PostgreSQL.

    No-op when ``IS_SQLITE`` is True.  Safe to call multiple times (idempotent).
    """
    from db.connection import IS_SQLITE, get_pool  # local import to avoid circular refs

    if IS_SQLITE:
        logger.info("SQLite mode — skipping PostgreSQL migrations")
        return

    if not MIGRATIONS_DIR.is_dir():
        logger.warning("Migrations directory not found: %s", MIGRATIONS_DIR)
        return

    pool = get_pool()
    async with pool.acquire() as conn:
        # Ensure the migration tracking table exists
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS _migrations (
                id          SERIAL PRIMARY KEY,
                filename    TEXT UNIQUE NOT NULL,
                applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )

        for sql_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
            filename = sql_file.name
            already_applied = await conn.fetchval(
                "SELECT 1 FROM _migrations WHERE filename = $1", filename
            )
            if already_applied:
                logger.info("Migration %s already applied — skipping", filename)
                continue

            sql = sql_file.read_text(encoding="utf-8")
            await conn.execute(sql)
            await conn.execute(
                "INSERT INTO _migrations (filename) VALUES ($1)", filename
            )
            logger.info("Applied migration: %s", filename)
