"""
DeployMantis — Python SDK
=========================
A high-level client for routing requests through the DeployMantis
governance proxy chain (TokenBreaker → VaultGuard → SwarmChaos → MantisEnv).

Usage:
    from sdk.client import MantisClient

    client = MantisClient(agent_id="my-agent")
    result = client.step({"action_type": "query_logs", "target_server_id": "srv-001"})
"""

import httpx
from typing import Any, Optional


# ── Service Registry ──────────────────────────────────────────
# Maps short hop names to their Docker-internal service URLs.
# When running locally (outside Docker), override via constructor.
_HOP_REGISTRY = {
    "breaker": "http://token-breaker:5002",
    "vault":   "http://vault-guard:5001",
    "chaos":   "http://swarm-chaos:5000",
    "env":     "http://mantis-env:8000",
}

# Default hop order for full governance pipeline
_DEFAULT_HOPS = ["vault", "chaos", "env"]


class MantisClient:
    """
    High-level SDK client for DeployMantis.

    Automatically constructs the multi-hop proxy chain headers
    (X-Target-Url, X-Chaos-Url, X-Final-Url) so callers never
    have to manage proxy wiring manually.

    Args:
        base_url:  The TokenBreaker entry point.
                   Default: ``http://localhost:5002`` (host-mapped port).
        agent_id:  Unique identifier for budget tracking.
        timeout:   HTTP request timeout in seconds.
        registry:  Optional override for the hop→URL mapping.
    """

    def __init__(
        self,
        agent_id: str,
        base_url: str = "http://localhost:5002",
        timeout: float = 35.0,
        registry: Optional[dict[str, str]] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.agent_id = agent_id
        self.timeout = timeout
        self._registry = registry or dict(_HOP_REGISTRY)

    # ── Public API ────────────────────────────────────────────

    def step(
        self,
        payload: dict[str, Any],
        path: str = "/api/v1/step",
        hops: list[str] | None = None,
    ) -> "MantisResponse":
        """
        Fire a synchronous request through the governance pipeline.

        Args:
            payload:  The JSON body (e.g. an ActionRequest for DeployMantisEnv).
            path:     The API path appended to every hop.
            hops:     Ordered list of proxy hops AFTER TokenBreaker.
                      Default: ``["vault", "chaos", "env"]``.
                      Valid names: ``vault``, ``chaos``, ``env``.
                      Pass ``["env"]`` to skip governance entirely.

        Returns:
            An ``DeployMantisResponse`` with status_code, body, and metadata.
        """
        hops = hops if hops is not None else list(_DEFAULT_HOPS)
        headers = self._build_headers(hops)
        url = f"{self.base_url}{path}"

        with httpx.Client(timeout=self.timeout) as client:
            resp = client.post(url, json=payload, headers=headers)

        return MantisResponse(
            status_code=resp.status_code,
            body=_safe_json(resp),
            headers=dict(resp.headers),
            raw=resp,
        )

    async def step_async(
        self,
        payload: dict[str, Any],
        path: str = "/api/v1/step",
        hops: list[str] | None = None,
    ) -> "MantisResponse":
        """Async variant of :meth:`step`."""
        hops = hops if hops is not None else list(_DEFAULT_HOPS)
        headers = self._build_headers(hops)
        url = f"{self.base_url}{path}"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(url, json=payload, headers=headers)

        return MantisResponse(
            status_code=resp.status_code,
            body=_safe_json(resp),
            headers=dict(resp.headers),
            raw=resp,
        )

    def get_ledger(self) -> dict[str, Any]:
        """Fetch the current budget ledger from TokenBreaker."""
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(f"{self.base_url}/api/v1/ledger")
            resp.raise_for_status()
            return resp.json()

    def reset_env(self, hops: list[str] | None = None) -> "MantisResponse":
        """Reset the MantisEnv RL environment through the pipeline."""
        return self.step({}, path="/api/v1/reset", hops=hops)

    # ── Header Construction ───────────────────────────────────

    def _build_headers(self, hops: list[str]) -> dict[str, str]:
        """
        Translate an ordered hop list into the multi-hop header chain.

        The header mapping follows the promotion protocol:
          - Hop 0 → X-Target-Url  (consumed by TokenBreaker)
          - Hop 1 → X-Chaos-Url   (promoted by TokenBreaker → VaultGuard)
          - Hop 2 → X-Final-Url   (promoted by VaultGuard → SwarmChaos)
        """
        header_keys = ["X-Target-Url", "X-Chaos-Url", "X-Final-Url"]
        headers: dict[str, str] = {
            "X-Agent-Id": self.agent_id,
            "Content-Type": "application/json",
        }

        for i, hop_name in enumerate(hops):
            if i >= len(header_keys):
                break
            url = self._registry.get(hop_name)
            if not url:
                raise ValueError(
                    f"Unknown hop '{hop_name}'. "
                    f"Valid hops: {list(self._registry.keys())}"
                )
            headers[header_keys[i]] = url

        return headers

    def __repr__(self) -> str:
        return f"MantisClient(agent_id={self.agent_id!r}, base_url={self.base_url!r})"


# ── Response Wrapper ──────────────────────────────────────────

class MantisResponse:
    """
    Structured response from the DeployMantis pipeline.

    Attributes:
        status_code:  HTTP status code from the final response.
        body:         Parsed JSON body (or raw text if unparseable).
        headers:      Response headers dict.
        recovered:    True if the request was recovered via FallbackMesh.
        raw:          The underlying ``httpx.Response``.
    """

    def __init__(
        self,
        status_code: int,
        body: Any,
        headers: dict[str, str],
        raw: httpx.Response,
    ):
        self.status_code = status_code
        self.body = body
        self.headers = headers
        self.raw = raw
        self.recovered = headers.get("x-mantis-recovered", "").lower() == "true"

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    @property
    def budget_exceeded(self) -> bool:
        return self.status_code == 402

    @property
    def chaos_injected(self) -> bool:
        return self.status_code in (502, 529)

    @property
    def message(self) -> str:
        if isinstance(self.body, dict):
            return self.body.get("message", "")
        return str(self.body)

    def __repr__(self) -> str:
        tag = "OK" if self.ok else f"HTTP {self.status_code}"
        extras = []
        if self.recovered:
            extras.append("recovered")
        if self.budget_exceeded:
            extras.append("budget_exceeded")
        if self.chaos_injected:
            extras.append("chaos")
        suffix = f" [{', '.join(extras)}]" if extras else ""
        return f"MantisResponse({tag}{suffix})"


# ── Helpers ───────────────────────────────────────────────────

def _safe_json(resp: httpx.Response) -> Any:
    try:
        return resp.json()
    except Exception:
        return resp.text
