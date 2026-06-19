"""
MantisVerify — Analysis Engine for mantis-graph
================================================
Exposes POST /verify on the mantis-graph service (port 5003).

Responsibilities
----------------
* Parse a unified diff into per-file chunks (added/removed lines).
* Load the existing AST index from disk (if present) — zero re-indexing.
* For each affected file compute three raw signals:
    convention_match  – how well new identifiers follow established patterns.
    reuse_score       – whether the diff calls known helpers vs. inlining new code.
    risk_score        – proximity to high-sensitivity modules / constructs.
* Aggregate across files and return a compact JSON payload.

No LLM calls, no network calls — purely local, deterministic analysis.
Expected latency: < 5 ms for typical diffs (mostly regex + set lookups).
"""

import re
import os
import json
import logging
from typing import Any

logger = logging.getLogger("deploymantis.mantis_verify")

# ── Risk vocabulary ────────────────────────────────────────────
# Lines touching these tokens raise the risk score.
_RISK_TOKENS: set[str] = {
    # Auth / security layer
    "auth", "token", "secret", "password", "credential", "apikey", "api_key",
    "vault", "encrypt", "decrypt", "hash", "jwt", "oauth", "session",
    # Network / external I/O
    "request", "response", "httpx", "urllib", "socket", "aiohttp", "fetch",
    # Database layer
    "sqlite", "cursor", "execute", "commit", "rollback", "sqlalchemy",
    "database", "db", "query",
    # Error handling boundaries
    "except", "raise", "traceback",
}

# ── Naming convention patterns ─────────────────────────────────
_SNAKE_CASE = re.compile(r"^[a-z_][a-z0-9_]*$")
_PASCAL_CASE = re.compile(r"^[A-Z][a-zA-Z0-9]*$")
_UPPER_CONST = re.compile(r"^[A-Z_][A-Z0-9_]*$")

# Regex to extract identifiers from def/class lines in a diff
_DEF_PATTERN = re.compile(r"^\+\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(")
_CLASS_PATTERN = re.compile(r"^\+\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:(]")

# Detect calls to existing helpers: "something(" on added lines
_CALL_PATTERN = re.compile(r"^\+.*\b([a-z_][a-z0-9_]{2,})\s*\(")


# ── Diff parser ────────────────────────────────────────────────

def _parse_diff(diff_text: str) -> dict[str, dict]:
    """
    Split a unified diff into per-file buckets.

    Returns:
        {
          "path/to/file.py": {
              "added":   ["+ line content", ...],
              "removed": ["- line content", ...],
          },
          ...
        }
    """
    files: dict[str, dict] = {}
    current_file: str | None = None

    for raw_line in diff_text.splitlines():
        # --- a/path/to/file  /  +++ b/path/to/file
        if raw_line.startswith("+++ b/") or raw_line.startswith("+++ "):
            path = raw_line[6:] if raw_line.startswith("+++ b/") else raw_line[4:]
            path = path.strip()
            current_file = path
            if current_file not in files:
                files[current_file] = {"added": [], "removed": []}
        elif raw_line.startswith("--- "):
            # Skip; we resolve file from +++ lines
            continue
        elif current_file is None:
            continue
        elif raw_line.startswith("+") and not raw_line.startswith("+++"):
            files[current_file]["added"].append(raw_line)
        elif raw_line.startswith("-") and not raw_line.startswith("---"):
            files[current_file]["removed"].append(raw_line)

    return files


# ── Index loader ───────────────────────────────────────────────

def _load_index(workspace_root: str) -> dict:
    """
    Load the existing mantis-graph AST index from disk.
    Returns an empty index structure if the file is absent or unreadable.
    This avoids any re-indexing on the hot path.
    """
    index_path = os.path.join(workspace_root, ".mantis_graph_index.json")
    if not os.path.exists(index_path):
        logger.debug("MantisVerify: no index found at %s — using empty index", index_path)
        return {"classes": [], "functions": [], "calls": []}
    try:
        with open(index_path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:
        logger.warning("MantisVerify: failed to load index (%s) — degrading gracefully", exc)
        return {"classes": [], "functions": [], "calls": []}


# ── Per-file signal computation ───────────────────────────────

def _compute_convention_match(
    added_lines: list[str],
    index_functions: list[dict],
    index_classes: list[dict],
    file_path: str,
) -> float:
    """
    Score 0.0–1.0: how closely new identifiers follow established naming.

    Strategy:
    1. Collect new function/class names from added diff lines.
    2. Determine the dominant convention from the existing index for this file.
    3. Return the fraction of new names that match the dominant convention.
    4. If no new identifiers introduced → neutral 0.75 (no violation).
    5. If no existing index for this file → neutral 0.75.
    """
    # Extract new identifiers from the diff
    new_funcs = [m.group(1) for line in added_lines for m in [_DEF_PATTERN.match(line)] if m]
    new_classes = [m.group(1) for line in added_lines for m in [_CLASS_PATTERN.match(line)] if m]

    new_identifiers = new_funcs + new_classes
    if not new_identifiers:
        return 0.75  # neutral — nothing to judge

    # Gather existing names from the index for this specific file
    existing_funcs = [f["name"] for f in index_functions if f.get("file") == file_path]
    existing_classes = [c["name"] for c in index_classes if c.get("file") == file_path]

    if not existing_funcs and not existing_classes:
        # No prior context — check internal consistency only
        snake_count = sum(1 for n in new_identifiers if _SNAKE_CASE.match(n))
        return snake_count / len(new_identifiers)

    # Determine dominant convention in existing code
    snake_existing = sum(1 for n in existing_funcs if _SNAKE_CASE.match(n))
    pascal_existing = sum(1 for n in existing_classes if _PASCAL_CASE.match(n))
    dominant_is_snake = snake_existing >= pascal_existing

    # Score new identifiers against dominant convention
    matched = 0
    for name in new_funcs:
        if dominant_is_snake and _SNAKE_CASE.match(name):
            matched += 1
        elif not dominant_is_snake and _PASCAL_CASE.match(name):
            matched += 1
        elif _SNAKE_CASE.match(name):  # snake is always acceptable for functions
            matched += 1
    for name in new_classes:
        if _PASCAL_CASE.match(name):
            matched += 1

    return matched / len(new_identifiers)


def _compute_reuse_score(
    added_lines: list[str],
    index_functions: list[dict],
) -> float:
    """
    Score 0.0–1.0: degree to which new code calls existing helpers.

    High score = new code calls known functions (good reuse).
    Low score  = new code introduces many new call sites but ignores existing helpers.

    Strategy:
    * Extract all function calls on added lines.
    * Compare against known function names in the index.
    * ratio = (calls to known functions) / (total unique calls made)
    """
    known_names: set[str] = {f["name"] for f in index_functions}
    new_calls: list[str] = []
    for line in added_lines:
        new_calls.extend(m.group(1) for m in _CALL_PATTERN.finditer(line))

    if not new_calls:
        return 0.65  # neutral — diff adds no calls

    unique_calls = set(new_calls)
    reused = unique_calls & known_names
    return len(reused) / len(unique_calls) if unique_calls else 0.65


def _compute_risk_score(added_lines: list[str], file_path: str) -> float:
    """
    Score 0.0–1.0: how much the diff touches sensitive areas.

    Factors:
    * File path contains a risk keyword (e.g., auth.py, vault.py).
    * Added lines contain risk vocabulary tokens.
    * Risk is normalised over total added lines to avoid penalising large but safe diffs.
    """
    # File-path risk bump
    path_lower = file_path.lower()
    path_risk = 0.0
    high_risk_paths = {"auth", "vault", "token", "secret", "crypt", "password", "security"}
    for rp in high_risk_paths:
        if rp in path_lower:
            path_risk = 0.35
            break

    if not added_lines:
        return path_risk

    # Count risk-bearing added lines
    risky_lines = 0
    for line in added_lines:
        line_lower = line.lower()
        if any(tok in line_lower for tok in _RISK_TOKENS):
            risky_lines += 1

    line_risk = risky_lines / len(added_lines)
    # Combine: path risk + proportional line risk, capped at 1.0
    return min(1.0, path_risk + line_risk * 0.65)


# ── Notes generator ───────────────────────────────────────────

def _generate_notes(
    file_path: str,
    convention_match: float,
    reuse_score: float,
    risk_score: float,
) -> list[str]:
    """Return up to 3 terse human-readable observations for a single file."""
    notes: list[str] = []

    if convention_match < 0.6:
        notes.append(
            f"{file_path}: new identifiers deviate from established naming conventions "
            f"(match={convention_match:.0%})."
        )
    elif convention_match >= 0.9:
        notes.append(f"{file_path}: naming conventions fully consistent with codebase.")

    if reuse_score < 0.4:
        notes.append(
            f"{file_path}: low reuse of existing helpers detected "
            f"(reuse={reuse_score:.0%}); possible logic duplication."
        )

    if risk_score >= 0.6:
        notes.append(
            f"{file_path}: elevated risk score ({risk_score:.0%}) — diff touches "
            "sensitive areas (auth/vault/network/DB)."
        )

    return notes


# ── Public analyser ───────────────────────────────────────────

def analyze_diff(
    diff_text: str,
    explicit_files: list[str],
    workspace_root: str,
) -> dict[str, Any]:
    """
    Main entry point called by the /verify endpoint.

    Args:
        diff_text:       Full unified diff string.
        explicit_files:  Optional caller-supplied file list (used as fallback
                         when diff headers are absent/malformed).
        workspace_root:  Absolute path to the repo root (for index loading).

    Returns a dict with keys:
        convention_match, reuse_score, risk_score  — floats, 0–1
        notes                                       — list[str]
        files_analyzed                              — list of file paths touched
    """
    # 1. Parse diff
    file_chunks = _parse_diff(diff_text)

    # Fall back to explicitly provided files if the diff had no file headers
    if not file_chunks and explicit_files:
        for fp in explicit_files:
            file_chunks[fp] = {"added": [], "removed": []}

    if not file_chunks:
        logger.info("MantisVerify: empty diff — returning neutral scores")
        return {
            "convention_match": 0.75,
            "reuse_score": 0.65,
            "risk_score": 0.0,
            "notes": ["Diff was empty or contained no parseable hunks."],
            "files_analyzed": [],
        }

    # 2. Load AST index once (reuse existing — no re-indexing)
    index = _load_index(workspace_root)
    idx_functions: list[dict] = index.get("functions", [])
    idx_classes: list[dict] = index.get("classes", [])

    # 3. Compute per-file signals and aggregate
    all_convention: list[float] = []
    all_reuse: list[float] = []
    all_risk: list[float] = []
    all_notes: list[str] = []

    for file_path, chunks in file_chunks.items():
        added = chunks["added"]

        cv = _compute_convention_match(added, idx_functions, idx_classes, file_path)
        rs = _compute_reuse_score(added, idx_functions)
        rk = _compute_risk_score(added, file_path)

        all_convention.append(cv)
        all_reuse.append(rs)
        all_risk.append(rk)
        all_notes.extend(_generate_notes(file_path, cv, rs, rk))

    def _avg(lst: list[float]) -> float:
        return round(sum(lst) / len(lst), 4) if lst else 0.0

    return {
        "convention_match": _avg(all_convention),
        "reuse_score": _avg(all_reuse),
        "risk_score": _avg(all_risk),
        "notes": all_notes,
        "files_analyzed": list(file_chunks.keys()),
    }
