import os
import httpx
from fastapi import APIRouter, Request, Response

router = APIRouter()

_VAULT_URLS = [
    os.getenv("VAULT_GUARD_URL", "http://vault-guard:5001"),
    "http://localhost:5001",
]


async def _vault_request(method: str, path: str, body: bytes = b"", content_type: str = "application/json"):
    """Try each VAULT_GUARD URL in order, return the first successful response."""
    last_exc = None
    for base in _VAULT_URLS:
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


@router.api_route("/rules", methods=["GET", "PUT"])
async def proxy_vault_rules(request: Request):
    body = b"" if request.method == "GET" else await request.body()
    try:
        resp = await _vault_request(
            request.method, "/api/rules",
            body=body,
            content_type=request.headers.get("content-type", "application/json")
        )
    except Exception as e:
        return Response(
            content=f'{{"detail":"VaultGuard unreachable: {str(e)}"}}',
            status_code=502,
            media_type="application/json"
        )

    safe_headers = {k: v for k, v in resp.headers.items()
                    if k.lower() not in ("transfer-encoding", "content-encoding", "content-length")}
    return Response(content=resp.content, status_code=resp.status_code, headers=safe_headers)


@router.post("/test-redaction")
async def proxy_test_redaction(request: Request):
    body = await request.body()
    try:
        resp = await _vault_request(
            "POST", "/api/test-redaction",
            body=body,
            content_type=request.headers.get("content-type", "application/json")
        )
    except Exception as e:
        return Response(
            content=f'{{"detail":"VaultGuard unreachable: {str(e)}"}}',
            status_code=502,
            media_type="application/json"
        )

    safe_headers = {k: v for k, v in resp.headers.items()
                    if k.lower() not in ("transfer-encoding", "content-encoding", "content-length")}
    return Response(content=resp.content, status_code=resp.status_code, headers=safe_headers)


@router.post("/scan")
async def proxy_scan(request: Request):
    """Proxy vault-guard POST /scan — secret detection endpoint."""
    body = await request.body()
    try:
        resp = await _vault_request(
            "POST", "/scan",
            body=body,
            content_type=request.headers.get("content-type", "application/json")
        )
    except Exception as e:
        return Response(
            content=f'{{"detail":"VaultGuard unreachable: {str(e)}"}}',
            status_code=502,
            media_type="application/json"
        )

    safe_headers = {k: v for k, v in resp.headers.items()
                    if k.lower() not in ("transfer-encoding", "content-encoding", "content-length")}
    return Response(content=resp.content, status_code=resp.status_code, headers=safe_headers)
