import os
import json
import random
import httpx
from fastapi import APIRouter, Request, Response, HTTPException

from chaos.injectors import inject_latency, inject_gateway, inject_amnesia, inject_hallucination

router = APIRouter()

CHAOS_CONFIG = {
    "injectionRate": int(float(os.getenv("CHAOS_PROBABILITY", "0.1")) * 100),
    "toggles": {
        "amnesia": True,
        "badGateway": True,
        "hallucination": False,
        "latency": False
    }
}

# Headers consumed at this hop
_CONSUMED_HEADERS = {"host", "x-target-url", "content-length", "content-type", "transfer-encoding"}

@router.api_route("/{path:path}", methods=["POST"])
async def proxy_post(request: Request, path: str):
    target_url = request.headers.get("X-Target-Url")
    if not target_url:
        raise HTTPException(status_code=400, detail="Missing X-Target-Url header")

    # Read the incoming payload
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    # Determine if chaos should strike
    is_chaos = random.random() < (CHAOS_CONFIG["injectionRate"] / 100.0)
    chaos_type = None

    if is_chaos:
        active_toggles = []
        if CHAOS_CONFIG["toggles"]["amnesia"]: active_toggles.append("amnesia")
        if CHAOS_CONFIG["toggles"]["badGateway"]: active_toggles.append("gateway")
        if CHAOS_CONFIG["toggles"]["hallucination"]: active_toggles.append("hallucination")
        if CHAOS_CONFIG["toggles"]["latency"]: active_toggles.append("latency")
        
        if active_toggles:
            chaos_type = random.choice(active_toggles)
        else:
            is_chaos = False

    # 1. Pre-flight Chaos
    if is_chaos and chaos_type == "latency":
        await inject_latency()

    if is_chaos and chaos_type == "gateway":
        await inject_gateway()

    if is_chaos and chaos_type == "amnesia":
        payload = inject_amnesia(payload)

    # 2. Forward the request
    if path and not target_url.endswith("/"):
        full_url = f"{target_url}/{path}"
    else:
        full_url = target_url

    # ── SwarmChaos is the LAST proxy in the chain ──
    # X-Target-Url already points at the final destination (e.g., deploymantis-env).
    # Strip all hop headers before forwarding to the real service.
    forwarded_headers = {}
    for k, v in request.headers.items():
        if k.lower() in _CONSUMED_HEADERS:
            continue
        if k.lower().startswith("x-chaos") or k.lower().startswith("x-final"):
            continue
        forwarded_headers[k] = v

    async with httpx.AsyncClient(timeout=30.0) as client:
        req = client.build_request(
            request.method,
            full_url,
            headers=forwarded_headers,
            json=payload
        )
        try:
            resp = await client.send(req)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Bad Gateway: Unable to reach target {full_url}. Error: {str(e)}")

    # Try to parse the response as JSON for post-flight chaos
    try:
        response_data = resp.json()
    except Exception:
        response_data = None

    # 3. Post-flight Chaos
    if is_chaos and chaos_type == "hallucination" and response_data is not None:
        response_data = await inject_hallucination(response_data)
        return Response(
            content=json.dumps(response_data),
            status_code=resp.status_code,
            headers={"Content-Type": "application/json"}
        )

    # Normal return
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=dict(resp.headers)
    )
