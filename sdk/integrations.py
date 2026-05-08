"""
DeployMantis Reliability Suite — FastAPI Integration
===========================================
Provides FastAPIDeployMantisMiddleware to automatically capture and forward
HTTP requests and responses to the DeployMantis Core API for BYOD telemetry.
"""

import os
import time
import json
import logging
import asyncio
import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request, Response

logger = logging.getLogger("deploymantis.sdk")

# The Core API ingest endpoint. In a real environment, this should point
# to the DeployMantis Core API (e.g., http://localhost:4000/api/v1/ingest/custom-trace)
DEPLOYMANTIS_INGEST_URL = os.getenv("DEPLOYMANTIS_INGEST_URL", "http://localhost:4000/api/v1/ingest/custom-trace")
DEPLOYMANTIS_SERVICE_NAME = os.getenv("DEPLOYMANTIS_SERVICE_NAME", "fastapi-app")

class FastAPIDeployMantisMiddleware(BaseHTTPMiddleware):
    """
    Middleware that intercepts requests and responses, formats them into
    DeployMantis custom traces, and pushes them to the ingest API asynchronously.
    """
    def __init__(self, app, service_name: str = None, ingest_url: str = None):
        super().__init__(app)
        self.service_name = service_name or DEPLOYMANTIS_SERVICE_NAME
        self.ingest_url = ingest_url or DEPLOYMANTIS_INGEST_URL
        self._client = httpx.AsyncClient(timeout=5.0)

    async def dispatch(self, request: Request, call_next):
        start_time = time.monotonic()
        
        # Read request body
        req_body = None
        try:
            # We must consume the body and then replace the stream
            body_bytes = await request.body()
            if body_bytes:
                try:
                    req_body = json.loads(body_bytes)
                except json.JSONDecodeError:
                    req_body = {"raw": body_bytes.decode("utf-8", errors="replace")}
            
            # Reconstruct the request so downstream routes can still read it
            async def receive():
                return {"type": "http.request", "body": body_bytes}
            request._receive = receive
        except Exception as e:
            logger.debug(f"Failed to read request body: {e}")

        # Capture headers
        req_headers = dict(request.headers)
        
        # Call the next middleware/route
        try:
            response: Response = await call_next(request)
            status_code = response.status_code
        except Exception as e:
            # If an unhandled exception occurs, assume 500
            status_code = 500
            raise e
        finally:
            end_time = time.monotonic()
            response_time_ms = (end_time - start_time) * 1000

            # Construct the trace payload
            trace = {
                "service": self.service_name,
                "level": "error" if status_code >= 400 else "info",
                "message": f"{request.method} {request.url.path} -> {status_code} in {response_time_ms:.2f}ms",
                "method": request.method,
                "path": request.url.path,
                "status": status_code,
                "responseTime": response_time_ms,
                "headers": req_headers,
            }
            if req_body:
                trace["body"] = req_body

            # Push asynchronously so we don't block the actual response
            asyncio.create_task(self._push_trace(trace))
            
        return response

    async def _push_trace(self, trace: dict):
        payload = {"traces": [trace]}
        try:
            response = await self._client.post(self.ingest_url, json=payload)
            if response.status_code >= 400:
                logger.debug(f"DeployMantis ingest failed: {response.text}")
        except Exception as e:
            logger.debug(f"DeployMantis ingest connection error: {e}")
