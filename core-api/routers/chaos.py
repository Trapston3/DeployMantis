import os
import httpx
from fastapi import APIRouter, Request, Response

router = APIRouter()

_CHAOS_URLS = [
    os.getenv("SWARM_CHAOS_URL", "http://swarm-chaos:5000"),
    "http://localhost:5000",
]


async def _chaos_request(method: str, path: str, body: bytes = b"", content_type: str = "application/json"):
    """Try each SwarmChaos URL in order, return first successful response."""
    last_exc = None
    for base in _CHAOS_URLS:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                if method == "GET":
                    return await client.get(f"{base}{path}")
                return await client.request(
                    method, f"{base}{path}",
                    content=body,
                    headers={"Content-Type": content_type}
                )
        except Exception as e:
            last_exc = e
            continue
    raise last_exc


@router.api_route("/config", methods=["GET", "PUT"])
async def proxy_chaos_config(request: Request):
    body = b"" if request.method == "GET" else await request.body()
    try:
        resp = await _chaos_request(
            request.method, "/api/config",
            body=body,
            content_type=request.headers.get("content-type", "application/json")
        )
    except Exception as e:
        return Response(
            content=f'{{"detail":"SwarmChaos unreachable: {str(e)}"}}',
            status_code=502,
            media_type="application/json"
        )

    safe_headers = {k: v for k, v in resp.headers.items()
                    if k.lower() not in ("transfer-encoding", "content-encoding", "content-length")}
    return Response(content=resp.content, status_code=resp.status_code, headers=safe_headers)
