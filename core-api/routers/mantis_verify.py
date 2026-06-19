"""
MantisVerify Router — AI Code Quality Gate
==========================================
Mounted at: /api/v1/mantis-verify  (registered in core-api/main.py)

Endpoint
--------
POST /api/v1/mantis-verify

Responsibilities
----------------
1. Validate the incoming diff payload (Pydantic).
2. Proxy the diff to mantis-graph POST /verify with a tight timeout.
3. Compute a PASS / WARN / FAIL verdict from the returned numeric signals.
4. Build a human-readable `reasons` array from signal values.
5. Return the unified verdict object to the caller.

Verdict rules
-------------
PASS  → convention_match >= 0.80 AND risk_score <= 0.30
FAIL  → risk_score >= 0.70  OR  convention_match <= 0.40
WARN  → everything else (moderate risk, partial convention adherence, etc.)

Timeout behaviour
-----------------
If mantis-graph does not respond within _GRAPH_TIMEOUT seconds the router
returns WARN with a single reason explaining the timeout — the caller always
gets a usable response.
"""

import os
import logging
import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List

logger = logging.getLogger("deploymantis.mantis_verify")

router = APIRouter()

# ── Configuration ──────────────────────────────────────────────
_GRAPH_URLS: List[str] = [
    os.getenv("MANTIS_GRAPH_URL", "http://mantis-graph:5003"),
    "http://localhost:5003",
]
_GRAPH_TIMEOUT: float = float(os.getenv("MANTIS_VERIFY_TIMEOUT", "8.0"))

# ── Verdict thresholds ────────────────────────────────────────
_PASS_CONVENTION = 0.80
_FAIL_CONVENTION = 0.40
_WARN_RISK       = 0.40
_FAIL_RISK       = 0.70


# ── Pydantic models ───────────────────────────────────────────

class VerifyRequest(BaseModel):
    """Payload sent by UI, agents, or CLI to request a code quality verdict."""
    diff: str
    files: Optional[List[str]] = []
    language: Optional[str] = "python"
    agent_id: Optional[str] = None


class SignalsModel(BaseModel):
    convention_match: float
    reuse_score: float
    risk_score: float


class VerdictResponse(BaseModel):
    status: str                 # "PASS" | "WARN" | "FAIL"
    reasons: List[str]
    signals: SignalsModel
    notes: List[str]


# ── Verdict computation ───────────────────────────────────────

def _compute_verdict(
    convention_match: float,
    reuse_score: float,
    risk_score: float,
    notes: List[str],
    agent_id: Optional[str],
) -> VerdictResponse:
    """
    Derive a PASS/WARN/FAIL verdict and a human-readable reasons list
    from the raw numeric signals returned by mantis-graph.
    """
    reasons: List[str] = []

    # ── Convention feedback ───────────────────────────────────
    if convention_match < _FAIL_CONVENTION:
        reasons.append(
            f"Naming conventions badly broken: new identifiers match existing "
            f"patterns at only {convention_match:.0%}. Review function/class names."
        )
    elif convention_match < _PASS_CONVENTION:
        reasons.append(
            f"Partial convention adherence ({convention_match:.0%}). "
            "Some new identifiers deviate from established naming patterns."
        )
    else:
        reasons.append(f"Naming conventions consistent with codebase ({convention_match:.0%} match).")

    # ── Reuse feedback ────────────────────────────────────────
    if reuse_score < 0.40:
        reasons.append(
            f"Low helper reuse ({reuse_score:.0%}). "
            "New code may be duplicating logic instead of calling existing utilities."
        )
    elif reuse_score >= 0.70:
        reasons.append(f"Good reuse of existing helpers ({reuse_score:.0%}).")

    # ── Risk feedback ─────────────────────────────────────────
    if risk_score >= _FAIL_RISK:
        reasons.append(
            f"High risk score ({risk_score:.0%}): diff touches auth/vault/network/DB layers. "
            "Manual security review required."
        )
    elif risk_score >= _WARN_RISK:
        reasons.append(
            f"Moderate risk ({risk_score:.0%}): diff interacts with sensitive modules. "
            "Verify error handling and secret hygiene."
        )
    else:
        reasons.append(f"Low risk profile ({risk_score:.0%}) — no sensitive modules detected.")

    # ── Compute status ────────────────────────────────────────
    if risk_score >= _FAIL_RISK or convention_match <= _FAIL_CONVENTION:
        status = "FAIL"
    elif risk_score >= _WARN_RISK or convention_match < _PASS_CONVENTION:
        status = "WARN"
    else:
        status = "PASS"

    return VerdictResponse(
        status=status,
        reasons=reasons,
        signals=SignalsModel(
            convention_match=round(convention_match, 4),
            reuse_score=round(reuse_score, 4),
            risk_score=round(risk_score, 4),
        ),
        notes=notes,
    )


# ── HTTP helper ───────────────────────────────────────────────

async def _call_graph_verify(payload: dict) -> dict:
    """
    POST to mantis-graph /verify, trying the Docker URL first and the
    localhost fallback second.  Raises httpx.TimeoutException on timeout.
    """
    last_exc: Exception | None = None
    for base_url in _GRAPH_URLS:
        try:
            async with httpx.AsyncClient(timeout=_GRAPH_TIMEOUT) as client:
                resp = await client.post(f"{base_url}/verify", json=payload)
                resp.raise_for_status()
                return resp.json()
        except httpx.ConnectError as exc:
            last_exc = exc
            continue          # try next URL
        except httpx.TimeoutException:
            raise             # let caller handle timeout specifically
        except Exception as exc:
            last_exc = exc
            continue

    raise last_exc or RuntimeError("mantis-graph unreachable")


# ── Endpoint ──────────────────────────────────────────────────

@router.post("", status_code=200)
async def verify(body: VerifyRequest):
    """
    MantisVerify — AI code quality gate.

    Accepts a unified diff and optional metadata, calls mantis-graph for raw
    signal analysis, and returns a structured PASS/WARN/FAIL verdict with
    human-readable reasons.

    Always returns a usable response — timeouts and graph failures degrade
    to WARN rather than 5xx.
    """
    graph_payload = {
        "diff":     body.diff,
        "files":    body.files or [],
        "language": body.language or "python",
        "agent_id": body.agent_id,
    }

    # ── Call mantis-graph ─────────────────────────────────────
    try:
        graph_result = await _call_graph_verify(graph_payload)
    except httpx.TimeoutException:
        logger.warning(
            "MantisVerify: mantis-graph timed out after %.1fs (agent=%s)",
            _GRAPH_TIMEOUT,
            body.agent_id or "unknown",
        )
        timeout_verdict = VerdictResponse(
            status="WARN",
            reasons=[
                f"MantisVerify timed out ({_GRAPH_TIMEOUT}s); unable to compute full signals. "
                "Treat this diff with manual caution."
            ],
            signals=SignalsModel(convention_match=0.5, reuse_score=0.5, risk_score=0.5),
            notes=["mantis-graph did not respond within the timeout window."],
        )
        return JSONResponse(content=timeout_verdict.model_dump(), status_code=200)
    except Exception as exc:
        logger.error(
            "MantisVerify: mantis-graph unreachable (agent=%s): %s",
            body.agent_id or "unknown",
            exc,
        )
        error_verdict = VerdictResponse(
            status="WARN",
            reasons=[
                "MantisVerify could not reach the graph analysis service. "
                "Diff has not been analysed — review manually."
            ],
            signals=SignalsModel(convention_match=0.5, reuse_score=0.5, risk_score=0.5),
            notes=[f"mantis-graph error: {exc}"],
        )
        return JSONResponse(content=error_verdict.model_dump(), status_code=200)

    # ── Extract signals ───────────────────────────────────────
    convention_match: float = float(graph_result.get("convention_match", 0.75))
    reuse_score:      float = float(graph_result.get("reuse_score",      0.65))
    risk_score:       float = float(graph_result.get("risk_score",        0.0))
    notes:            list  = graph_result.get("notes", [])

    # ── Compute verdict ───────────────────────────────────────
    verdict = _compute_verdict(
        convention_match=convention_match,
        reuse_score=reuse_score,
        risk_score=risk_score,
        notes=notes,
        agent_id=body.agent_id,
    )

    # ── Structured log (one line per verification) ────────────
    logger.info(
        "MantisVerify: agent=%s status=%s cv=%.2f reuse=%.2f risk=%.2f files=%s",
        body.agent_id or "unknown",
        verdict.status,
        convention_match,
        reuse_score,
        risk_score,
        graph_result.get("files_analyzed", []),
    )

    return JSONResponse(content=verdict.model_dump(), status_code=200)
