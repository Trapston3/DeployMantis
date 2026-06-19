"""
MantisSnap Router — Context Time Machine
=========================================
Mounted at: /api/v1/mantis-snap  (registered in core-api/main.py)

Endpoints
---------
POST /api/v1/mantis-snap/capture
    Captures current branch context (git state + recent Strata frames) and
    writes it to the MantisSnap SQLite store.

GET  /api/v1/mantis-snap/{branch}
    Returns the latest snapshot for a branch plus derived todo_hints.
    Pure DB read — no git or Strata calls on the hot path.

Design choices
--------------
* Git is invoked via asyncio.create_subprocess_exec to avoid blocking the
  event loop.  If git is not available or not inside a repo, fields degrade
  gracefully to None / [].
* Strata is reached at the existing internal URL; failures are swallowed.
* All external I/O is wrapped in try/except so a single unavailable
  dependency never breaks the endpoint.
* SQLite is written via the synchronous stdlib driver inside
  asyncio.to_thread to keep the event loop unblocked.
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from db.mantis_snap_store import get_latest_snapshot, init_db, insert_snapshot

logger = logging.getLogger("deploymantis.mantis_snap")

router = APIRouter()

# ── Configuration ─────────────────────────────────────────────
# Strata internal URL — same pattern used in core-api/main.py
_STRATA_URL = os.getenv("STRATA_URL", "http://strata:3000")
_STRATA_FALLBACK = "http://localhost:3002"

# Maximum Strata frames to embed in a snapshot (keeps JSON lean)
_MAX_STRATA_FRAMES = 20

# Workspace root for git commands — walk up from this file to the repo root
_WORKSPACE = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")
)


# ── Initialise DB on router load ──────────────────────────────
# init_db() is idempotent; the table and index are created only if absent.
init_db()


# ── Pydantic models ───────────────────────────────────────────

class CaptureRequest(BaseModel):
    note: Optional[str] = None
    branch: Optional[str] = None  # override; defaults to current git branch


# ── Git helpers ───────────────────────────────────────────────

async def _run_git(*args: str) -> Optional[str]:
    """Run a git command asynchronously and return stripped stdout, or None on error."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "git",
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            cwd=_WORKSPACE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5.0)
        if proc.returncode == 0:
            return stdout.decode("utf-8", errors="replace").strip()
        return None
    except Exception:
        return None


async def _get_branch() -> Optional[str]:
    """Return the current git branch name, or None if unavailable."""
    return await _run_git("branch", "--show-current")


async def _get_git_summary() -> dict:
    """
    Return a dict with commit, author, message, dirty_files.
    All fields degrade to None / [] if git is unavailable.
    """
    log_line = await _run_git("log", "-1", "--format=%H|%an|%s")
    commit: Optional[str] = None
    author: Optional[str] = None
    message: Optional[str] = None

    if log_line and "|" in log_line:
        parts = log_line.split("|", 2)
        commit = parts[0][:12]  # short hash
        author = parts[1] if len(parts) > 1 else None
        message = parts[2] if len(parts) > 2 else None

    status_out = await _run_git("status", "--short")
    dirty_files: list[str] = []
    if status_out:
        for line in status_out.splitlines():
            line = line.strip()
            if line:
                # "M  path/to/file" → take the rightmost token
                dirty_files.append(line.split()[-1])

    return {
        "commit": commit,
        "author": author,
        "message": message,
        "dirty_files": dirty_files,
    }


# ── Strata helper ─────────────────────────────────────────────

async def _get_strata_highlights() -> list[dict]:
    """
    Fetch the last _MAX_STRATA_FRAMES frames from Strata's debug endpoint.
    Returns a list of small dicts {timestamp, level, message}.
    Swallows all errors — snapshot proceeds with an empty list on failure.
    """
    for base_url in (_STRATA_URL, _STRATA_FALLBACK):
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{base_url}/api/debugger/frames")
                if resp.status_code != 200:
                    continue

                data = resp.json()
                # Strata returns { frames: [...], currentSize: N }
                frames: list[dict] = data.get("frames", [])

                # Take the most recent N frames and keep only key fields
                highlights = []
                for frame in frames[-_MAX_STRATA_FRAMES:]:
                    highlights.append(
                        {
                            "timestamp": frame.get("timestamp"),
                            "level": frame.get("level", "info"),
                            "message": frame.get("message", ""),
                        }
                    )
                return highlights
        except Exception:
            continue  # try fallback, then give up gracefully

    return []


# ── Endpoints ─────────────────────────────────────────────────

@router.post("/capture", status_code=201)
async def capture_snapshot(body: CaptureRequest):
    """
    Capture current branch context into the MantisSnap store.

    Collects git state and recent Strata frames concurrently, writes one
    SQLite row, and returns the snapshot ID + branch + timestamp.

    Latency expectation: ~15–40 ms (git + Strata in parallel, then one DB write).
    """
    # ── 1. Resolve branch ID ──────────────────────────────────
    branch: Optional[str] = body.branch
    if not branch:
        branch = await _get_branch()
    if not branch:
        branch = "unknown"

    # ── 2. Gather context concurrently (git + Strata in parallel) ──
    git_task = asyncio.create_task(_get_git_summary())
    strata_task = asyncio.create_task(_get_strata_highlights())

    git_summary, strata_highlights = await asyncio.gather(git_task, strata_task)

    # ── 3. Build snapshot payload ─────────────────────────────
    captured_at = datetime.now(timezone.utc).isoformat()
    snapshot = {
        "branch": branch,
        "captured_at": captured_at,
        "git_summary": git_summary,
        "strata_highlights": strata_highlights,
        "note": body.note or "",
    }
    snapshot_json = json.dumps(snapshot, ensure_ascii=False)

    # ── 4. Persist to store (async — no blocking I/O in event loop) ──
    snapshot_id = await insert_snapshot(branch, captured_at, snapshot_json)

    logger.info(
        "MantisSnap captured: branch=%s snapshot_id=%d dirty_files=%d strata_frames=%d",
        branch,
        snapshot_id,
        len(git_summary.get("dirty_files", [])),
        len(strata_highlights),
    )

    return JSONResponse(
        content={
            "snapshot_id": snapshot_id,
            "branch": branch,
            "captured_at": captured_at,
        },
        status_code=201,
    )


@router.get("/{branch:path}")
async def get_snapshot_summary(branch: str):
    """
    Return the latest stored snapshot for *branch* with derived todo_hints.

    Hot path constraints:
    - No git subprocess calls.
    - No Strata HTTP calls.
    - One SQLite row read + lightweight JSON processing.

    Latency expectation: ~2–4 ms.
    """
    # ── 1. DB lookup (non-blocking) ───────────────────────────
    row = await get_latest_snapshot(branch)

    if row is None:
        raise HTTPException(
            status_code=404,
            detail=f"No snapshot found for branch '{branch}'",
        )

    # ── 2. Deserialise ────────────────────────────────────────
    try:
        snap = json.loads(row["snapshot_json"])
    except (json.JSONDecodeError, KeyError):
        raise HTTPException(
            status_code=500,
            detail="Snapshot data is corrupted.",
        )

    # ── 3. Derive todo_hints ──────────────────────────────────
    todo_hints: list[str] = []

    git_summary: dict = snap.get("git_summary") or {}
    dirty_files: list[str] = git_summary.get("dirty_files") or []
    for f in dirty_files:
        todo_hints.append(f"Review uncommitted changes in {f}")

    strata_highlights: list[dict] = snap.get("strata_highlights") or []
    for frame in strata_highlights:
        if frame.get("level") in ("error", "warn"):
            msg = frame.get("message", "(no message)")
            ts = frame.get("timestamp", "")
            prefix = "Investigate" if frame.get("level") == "error" else "Check"
            todo_hints.append(f"{prefix}: {msg}" + (f" (at {ts})" if ts else ""))

    # ── 4. Build response ─────────────────────────────────────
    return {
        "branch": snap.get("branch", branch),
        "last_captured": snap.get("captured_at", row.get("captured_at")),
        "git_summary": git_summary,
        "strata_highlights": strata_highlights,
        "note": snap.get("note", ""),
        "todo_hints": todo_hints,
    }
