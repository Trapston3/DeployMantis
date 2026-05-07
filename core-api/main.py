import os
import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from routers.inference import router as inference_router
from routers.orchestrator import router as orchestrator_router
from routers.ingest import router as ingest_router
from routers.chaos import router as chaos_router
from routers.vault import router as vault_router

app = FastAPI(title="Aegis Reliability Suite - Core API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(inference_router, prefix="/api/v1/inference", tags=["inference"])
app.include_router(orchestrator_router, prefix="/api/v1/orchestrator", tags=["orchestrator"])
app.include_router(ingest_router, prefix="/api/v1/ingest", tags=["ingest"])
app.include_router(chaos_router, prefix="/api/v1/chaos", tags=["chaos"])
app.include_router(vault_router, prefix="/api/v1/vault", tags=["vault"])

STRATA_URL = os.getenv("STRATA_URL", "http://strata:3000")
AEGIS_ENV_URL = os.getenv("AEGIS_ENV_URL", "http://aegis-env:8000")


# ── Strata Proxy (path-stripped relay) ────────────────────────
# Dashboard fetches /api/v1/strata/debugger/frames
# Strata exposes       /api/debugger/frames
# We strip the /api/v1/strata prefix and forward /api/{path}

@app.api_route("/api/v1/strata/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_strata(request: Request, path: str):
    target = f"{STRATA_URL}/api/{path}"
    query = request.url.query
    if query:
        target += f"?{query}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            if request.method == "GET":
                resp = await client.get(target)
            elif request.method == "DELETE":
                resp = await client.delete(target)
            else:
                body = await request.body()
                resp = await client.request(request.method, target, content=body,
                                            headers={"Content-Type": request.headers.get("content-type", "application/json")})
        except Exception as e:
            return Response(
                content=f'{{"detail":"Strata unreachable: {str(e)}"}}',
                status_code=502,
                media_type="application/json"
            )

    # Filter out hop-encoding headers that confuse the browser
    safe_headers = {k: v for k, v in resp.headers.items()
                    if k.lower() not in ("transfer-encoding", "content-encoding", "content-length")}
    return Response(content=resp.content, status_code=resp.status_code, headers=safe_headers)


# ── AegisEnv Proxy ────────────────────────────────────────────

@app.api_route("/api/v1/aegis-env/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_aegis_env(request: Request, path: str):
    target = f"{AEGIS_ENV_URL}/api/v1/{path}"
    query = request.url.query
    if query:
        target += f"?{query}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            body = await request.body()
            resp = await client.request(request.method, target, content=body,
                                        headers={"Content-Type": request.headers.get("content-type", "application/json")})
        except Exception as e:
            return Response(
                content=f'{{"detail":"AegisEnv unreachable: {str(e)}"}}',
                status_code=502,
                media_type="application/json"
            )

    safe_headers = {k: v for k, v in resp.headers.items()
                    if k.lower() not in ("transfer-encoding", "content-encoding", "content-length")}
    return Response(content=resp.content, status_code=resp.status_code, headers=safe_headers)


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "core-api"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=4000, reload=True)
