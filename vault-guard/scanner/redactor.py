import re
from typing import Any

# ── Rule Registry ─────────────────────────────────────────────
# Each rule is a dict with: id, name, pattern, replacement, enabled.
# The list is mutable so PUT /api/rules can toggle rules at runtime.
RULES: list[dict] = [
    {
        "id": "email",
        "name": "Email Address",
        "pattern": r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+",
        "replacement": "[REDACTED_EMAIL]",
        "enabled": True,
    },
    {
        "id": "cc",
        "name": "Credit Card",
        "pattern": r"\b(?:\d[ -]*?){13,16}\b",
        "replacement": "[REDACTED_CC]",
        "enabled": True,
    },
    {
        "id": "ipv4",
        "name": "IPv4 Address",
        "pattern": r"\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b",
        "replacement": "[REDACTED_IPV4]",
        "enabled": True,
    },
    {
        "id": "ssn",
        "name": "SSN",
        "pattern": r"\b\d{3}-\d{2}-\d{4}\b",
        "replacement": "[REDACTED_SSN]",
        "enabled": False,
    },
]


class PIIRedactor:
    def redact_string(self, text: str) -> str:
        """Apply all enabled rules to a plain string."""
        if not isinstance(text, str):
            return text
        for rule in RULES:
            if not rule["enabled"]:
                continue
            try:
                text = re.sub(rule["pattern"], rule["replacement"], text)
            except re.error:
                pass
        return text

    def redact_payload(self, data: Any) -> Any:
        """Recursively traverse a JSON-like structure and redact strings."""
        if isinstance(data, dict):
            return {k: self.redact_payload(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self.redact_payload(item) for item in data]
        elif isinstance(data, str):
            return self.redact_string(data)
        return data


redactor = PIIRedactor()
