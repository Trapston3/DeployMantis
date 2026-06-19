"""
MantisGuard Router — Unified Safety Gate
=========================================
Mounted at: /api/v1/mantis-guard  (registered in core-api/main.py)

Endpoint
--------
POST /api/v1/mantis-guard

What it does
------------
In a single API call, MantisGuard answers: "Can I safely apply this AI output?"

1. Sends content to vault-guard POST /scan for secret detection.
2. If a diff is present, sends it to mantis-graph POST /verify for code
   quality signals (reuse via the already-implemented MantisVerify path).
3. Aggregates findings into one SAFE / REVIEW / BLOCKED verdict with
   human-readable reasons and structured trust signals.

Both external calls run in parallel via asyncio.gather so the added latency
is max(vault_guard_latency, verify_latency) rather than their sum.

Verdict rules
-------------
BLOCKED → any finding of kind in {api_key, cloud_key, connection_string, token}
REVIEW  → any generic_high_entropy finding
          OR risk_score >= 0.70 (from MantisVerify)
          OR secret scan was unavailable (zero-trust default)
SAFE    → no secret findings AND risk_score <= 0.30 AND convention_match >= 0.80

When in doubt, REVIEW is preferred over SAFE.

Degradation
-----------
Vault-guard unreachable → REVIEW (cannot confirm safety)
Mantis-graph unreachable → trust_signals set to neutral 0.5 values
Both unreachable → REVIEW with compound reason
"""

import os
import asyncio
import logging
import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Any

logger = logging.getLogger("deploymantis.mantis_guard")

router = APIRouter()

# ── Service URLs ───────────────────────────────────────────────
_VAULT_URLS: List[str] = [
    os.getenv("VAULT_GUARD_URL", "http://vault-guard:5001"),
    "http://localhost:5001",
]
_GRAPH_URLS: List[str] = [
    os.getenv("MANTIS_GRAPH_URL", "http://mantis-graph:5003"),
    "http://localhost:5003",
]

# Reuse the same timeout used by MantisVerify
_SCAN_TIMEOUT:   float = float(os.getenv("MANTIS_GUARD_SCAN_TIMEOUT",   "6.0"))
_VERIFY_TIMEOUT: float = float(os.getenv("MANTIS_GUARD_VERIFY_TIMEOUT", "8.0"))

# ── Finding kinds that trigger an instant BLOCKED ──────────────
_BLOCKING_KINDS: frozenset[str] = frozenset({
    "api_key", "cloud_key", "connection_string", "token",
})
_REVIEW_KINDS: frozenset[str] = frozenset({
    "generic_high_entropy",
})

# ── Verdict thresholds (mirrors mantis_verify.py) ─────────────
_SAFE_MAX_RISK        = 0.30
_SAFE_MIN_CONVENTION  = 0.80
_REVIEW_MIN_RISK      = 0.70


# ── Pydantic models ───────────────────────────────────────────

class MantisGuardRequest(BaseModel):
    content:  str
    diff:     Optional[str] = None
    language: Optional[str] = None
    agent_id: Optional[str] = None
    context:  Optional[str] = "code"   # "code" | "logs" | "config"


class TrustSignals(BaseModel):
    convention_match: float = 0.5
    reuse_score:      float = 0.5
    risk_score:       float = 0.5


class SecretFinding(BaseModel):
    kind:     str
    match:    str   # masked — first 4 chars + ***
    location: str
    summary:  str


class GuardVerdict(BaseModel):
    status:          str              # SAFE | REVIEW | BLOCKED
    reasons:         List[str]
    trust_signals:   TrustSignals
    secret_findings: List[SecretFinding]


# ── HTTP helpers ──────────────────────────────────────────────

async def _call_vault_scan(content: str, context: str) -> dict[str, Any] | None:
    """
    POST to vault-guard /scan with URL fallback.
    Returns the parsed JSON dict, or None on failure.
    """
    payload = {"content": content, "context": context}
    for base_url in _VAULT_URLS:
        try:
            async with httpx.AsyncClient(timeout=_SCAN_TIMEOUT) as client:
                resp = await client.post(f"{base_url}/scan", json=payload)
                resp.raise_for_status()
                return resp.json()
        except httpx.ConnectError:
            continue
        except httpx.TimeoutException:
            logger.warning("MantisGuard: vault-guard /scan timed out after %.1fs", _SCAN_TIMEOUT)
            return None
        except Exception as exc:
            logger.warning("MantisGuard: vault-guard error: %s", exc)
            return None
    logger.warning("MantisGuard: vault-guard unreachable on all URLs")
    return None


async def _call_graph_verify(diff: str, language: str | None, agent_id: str | None) -> dict[str, Any] | None:
    """
    POST to mantis-graph /verify with URL fallback.
    Returns the parsed JSON dict, or None on failure / timeout.
    """
    payload = {
        "diff":     diff,
        "language": language or "python",
        "agent_id": agent_id,
    }
    for base_url in _GRAPH_URLS:
        try:
            async with httpx.AsyncClient(timeout=_VERIFY_TIMEOUT) as client:
                resp = await client.post(f"{base_url}/verify", json=payload)
                resp.raise_for_status()
                return resp.json()
        except httpx.ConnectError:
            continue
        except httpx.TimeoutException:
            logger.warning("MantisGuard: mantis-graph /verify timed out after %.1fs", _VERIFY_TIMEOUT)
            return None
        except Exception as exc:
            logger.warning("MantisGuard: mantis-graph error: %s", exc)
            return None
    return None


# ── Verdict engine ────────────────────────────────────────────

def _build_verdict(
    scan_result:   dict[str, Any] | None,
    verify_result: dict[str, Any] | None,
    has_diff:      bool,
    agent_id:      str | None,
) -> GuardVerdict:
    """
    Aggregate scan + verify results into a single SAFE/REVIEW/BLOCKED verdict.

    Parameters:
        scan_result:   vault-guard /scan response dict, or None if unavailable.
        verify_result: mantis-graph /verify response dict, or None if unavailable.
        has_diff:      whether the request included a diff (affects completeness).
        agent_id:      for logging purposes only.
    """
    reasons: List[str] = []
    secret_findings: List[SecretFinding] = []

    # ── 1. Process secret scan results ───────────────────────
    scan_unavailable = scan_result is None
    if scan_unavailable:
        reasons.append(
            "Secret scan unavailable (vault-guard unreachable); "
            "unable to confirm absence of embedded credentials."
        )
    else:
        raw_findings: list[dict] = scan_result.get("findings", [])
        for f in raw_findings:
            secret_findings.append(SecretFinding(
                kind=f.get("kind", "unknown"),
                match=f.get("match", "****"),
                location=f.get("location", "unknown"),
                summary=f.get("summary", ""),
            ))

        if not raw_findings:
            reasons.append("No secret patterns detected in content.")

        for f in secret_findings:
            if f.kind in _BLOCKING_KINDS:
                reasons.append(
                    f"Detected potential {f.kind.replace('_', ' ')} at {f.location} "
                    f"({f.match}). Transmission blocked."
                )
            elif f.kind in _REVIEW_KINDS:
                reasons.append(
                    f"High-entropy token at {f.location} — may be an unrecognised secret. "
                    "Manual review required."
                )

    # ── 2. Process code quality signals ──────────────────────
    verify_unavailable = verify_result is None
    convention_match = 0.5
    reuse_score      = 0.5
    risk_score       = 0.5

    if has_diff:
        if verify_unavailable:
            reasons.append(
                "Code quality analysis unavailable (mantis-graph unreachable); "
                "trust signals set to neutral."
            )
        else:
            convention_match = float(verify_result.get("convention_match", 0.5))
            reuse_score      = float(verify_result.get("reuse_score",      0.5))
            risk_score       = float(verify_result.get("risk_score",        0.5))

            if risk_score >= _REVIEW_MIN_RISK:
                reasons.append(
                    f"Risk score {risk_score:.0%} — diff touches sensitive modules "
                    "(auth/vault/network/DB). Manual review required."
                )
            elif risk_score > _SAFE_MAX_RISK:
                reasons.append(
                    f"Moderate risk score ({risk_score:.0%}). "
                    "Verify error handling and secret hygiene."
                )
            else:
                reasons.append(f"Risk profile acceptable ({risk_score:.0%}).")

            if convention_match < _SAFE_MIN_CONVENTION:
                reasons.append(
                    f"Naming convention adherence at {convention_match:.0%} — "
                    "some identifiers deviate from established patterns."
                )
            else:
                reasons.append(f"Naming conventions consistent ({convention_match:.0%} match).")
    else:
        # No diff provided — we can't run code quality analysis
        reasons.append("No diff provided; code quality signals not computed.")
        # In code context without a diff, stay at neutral scores
        if scan_unavailable:
            # Both unavailable — worst degradation case
            pass
        else:
            risk_score = 0.0  # no diff means no code risk signal

    # ── 3. Compute final status ───────────────────────────────
    has_blocking = any(f.kind in _BLOCKING_KINDS for f in secret_findings)
    has_review   = any(f.kind in _REVIEW_KINDS   for f in secret_findings)

    if has_blocking:
        status = "BLOCKED"
    elif scan_unavailable:
        # Zero-trust: cannot prove safe without a scan
        status = "REVIEW"
    elif has_review or risk_score >= _REVIEW_MIN_RISK or verify_unavailable and has_diff:
        status = "REVIEW"
    elif (
        not secret_findings
        and risk_score <= _SAFE_MAX_RISK
        and convention_match >= _SAFE_MIN_CONVENTION
    ):
        status = "SAFE"
        if not reasons or all("not computed" in r or "No diff" in r for r in reasons):
            reasons.append(
                "No secrets detected and risk profile is low; marking response SAFE."
            )
        else:
            reasons.append("All signals within safe thresholds.")
    else:
        # Mixed signals — default to REVIEW (zero-trust preference)
        status = "REVIEW"
        if not any("review" in r.lower() or "caution" in r.lower() for r in reasons):
            reasons.append(
                "Mixed signals from quality analysis; "
                "human review recommended before applying."
            )

    return GuardVerdict(
        status=status,
        reasons=reasons,
        trust_signals=TrustSignals(
            convention_match=round(convention_match, 4),
            reuse_score=round(reuse_score, 4),
            risk_score=round(risk_score, 4),
        ),
        secret_findings=secret_findings,
    )


# ── Endpoint ──────────────────────────────────────────────────

@router.post("", status_code=200)
async def guard(body: MantisGuardRequest):
    """
    MantisGuard — unified AI output safety gate.

    Runs secret scanning and code quality analysis in parallel, then returns
    a single SAFE / REVIEW / BLOCKED verdict with structured evidence.

    Always returns HTTP 200 — service failures degrade to REVIEW, never 5xx.
    """
    # ── Kick off parallel I/O ─────────────────────────────────
    scan_coro   = _call_vault_scan(body.content, body.context or "code")
    verify_coro = (
        _call_graph_verify(body.diff, body.language, body.agent_id)
        if body.diff and body.diff.strip()
        else asyncio.coroutine(lambda: None)()   # immediate no-op coroutine
    )

    scan_result, verify_result = await asyncio.gather(
        scan_coro,
        verify_coro,
        return_exceptions=False,   # each helper already swallows its own errors
    )

    has_diff = bool(body.diff and body.diff.strip())

    # ── Aggregate into a verdict ──────────────────────────────
    verdict = _build_verdict(
        scan_result=scan_result,
        verify_result=verify_result,
        has_diff=has_diff,
        agent_id=body.agent_id,
    )

    # ── One structured log line — no raw content ever logged ──
    logger.info(
        "MantisGuard: agent=%s ctx=%s status=%s secrets=%d risk=%.2f cv=%.2f",
        body.agent_id or "unknown",
        body.context or "code",
        verdict.status,
        len(verdict.secret_findings),
        verdict.trust_signals.risk_score,
        verdict.trust_signals.convention_match,
    )

    return JSONResponse(content=verdict.model_dump(), status_code=200)
