import os
import json
import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from routers.inference import router as inference_router
from routers.orchestrator import router as orchestrator_router
from routers.ingest import router as ingest_router
from routers.chaos import router as chaos_router
from routers.vault import router as vault_router
from routers.mantis_snap import router as mantis_snap_router
from routers.mantis_verify import router as mantis_verify_router
from routers.mantis_guard import router as mantis_guard_router
from routers.mantis_launch import router as mantis_launch_router
from routers.mantis_style import router as mantis_style_router
from routers.billing import router as billing_router
from services.prompt_optimizer import PromptOptimizer
from auth.middleware import BillingMiddleware

app = FastAPI(title="DeployMantis - Core API")

# Add CORS Middleware first
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add Billing and Auth Middleware
app.add_middleware(BillingMiddleware)

@app.on_event("startup")
async def startup_event():
    from db.connection import init_pool
    from db.migrate import run_migrations
    from auth import key_store
    from billing import billing_store
    await init_pool()
    await run_migrations()
    key_store.init_db()
    billing_store.init_db()


@app.on_event("shutdown")
async def shutdown_event():
    from db.connection import close_pool
    await close_pool()

app.include_router(inference_router, prefix="/api/v1/inference", tags=["inference"])
app.include_router(orchestrator_router, prefix="/api/v1/orchestrator", tags=["orchestrator"])
app.include_router(ingest_router, prefix="/api/v1/ingest", tags=["ingest"])
app.include_router(chaos_router, prefix="/api/v1/chaos", tags=["chaos"])
app.include_router(vault_router, prefix="/api/v1/vault", tags=["vault"])
app.include_router(mantis_snap_router, prefix="/api/v1/mantis-snap", tags=["mantis-snap"])
app.include_router(mantis_verify_router, prefix="/api/v1/mantis-verify", tags=["mantis-verify"])
app.include_router(mantis_guard_router,  prefix="/api/v1/mantis-guard",  tags=["mantis-guard"])
app.include_router(mantis_launch_router, prefix="/api/v1/mantis-launch", tags=["mantis-launch"])
app.include_router(mantis_style_router,  prefix="/api/v1/mantis-style",  tags=["mantis-style"])
app.include_router(billing_router,       prefix="/api/v1/billing",       tags=["billing"])


STRATA_URL = os.getenv("STRATA_URL", "http://strata:3000")
MANTIS_ENV_URL = os.getenv("MANTIS_ENV_URL", "http://mantis-env:8000")
TOKEN_BREAKER_URL = os.getenv("TOKEN_BREAKER_URL", "http://token-breaker:5002")


def _resolve_url(docker_url: str, localhost_fallback: str) -> str:
    """Return docker_url in container environments, localhost otherwise.
    Detection: if the hostname is a bare service name (no dots, not localhost)
    we optimistically try docker first and fall back at call-time.
    This function just returns the primary URL; callers catch exceptions.
    """
    return docker_url


async def _proxy_get(url: str, fallback_url: str) -> dict | None:
    """GET url, fall back to fallback_url on connection failure."""
    for target in (url, fallback_url):
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                resp = await client.get(target)
                return {"data": resp.content, "status": resp.status_code,
                        "headers": dict(resp.headers)}
        except Exception:
            continue
    return None


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


# ── MantisEnv Proxy ────────────────────────────────────────────

@app.api_route("/api/v1/mantis-env/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_mantis_env(request: Request, path: str):
    target = f"{MANTIS_ENV_URL}/api/v1/{path}"
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
                content=f'{{"detail":"MantisEnv unreachable: {str(e)}"}}',
                status_code=502,
                media_type="application/json"
            )

    safe_headers = {k: v for k, v in resp.headers.items()
                    if k.lower() not in ("transfer-encoding", "content-encoding", "content-length")}
    return Response(content=resp.content, status_code=resp.status_code, headers=safe_headers)


@app.get("/api/v1/ledger")
async def proxy_token_breaker_ledger():
    """Fetch the TokenBreaker budget ledger, with localhost fallback."""
    docker_url = f"{TOKEN_BREAKER_URL}/api/v1/ledger"
    local_url  = "http://localhost:5002/api/v1/ledger"
    result = await _proxy_get(docker_url, local_url)
    if result is None:
        return Response(
            content='{"detail":"TokenBreaker unreachable"}',
            status_code=502,
            media_type="application/json"
        )
    safe_headers = {k: v for k, v in result["headers"].items()
                    if k.lower() not in ("transfer-encoding", "content-encoding", "content-length")}
    return Response(content=result["data"], status_code=result["status"], headers=safe_headers)


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "core-api"}


@app.api_route("/v1/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_v1_gateway(request: Request, path: str):
    target_url = request.headers.get("x-target-url") or request.headers.get("X-Target-Url")
    if not target_url:
        return JSONResponse(
            content={"detail": "Missing X-Target-Url header"},
            status_code=400
        )

    # Copy headers except Host, Content-Length, and X-Target-Url
    headers = {}
    for k, v in request.headers.items():
        k_lower = k.lower()
        if k_lower not in ("host", "content-length", "x-target-url"):
            headers[k] = v

    body = await request.body()
    content_type = request.headers.get("content-type", "")

    # Intercept and optimize JSON payload
    if "application/json" in content_type and body:
        try:
            payload = json.loads(body)
            optimized_payload = PromptOptimizer.optimize(payload, dict(request.headers))
            body = json.dumps(optimized_payload).encode("utf-8")
        except Exception:
            pass

    # Check if streaming response is requested
    is_stream = False
    if "application/json" in content_type and body:
        try:
            payload = json.loads(body)
            if payload.get("stream") is True:
                is_stream = True
        except Exception:
            pass

    accept_header = request.headers.get("accept", "")
    if "text/event-stream" in accept_header:
        is_stream = True

    # Forward the request
    client_timeout = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=5.0)

    if is_stream:
        async def stream_generator():
            try:
                async with httpx.AsyncClient(timeout=client_timeout) as client:
                    async with client.stream(
                        request.method,
                        target_url,
                        headers=headers,
                        content=body,
                    ) as resp:
                        async for chunk in resp.aiter_raw():
                            yield chunk
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n".encode("utf-8")

        sse_headers = {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
        return StreamingResponse(stream_generator(), headers=sse_headers)
    else:
        try:
            async with httpx.AsyncClient(timeout=client_timeout) as client:
                resp = await client.request(
                    request.method,
                    target_url,
                    headers=headers,
                    content=body,
                )
            
            # Exclude hop-by-hop headers
            safe_headers = {}
            for k, v in resp.headers.items():
                k_lower = k.lower()
                if k_lower not in ("transfer-encoding", "content-encoding", "content-length", "connection"):
                    safe_headers[k] = v

            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers=safe_headers,
                media_type=resp.headers.get("content-type")
            )
        except Exception as e:
            return JSONResponse(
                content={"detail": f"Gateway request failed: {str(e)}"},
                status_code=502
            )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
