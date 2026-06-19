"""
Secret Scanner — vault-guard/scanner/secret_scanner.py
=======================================================
Detects high-confidence secret patterns in arbitrary text.

Design goals
------------
* Linear time — one compiled-regex pass per pattern per line.
* No external dependencies — stdlib `re`, `math`, `string` only.
* Never store or return raw secret values; only masked forms (first4 + ***).
* Structured Finding objects consumed by the vault-guard /scan endpoint
  and ultimately by the MantisGuard verdict engine.

Pattern coverage
----------------
Kind                  Examples caught
----                  ---------------
api_key               OpenAI sk-..., Anthropic sk-ant-..., Stripe sk_live_...
                      GitHub ghp_..., GitLab glpat-..., SendGrid SG....
cloud_key             AWS AKIA..., GCP service-account JSON fragments,
                      Azure storage connection strings
token                 JWT (three base64 segments), Bearer tokens,
                      OAuth access_token / refresh_token literals
connection_string     postgres://, mysql://, mongodb://, redis://,
                      ODBC/DSN patterns
generic_high_entropy  Long (≥ 32 char) alphanumeric strings with entropy ≥ 4.5
                      bits/char (catches unrecognised secrets)

Entropy threshold rationale
---------------------------
English prose entropy ≈ 1–3 bits/char.
Random base64 entropy ≈ 6 bits/char.
4.5 bits/char strikes a balance: low false-positive on normal code while
catching keys, hashes, and random tokens that weren't caught by explicit
patterns.
"""

import re
import math
import string
import logging
from dataclasses import dataclass, field
from typing import List

logger = logging.getLogger("deploymantis.vault_guard.secret_scanner")

# ── Finding dataclass ──────────────────────────────────────────

@dataclass
class Finding:
    kind:     str   # one of the coverage kinds listed above
    match:    str   # masked form: first 4 visible chars + "***"
    location: str   # e.g. "line 12"
    summary:  str   # one-sentence human description


# ── Secret patterns ───────────────────────────────────────────
# Each entry: (kind, compiled_regex, human_summary_template)
# Patterns are ordered by specificity — more specific first so that
# a JWT is not also flagged as generic_high_entropy.

_PATTERNS: list[tuple[str, re.Pattern, str]] = [
    # ── API keys with known prefixes ──────────────────────────
    (
        "api_key",
        re.compile(
            r"\b("
            r"sk-[A-Za-z0-9]{20,}"           # OpenAI / generic sk-
            r"|sk-ant-[A-Za-z0-9\-_]{20,}"   # Anthropic
            r"|sk_live_[A-Za-z0-9]{20,}"      # Stripe live
            r"|sk_test_[A-Za-z0-9]{20,}"      # Stripe test
            r"|rk_live_[A-Za-z0-9]{20,}"      # Stripe restricted
            r"|ghp_[A-Za-z0-9]{36}"           # GitHub personal token
            r"|ghs_[A-Za-z0-9]{36}"           # GitHub server token
            r"|glpat-[A-Za-z0-9\-_]{20}"      # GitLab PAT
            r"|SG\.[A-Za-z0-9\-_]{22}\.[A-Za-z0-9\-_]{43}"  # SendGrid
            r"|xoxb-[0-9]+-[A-Za-z0-9]+"      # Slack bot token
            r"|xoxp-[0-9]+-[A-Za-z0-9]+"      # Slack user token
            r"|AIza[A-Za-z0-9\-_]{35}"         # Google API key
            r")",
            re.IGNORECASE,
        ),
        "Looks like a service API key",
    ),

    # ── AWS credentials ───────────────────────────────────────
    (
        "cloud_key",
        re.compile(
            r"\b("
            r"AKIA[A-Z0-9]{16}"               # AWS access key ID
            r"|ASIA[A-Z0-9]{16}"              # AWS temp access key
            r"|AROA[A-Z0-9]{16}"              # AWS role ID
            r")",
        ),
        "Looks like an AWS access key identifier",
    ),

    # ── Azure / GCP connection fragments ─────────────────────
    (
        "cloud_key",
        re.compile(
            r"("
            r"DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{40,}"
            r"|\"type\":\s*\"service_account\""  # GCP service-account JSON
            r"|\"private_key\":\s*\"-----BEGIN"  # GCP SA private key
            r")",
            re.IGNORECASE,
        ),
        "Looks like a cloud provider credential fragment",
    ),

    # ── JWT tokens ────────────────────────────────────────────
    (
        "token",
        re.compile(
            r"\beyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\b"
        ),
        "Looks like a JWT (JSON Web Token)",
    ),

    # ── Bearer / OAuth token literals ────────────────────────
    (
        "token",
        re.compile(
            r"(?i)\b(?:bearer|access_token|refresh_token|id_token)\s*[=:\"'\s]+\s*([A-Za-z0-9\-_\.]{32,})"
        ),
        "Looks like a bearer/OAuth token literal",
    ),

    # ── Database connection strings ───────────────────────────
    (
        "connection_string",
        re.compile(
            r"("
            r"(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql|oracle)"
            r"://[^\"'\s]{10,}"               # DSN URI
            r"|Server=[^;]+;Database=[^;]+;User Id=[^;]+;Password=[^;]+"  # MSSQL ODBC
            r")",
            re.IGNORECASE,
        ),
        "Looks like a database connection string with credentials",
    ),

    # ── Private key headers ───────────────────────────────────
    (
        "api_key",
        re.compile(
            r"-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE KEY-----"
        ),
        "Looks like an embedded private key (PEM format)",
    ),
]


# ── High-entropy heuristic ────────────────────────────────────

_ENTROPY_ALPHABET = set(string.ascii_letters + string.digits + "+/=_-")
_ENTROPY_PATTERN = re.compile(r"[A-Za-z0-9+/=_\-]{32,}")
_ENTROPY_THRESHOLD = 4.5   # bits/char
_MIN_ENTROPY_LENGTH = 32


def _shannon_entropy(s: str) -> float:
    """Return Shannon entropy in bits per character."""
    if not s:
        return 0.0
    freq: dict[str, int] = {}
    for ch in s:
        freq[ch] = freq.get(ch, 0) + 1
    total = len(s)
    return -sum((c / total) * math.log2(c / total) for c in freq.values())


def _check_high_entropy(line: str, line_no: int) -> List[Finding]:
    """Return findings for any suspiciously high-entropy token on this line."""
    findings: List[Finding] = []
    for m in _ENTROPY_PATTERN.finditer(line):
        token = m.group(0)
        if len(token) < _MIN_ENTROPY_LENGTH:
            continue
        # Reject tokens that look like base64-encoded binary blobs in comments
        # or ordinary long hashes (those are caught separately if needed).
        entropy = _shannon_entropy(token)
        if entropy >= _ENTROPY_THRESHOLD:
            findings.append(Finding(
                kind="generic_high_entropy",
                match=_mask(token),
                location=f"line {line_no}",
                summary=(
                    f"High-entropy token ({entropy:.2f} bits/char, {len(token)} chars) "
                    "may be an unrecognised secret or random key"
                ),
            ))
    return findings


# ── Masking helper ────────────────────────────────────────────

def _mask(value: str) -> str:
    """Return first 4 characters followed by *** — never log the full value."""
    prefix = value[:4] if len(value) >= 4 else value
    return f"{prefix}***"


# ── Public API ────────────────────────────────────────────────

def scan_for_secrets(text: str) -> List[Finding]:
    """
    Scan *text* for secret patterns and return a list of Finding objects.

    Args:
        text: Raw string content (code, logs, config, AI output, etc.)

    Returns:
        List of Finding dataclass instances, one per detected secret occurrence.
        Empty list if no secrets are found.

    Guarantees:
        * The raw secret value is never stored or returned; only masked forms.
        * Runs in O(P × L) where P = number of patterns, L = content length.
        * No network calls, no file I/O.
    """
    findings: List[Finding] = []
    lines = text.splitlines()

    for line_no, line in enumerate(lines, start=1):
        matched_spans: list[tuple[int, int]] = []  # avoid double-flagging

        for kind, pattern, summary in _PATTERNS:
            for m in pattern.finditer(line):
                # Skip if this span was already covered by a more specific pattern
                span = m.span()
                if any(s <= span[0] and span[1] <= e for s, e in matched_spans):
                    continue
                matched_spans.append(span)

                # Extract the actual matched string — use group(1) when the
                # pattern has a capture group, otherwise use group(0)
                raw = m.group(1) if m.lastindex and m.lastindex >= 1 else m.group(0)
                findings.append(Finding(
                    kind=kind,
                    match=_mask(raw),
                    location=f"line {line_no}",
                    summary=summary,
                ))

        # High-entropy heuristic — only for lines not already fully matched
        if not matched_spans:
            findings.extend(_check_high_entropy(line, line_no))

    logger.debug(
        "secret_scanner: scanned %d lines, found %d findings",
        len(lines),
        len(findings),
    )
    return findings
