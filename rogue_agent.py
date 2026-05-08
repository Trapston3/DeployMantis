"""
╔══════════════════════════════════════════════════════════════╗
║  DEPLOYMANTIS RELIABILITY SUITE — ROGUE AGENT INTEGRATION TEST    ║
║  Codename: rogue-agent-007                                  ║
║  Pipeline: TokenBreaker → VaultGuard → SwarmChaos → DeployMantisEnv║
╚══════════════════════════════════════════════════════════════╝

This script fires 15 concurrent requests through the full
governance pipeline to validate:
  1. TokenBreaker's financial circuit breaker (HTTP 402)
  2. VaultGuard's PII redaction ([REDACTED_EMAIL], [REDACTED_CC])
  3. SwarmChaos' chaos injection (HTTP 502/529 bottleneck crashes)
  4. DeployMantisEnv's RL environment step responses (HTTP 200)
"""

import asyncio
import json
import sys
import time
import os
import httpx

# Force UTF-8 output on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    os.system("")  # enable ANSI escape codes on Windows

# ── Configuration ──────────────────────────────────────────────
TOKEN_BREAKER_URL = "http://localhost:5002/api/v1/step"
LEDGER_URL = "http://localhost:5002/api/v1/ledger"
AGENT_ID = "rogue-agent-007"

HEADERS = {
    "X-Agent-Id": AGENT_ID,
    "X-Target-Url": "http://vault-guard:5001",
    "X-Chaos-Url": "http://swarm-chaos:5000",
    "X-Final-Url": "http://deploymantis-env:8000",
    "Content-Type": "application/json",
}

# Payload intentionally contains PII to trigger VaultGuard
PAYLOAD = {
    "action_type": "query_logs",
    "target_server_id": "srv-001",
    "severity_filter": "info",
    "max_entries": 50,
    "metadata": {
        "operator_email": "john.doe@example.com",
        "billing_cc": "4111222233334444",
        "source_ip": "192.168.1.42",
        "notes": "Routine audit by john.doe@example.com. CC on file: 4111-2222-3333-4444"
    }
}

TOTAL_REQUESTS = 15

# ── ANSI Color Codes ──────────────────────────────────────────
class C:
    RESET   = "\033[0m"
    BOLD    = "\033[1m"
    DIM     = "\033[2m"
    RED     = "\033[91m"
    GREEN   = "\033[92m"
    YELLOW  = "\033[93m"
    BLUE    = "\033[94m"
    MAGENTA = "\033[95m"
    CYAN    = "\033[96m"
    WHITE   = "\033[97m"
    BG_RED  = "\033[41m"
    BG_GRN  = "\033[42m"
    BG_YLW  = "\033[43m"
    BG_BLU  = "\033[44m"

def banner():
    print(f"""
{C.CYAN}{C.BOLD}╔══════════════════════════════════════════════════════════════╗
║          DEPLOYMANTIS RELIABILITY SUITE — VICTORY LAP              ║
║          Rogue Agent Integration Test                       ║
╠══════════════════════════════════════════════════════════════╣
║  Agent ID  : {C.YELLOW}rogue-agent-007{C.CYAN}                                 ║
║  Pipeline  : {C.WHITE}TokenBreaker → VaultGuard → SwarmChaos → DeployMantisEnv{C.CYAN} ║
║  Requests  : {C.WHITE}{TOTAL_REQUESTS} concurrent POST volleys{C.CYAN}                      ║
║  PII Bait  : {C.RED}john.doe@example.com | 4111222233334444{C.CYAN}        ║
╚══════════════════════════════════════════════════════════════╝{C.RESET}
""")

# ── Counters ──────────────────────────────────────────────────
stats = {
    "success": 0,
    "budget_exceeded": 0,
    "chaos_crash": 0,
    "other_error": 0,
    "pii_found_in_response": 0,
    "total_time": 0.0,
}

async def fire_request(client: httpx.AsyncClient, idx: int) -> None:
    tag = f"[REQ-{idx:02d}]"
    t0 = time.perf_counter()
    try:
        resp = await client.post(TOKEN_BREAKER_URL, headers=HEADERS, json=PAYLOAD, timeout=35.0)
        elapsed = (time.perf_counter() - t0) * 1000

        if resp.status_code == 402:
            stats["budget_exceeded"] += 1
            print(f"  {C.RED}{C.BOLD}{tag}{C.RESET}  {C.BG_RED}{C.WHITE} 402 BUDGET EXCEEDED {C.RESET}  "
                  f"{C.DIM}TokenBreaker cut the cord. Agent budget depleted.{C.RESET}  "
                  f"{C.DIM}({elapsed:.0f}ms){C.RESET}")

        elif resp.status_code in (502, 529):
            stats["chaos_crash"] += 1
            label = "502 BAD GATEWAY" if resp.status_code == 502 else "529 OVERLOADED"
            print(f"  {C.YELLOW}{C.BOLD}{tag}{C.RESET}  {C.BG_YLW}{C.WHITE} {label} {C.RESET}  "
                  f"{C.DIM}SwarmChaos injected a bottleneck crash!{C.RESET}  "
                  f"{C.DIM}({elapsed:.0f}ms){C.RESET}")

        elif 200 <= resp.status_code < 300:
            stats["success"] += 1
            try:
                body = resp.json()
            except Exception:
                body = resp.text

            body_str = json.dumps(body) if isinstance(body, dict) else str(body)

            # Verify PII was redacted
            pii_clean = True
            for pii_marker in ["john.doe@example.com", "4111222233334444", "4111-2222-3333-4444", "192.168.1.42"]:
                if pii_marker in body_str:
                    pii_clean = False
                    stats["pii_found_in_response"] += 1
                    break

            redact_status = (f"{C.GREEN}PII SCRUBBED ✓{C.RESET}" if pii_clean
                             else f"{C.RED}⚠ PII LEAK DETECTED{C.RESET}")

            print(f"  {C.GREEN}{C.BOLD}{tag}{C.RESET}  {C.BG_GRN}{C.WHITE} {resp.status_code} SUCCESS {C.RESET}  "
                  f"{redact_status}  {C.DIM}({elapsed:.0f}ms){C.RESET}")

            # Print a compact view of the response
            if isinstance(body, dict):
                msg = body.get("message", "")
                reward = body.get("cumulative_reward", "?")
                alert = body.get("global_alert_level", "?")
                print(f"         {C.DIM}├─ message: {C.WHITE}{msg[:80]}{C.RESET}")
                print(f"         {C.DIM}├─ reward:  {C.CYAN}{reward}{C.RESET}")
                print(f"         {C.DIM}└─ alert:   {C.YELLOW}{alert}{C.RESET}")
        else:
            stats["other_error"] += 1
            print(f"  {C.MAGENTA}{C.BOLD}{tag}{C.RESET}  {C.BG_BLU}{C.WHITE} {resp.status_code} UNEXPECTED {C.RESET}  "
                  f"{C.DIM}{resp.text[:120]}{C.RESET}  {C.DIM}({elapsed:.0f}ms){C.RESET}")

    except httpx.ConnectError:
        elapsed = (time.perf_counter() - t0) * 1000
        stats["other_error"] += 1
        print(f"  {C.RED}{C.BOLD}{tag}{C.RESET}  {C.RED}CONNECTION REFUSED{C.RESET}  "
              f"{C.DIM}Is docker compose up? TokenBreaker unreachable.{C.RESET}  {C.DIM}({elapsed:.0f}ms){C.RESET}")
    except httpx.ReadTimeout:
        elapsed = (time.perf_counter() - t0) * 1000
        stats["chaos_crash"] += 1
        print(f"  {C.YELLOW}{C.BOLD}{tag}{C.RESET}  {C.BG_YLW}{C.WHITE} TIMEOUT {C.RESET}  "
              f"{C.DIM}SwarmChaos bottleneck exceeded 35s read timeout.{C.RESET}  {C.DIM}({elapsed:.0f}ms){C.RESET}")
    except Exception as e:
        elapsed = (time.perf_counter() - t0) * 1000
        stats["other_error"] += 1
        print(f"  {C.RED}{C.BOLD}{tag}{C.RESET}  {C.RED}ERROR: {e}{C.RESET}  {C.DIM}({elapsed:.0f}ms){C.RESET}")


async def check_ledger(client: httpx.AsyncClient) -> None:
    print(f"\n{C.CYAN}{C.BOLD}── LEDGER STATUS ──────────────────────────────────────────{C.RESET}")
    try:
        resp = await client.get(LEDGER_URL, timeout=5.0)
        data = resp.json()
        budget = data.get("budget", "?")
        ledger = data.get("ledger", {})
        spend = ledger.get(AGENT_ID, 0.0)
        pct = (spend / float(budget)) * 100 if budget != "?" else 0

        bar_width = 40
        filled = int(bar_width * min(pct, 100) / 100)
        bar = "█" * filled + "░" * (bar_width - filled)
        color = C.GREEN if pct < 75 else (C.YELLOW if pct < 100 else C.RED)

        print(f"  Agent: {C.BOLD}{AGENT_ID}{C.RESET}")
        print(f"  Spend: {color}${spend:.4f}{C.RESET} / ${budget}")
        print(f"  Usage: {color}[{bar}] {pct:.1f}%{C.RESET}")
    except Exception as e:
        print(f"  {C.RED}Could not fetch ledger: {e}{C.RESET}")


def summary_report():
    total = stats["success"] + stats["budget_exceeded"] + stats["chaos_crash"] + stats["other_error"]
    print(f"""
{C.CYAN}{C.BOLD}╔══════════════════════════════════════════════════════════════╗
║                    MISSION DEBRIEF                          ║
╠══════════════════════════════════════════════════════════════╣{C.RESET}
  {C.GREEN}✓ Successful Passes  : {stats['success']}{C.RESET}
  {C.RED}✕ Budget Cutoffs     : {stats['budget_exceeded']}{C.RESET}
  {C.YELLOW}⚡ Chaos Crashes      : {stats['chaos_crash']}{C.RESET}
  {C.MAGENTA}? Other Errors       : {stats['other_error']}{C.RESET}
  {C.DIM}──────────────────────{C.RESET}
  {C.WHITE}Total Fired          : {total} / {TOTAL_REQUESTS}{C.RESET}
  {C.WHITE}Wall-Clock Time      : {stats['total_time']:.2f}s{C.RESET}
{C.CYAN}{C.BOLD}╚══════════════════════════════════════════════════════════════╝{C.RESET}
""")
    if stats["pii_found_in_response"] > 0:
        print(f"  {C.BG_RED}{C.WHITE} ⚠ WARNING: {stats['pii_found_in_response']} response(s) contained raw PII! VaultGuard may have been bypassed. {C.RESET}")
    elif stats["success"] > 0:
        print(f"  {C.BG_GRN}{C.WHITE} ✓ ALL RESPONSES CLEAN — VaultGuard successfully scrubbed PII. {C.RESET}")


async def main():
    banner()

    print(f"{C.CYAN}{C.BOLD}── FIRING {TOTAL_REQUESTS} CONCURRENT REQUESTS ────────────────────{C.RESET}\n")

    t_start = time.perf_counter()

    async with httpx.AsyncClient() as client:
        tasks = [fire_request(client, i + 1) for i in range(TOTAL_REQUESTS)]
        await asyncio.gather(*tasks)

    stats["total_time"] = time.perf_counter() - t_start

    async with httpx.AsyncClient() as client:
        await check_ledger(client)

    summary_report()


if __name__ == "__main__":
    asyncio.run(main())
