"""
Aegis Reliability Suite — BYOD Ingestion Router
=================================================
POST /api/v1/ingest/custom-trace

Accepts an array of custom JSON logs or LLM traces from a developer's
external system, normalizes them into the standard Aegis frame structure,
and pushes them into the Strata TemporalScrubber buffer so they appear
in the Aegis Dashboard timeline.
"""

import os
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("aegis.ingest")

router = APIRouter()

STRATA_URL = os.getenv("STRATA_URL", "http://strata:3000")


# ── Request / Response Models ────────────────────────────────

class CustomTrace(BaseModel):
    """
    A single trace or log entry from an external system.

    The only required field is `message`.  Everything else is
    auto-populated if omitted, using sensible defaults.
    """
    timestamp: Optional[str] = Field(
        None,
        description="ISO-8601 timestamp.  Defaults to now.",
    )
    service: Optional[str] = Field(
        "external",
        description="Originating service name.",
    )
    level: Optional[str] = Field(
        "info",
        description="Log level: debug | info | warn | error.",
    )
    message: str = Field(
        ...,
        description="The primary log or trace message.",
    )
    method: Optional[str] = Field(
        "TRACE",
        description="HTTP method or custom verb.",
    )
    path: Optional[str] = Field(
        "/external",
        description="URL path or trace identifier.",
    )
    status: Optional[int] = Field(
        200,
        description="Status code.  Use >= 500 for errors.",
    )
    responseTime: Optional[float] = Field(
        0.0,
        description="Response time in ms.",
    )
    headers: Optional[dict] = Field(
        None,
        description="HTTP headers.",
    )
    body: Optional[dict] = Field(
        None,
        description="Request body payload.",
    )
    meta: Optional[dict] = Field(
        None,
        description="Arbitrary metadata bag (model name, token count, etc.).",
    )


class IngestRequest(BaseModel):
    """Wraps an array of custom traces."""
    traces: list[CustomTrace] = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Array of custom traces to ingest (max 500).",
    )


class IngestResponse(BaseModel):
    ingested: int
    failed: int
    frame_ids: list[str]


# ── Helpers ───────────────────────────────────────────────────

def _normalize_level(level: str) -> str:
    """Clamp to the four levels Aegis understands."""
    level = level.strip().lower()
    if level in ("debug", "info", "warn", "warning", "error", "fatal", "critical"):
        if level in ("warning", "fatal", "critical"):
            return "error"
        return level
    return "info"


def _infer_error_code(status: int, path: str) -> str:
    """Mirror the Strata error-code inference logic."""
    if status >= 500:
        return "HTTP_500"
    if status == 404:
        return "HTTP_404"
    if status == 403:
        return "HTTP_403"
    if status == 401:
        return "HTTP_401"
    return "EXTERNAL_TRACE"


def _to_aegis_frame(trace: CustomTrace) -> dict:
    """
    Convert a CustomTrace into the canonical Aegis frame shape
    expected by the TemporalDebugger / Strata buffer.
    """
    ts = trace.timestamp or datetime.now(timezone.utc).isoformat()
    frame_id = f"byod-{uuid.uuid4().hex[:12]}-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
    level = _normalize_level(trace.level or "info")
    status_code = trace.status or 200
    response_time = trace.responseTime or 0.0
    path = trace.path or "/external"
    method = trace.method or "TRACE"
    service = trace.service or "external"

    frame = {
        "id":             frame_id,
        "timestamp":      ts,
        "service":        service,
        "url":            path,
        "status":         status_code,
        "responseTime":   response_time,
        "level":          level,
        "message":        f"[BYOD] {trace.message}",
        "errorCode":      _infer_error_code(status_code, path),
        "method":         method,
        "path":           path,
        "statusCode":     status_code,
        "responseTimeMs": response_time,
        "latencyMs":      response_time,
        "clientIp":       "byod-ingest",
        "source":         "byod",
    }

    if trace.headers is not None:
        frame["headers"] = trace.headers
    if trace.body is not None:
        frame["body"] = trace.body

    # Attach arbitrary metadata if present
    if trace.meta:
        frame["meta"] = trace.meta

    return frame


# ── Endpoint ──────────────────────────────────────────────────

@router.post(
    "/custom-trace",
    response_model=IngestResponse,
    summary="Ingest custom traces from external systems",
    description=(
        "Accepts an array of custom JSON logs or LLM traces, "
        "normalises them into Aegis frames, and pushes them "
        "into the Strata TemporalScrubber buffer."
    ),
)
async def ingest_custom_traces(payload: IngestRequest):
    """
    BYOD ingestion endpoint.

    1. Validate & normalise each trace into an Aegis frame.
    2. POST each frame to Strata's internal log-append API.
    3. Return a summary of what was ingested.
    """
    frames: list[dict] = []
    failed = 0

    for trace in payload.traces:
        try:
            frame = _to_aegis_frame(trace)
            frames.append(frame)
        except Exception as exc:
            logger.warning("Failed to normalise trace: %s — %s", trace.message[:80], exc)
            failed += 1

    # Push frames into Strata's TemporalScrubber via its internal API.
    # Strata does not have a dedicated "push" endpoint, so we POST
    # individual log entries to /api/logs (which mirrors temporalDebugger.push).
    # If Strata adds a batch endpoint in the future, switch to that.
    ingested_ids: list[str] = []

    async with httpx.AsyncClient(timeout=10.0) as client:
        for frame in frames:
            try:
                resp = await client.post(
                    f"{STRATA_URL}/api/logs",
                    json=frame,
                )
                if resp.status_code in (200, 201, 204):
                    ingested_ids.append(frame["id"])
                else:
                    logger.warning(
                        "Strata rejected frame %s — HTTP %d",
                        frame["id"], resp.status_code,
                    )
                    failed += 1
            except Exception as exc:
                logger.error("Strata push error for %s: %s", frame["id"], exc)
                failed += 1

    logger.info(
        "BYOD ingest complete: %d ingested, %d failed",
        len(ingested_ids), failed,
    )

    return IngestResponse(
        ingested=len(ingested_ids),
        failed=failed,
        frame_ids=ingested_ids,
    )
