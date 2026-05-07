from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx

from ledger.circuit_breaker import breaker

app = FastAPI(title="Aegis Reliability Suite - TokenBreaker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Headers that we consume at this hop and do not forward raw
_CONSUMED_HEADERS = {"host", "x-target-url", "content-length", "content-type", "transfer-encoding"}

@app.api_route("/{path:path}", methods=["POST", "PUT", "PATCH"])
async def proxy_post(request: Request, path: str):
    target_url = request.headers.get("X-Target-Url")
    agent_id = request.headers.get("X-Agent-Id")

    if not target_url:
        raise HTTPException(status_code=400, detail="Missing X-Target-Url header")
    if not agent_id:
        raise HTTPException(status_code=400, detail="Missing X-Agent-Id header")

    if breaker.is_blocked(agent_id):
        raise HTTPException(status_code=402, detail="Payment Required: Agent has exceeded MAX_BUDGET")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="TokenBreaker requires a valid JSON payload")

    # Estimate cost and attempt to charge
    cost = breaker.estimate_cost(payload)
    if not breaker.charge_agent(agent_id, cost):
        raise HTTPException(status_code=402, detail="Payment Required: This request would exceed the agent's MAX_BUDGET")

    # Prepare forwarding URL
    if path and not target_url.endswith("/"):
        full_url = f"{target_url}/{path}"
    else:
        full_url = target_url

    # ── Hop-Based Header Promotion ──
    # We consumed X-Target-Url (pointed at VaultGuard).
    # Now promote X-Chaos-Url → X-Target-Url so VaultGuard knows where to forward next.
    chaos_url = request.headers.get("X-Chaos-Url", "")
    final_url = request.headers.get("X-Final-Url", "")

    forwarded_headers = {}
    for k, v in request.headers.items():
        if k.lower() in _CONSUMED_HEADERS:
            continue
        if k.lower() == "x-chaos-url":
            continue  # consumed — promoted below
        forwarded_headers[k] = v

    if chaos_url:
        forwarded_headers["X-Target-Url"] = chaos_url
    elif final_url:
        forwarded_headers["X-Target-Url"] = final_url

    # Forward the request
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
            raise HTTPException(status_code=502, detail=f"TokenBreaker: Unable to reach target. Error: {str(e)}")

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=dict(resp.headers)
    )

@app.get("/api/v1/ledger")
def get_ledger():
    return {"budget": breaker.max_budget, "ledger": breaker.get_ledger()}

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "token-breaker"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5002, reload=True)
