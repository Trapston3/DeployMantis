from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

from scanner.redactor import redactor, RULES

app = FastAPI(title="DeployMantis Reliability Suite - VaultGuard")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Headers consumed at this hop
_CONSUMED_HEADERS = {"host", "x-target-url", "content-length", "content-type", "transfer-encoding"}

@app.api_route("/{path:path}", methods=["POST", "PUT", "PATCH"])
async def proxy_post(request: Request, path: str):
    target_url = request.headers.get("X-Target-Url")
    if not target_url:
        raise HTTPException(status_code=400, detail="Missing X-Target-Url header")

    # Read and redact payload
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="VaultGuard requires a valid JSON payload")

    redacted_payload = redactor.redact_payload(payload)

    # Prepare forwarding URL
    if path and not target_url.endswith("/"):
        full_url = f"{target_url}/{path}"
    else:
        full_url = target_url

    # ── Hop-Based Header Promotion ──
    # VaultGuard consumed X-Target-Url (pointed at SwarmChaos via promotion).
    # Now promote X-Final-Url → X-Target-Url so SwarmChaos knows the final destination.
    final_url = request.headers.get("X-Final-Url", "")

    forwarded_headers = {}
    for k, v in request.headers.items():
        if k.lower() in _CONSUMED_HEADERS:
            continue
        if k.lower() == "x-final-url":
            continue  # consumed — promoted below
        forwarded_headers[k] = v

    if final_url:
        forwarded_headers["X-Target-Url"] = final_url

    # Forward the request with redacted payload
    async with httpx.AsyncClient(timeout=30.0) as client:
        req = client.build_request(
            request.method,
            full_url,
            headers=forwarded_headers,
            json=redacted_payload
        )
        try:
            resp = await client.send(req)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"VaultGuard: Unable to reach target. Error: {str(e)}")

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=dict(resp.headers)
    )

# ── Governance API ────────────────────────────────────────────

class RuleToggle(BaseModel):
    id: str
    enabled: bool

class TextPayload(BaseModel):
    text: str

@app.get("/api/rules")
def get_rules():
    """Return the current PII rule list (without compiled regex objects)."""
    return [{"id": r["id"], "name": r["name"], "pattern": r["pattern"],
             "replacement": r["replacement"], "enabled": r["enabled"]} for r in RULES]

@app.put("/api/rules")
def update_rules(toggles: list[RuleToggle]):
    """Enable/disable rules by id."""
    toggle_map = {t.id: t.enabled for t in toggles}
    for rule in RULES:
        if rule["id"] in toggle_map:
            rule["enabled"] = toggle_map[rule["id"]]
    return {"status": "updated", "rules": get_rules()}

@app.post("/api/test-redaction")
def test_redaction(payload: TextPayload):
    """Run the text through the live redactor and return the scrubbed result."""
    scrubbed = redactor.redact_string(payload.text)
    return {"original": payload.text, "scrubbed": scrubbed}

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "vault-guard"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5001, reload=True)
