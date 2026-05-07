import httpx
from fastapi import APIRouter, Request, Response

router = APIRouter()

VAULT_GUARD_URL = "http://vault-guard:5001"


@router.api_route("/rules", methods=["GET", "PUT"])
async def proxy_vault_rules(request: Request):
    target = f"{VAULT_GUARD_URL}/api/rules"
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            if request.method == "GET":
                resp = await client.get(target)
            else:
                body = await request.body()
                resp = await client.request(
                    request.method, target, content=body,
                    headers={"Content-Type": request.headers.get("content-type", "application/json")}
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
    target = f"{VAULT_GUARD_URL}/api/test-redaction"
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            body = await request.body()
            resp = await client.post(
                target, content=body,
                headers={"Content-Type": request.headers.get("content-type", "application/json")}
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
