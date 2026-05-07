#!/usr/bin/env python3

import json
import random
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

API_URL = "http://localhost:3000/api/logs"

SERVICE_PATTERNS = {
    "auth": [
        ("error", "TOKEN_INVALID", "JWT verification failed for refresh token"),
        ("error", "LOGIN_RATE_LIMIT", "Too many login attempts from the same IP"),
        ("warn", "AUTH_RETRY", "Identity provider retry triggered for login request"),
        ("info", "AUTH_RECOVERY", "Authentication service latency returned to normal"),
    ],
    "payments": [
        ("error", "PAYMENT_TIMEOUT", "Stripe charge request timed out after 12s"),
        ("error", "PAYMENT_DECLINED", "Card issuer declined authorization request"),
        ("warn", "PAYMENT_RETRY", "Retrying payment confirmation request"),
        ("info", "PAYMENT_RECOVERY", "Recovered payment processor connection"),
    ],
    "gateway": [
        ("error", "UPSTREAM_502", "Upstream service returned 502 for POST /checkout"),
        ("error", "ROUTE_TIMEOUT", "Gateway route timeout for GET /api/orders"),
        ("warn", "LATENCY_SPIKE", "Latency spike detected for POST /checkout"),
        ("info", "GATEWAY_RECOVERY", "Gateway error rate returned below threshold"),
    ],
}


def build_log_entry():
    service = random.choice(list(SERVICE_PATTERNS.keys()))
    level, error_code, message = random.choice(SERVICE_PATTERNS[service])
    correlation_suffix = random.randint(1000, 9999)

    return {
        "id": f"log-{uuid.uuid4().hex[:8]}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": service,
        "level": level,
        "errorCode": error_code,
        "message": f"{message} [corr:{correlation_suffix}]",
    }


def post_log(log_entry):
    payload = json.dumps(log_entry).encode("utf-8")
    request = urllib.request.Request(
        API_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=5) as response:
        body = response.read().decode("utf-8")
        return response.status, body


def main():
    print(f"Sending traffic to {API_URL}. Press Ctrl+C to stop.")

    try:
        while True:
            log_entry = build_log_entry()
            try:
                status, body = post_log(log_entry)
                print(f"[{status}] {log_entry['service']} {log_entry['level']} {log_entry['errorCode']} -> {body}")
            except urllib.error.URLError as error:
                print(f"Request failed: {error}", file=sys.stderr)

            time.sleep(random.uniform(2.0, 3.0))
    except KeyboardInterrupt:
        print("\nTraffic generator stopped.")


if __name__ == "__main__":
    main()
