-- DeployMantis – initial PostgreSQL schema
-- Applied once by core-api/db/migrate.py
-- All tables use TEXT for timestamps (ISO-8601 strings) to match the existing
-- SQLite data model so both modes stay compatible at the serialisation level.

-- ── Auth ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_keys (
    tenant_id   TEXT PRIMARY KEY,
    key_hash    TEXT UNIQUE NOT NULL,
    scopes      TEXT NOT NULL,         -- JSON array serialised as a string
    org_name    TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

-- ── Billing ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_billing (
    tenant_id               TEXT PRIMARY KEY,
    stripe_customer_id      TEXT,
    stripe_subscription_id  TEXT,
    plan                    TEXT NOT NULL,
    status                  TEXT,
    seats_purchased         INTEGER DEFAULT 1,
    current_period_end      TEXT
);

-- ── MantisSnap ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mantis_snap (
    id            SERIAL PRIMARY KEY,
    branch        TEXT NOT NULL,
    captured_at   TEXT NOT NULL,       -- ISO-8601 UTC
    snapshot_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mantis_snap_branch_time
    ON mantis_snap (branch, captured_at DESC);

-- ── MantisLaunch ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mantis_launch_snapshots (
    id            SERIAL PRIMARY KEY,
    snapshot_hash TEXT UNIQUE NOT NULL, -- SHA-256 of snapshot metadata
    captured_at   TEXT NOT NULL,        -- ISO-8601 UTC
    snapshot_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mantis_launch_snapshots_hash
    ON mantis_launch_snapshots (snapshot_hash);
