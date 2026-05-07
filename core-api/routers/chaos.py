import httpx
from fastapi import APIRouter, Request, Response

router = APIRouter()

SWARM_CHAOS_URL = "http://swarm-chaos:5000"

@router.api_route("/config", methods=["GET", "PUT"])
async def proxy_chaos_config(request: Request):
    target = f"{SWARM_CHAOS_URL}/api/config"
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            if request.method == "GET":
                resp = await client.get(target)
            else:
                body = await request.body()
                resp = await client.request(request.method, target, content=body,
                                            headers={"Content-Type": request.headers.get("content-type", "application/json")})
        except Exception as e:
            return Response(
                content=f'{{"detail":"SwarmChaos unreachable: {str(e)}"}}',
                status_code=502,
                media_type="application/json"
            )

    safe_headers = {k: v for k, v in resp.headers.items()
                    if k.lower() not in ("transfer-encoding", "content-encoding", "content-length")}
    return Response(content=resp.content, status_code=resp.status_code, headers=safe_headers)
