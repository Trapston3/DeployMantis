import os
import logging
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from auth import key_store
from billing import billing_store

logger = logging.getLogger("deploymantis.auth.middleware")

class BillingMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp):
        super().__init__(app)
        # Determine if authentication is strictly required (defaults to False)
        self.auth_required = os.getenv("DEPLOYMANTIS_AUTH_REQUIRED", "false").lower() == "true"

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        method = request.method

        # 1. Bypass authentication/billing checks for health, webhooks, and CORS preflight
        if path == "/health" or path == "/api/v1/billing/webhook" or method == "OPTIONS":
            return await call_next(request)

        # 2. Extract Authorization Header
        auth_header = request.headers.get("Authorization")
        tenant_id = None
        scopes = []
        org_name = "Anonymous Org"
        api_key = None

        if auth_header and auth_header.startswith("Bearer "):
            api_key = auth_header.split(" ")[1]

        # 3. Resolve Tenant details
        tenant_record = None
        if api_key:
            tenant_record = await key_store.lookup_key(api_key)

        if not tenant_record:
            if self.auth_required:
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Authentication required. Invalid or missing API key."}
                )
            else:
                # Key-optional fallback to Hobbyist/Free defaults
                tenant_id = "anonymous"
                scopes = ["snap", "launch"]
                org_name = "Anonymous Org"
        else:
            tenant_id = tenant_record["tenant_id"]
            scopes = tenant_record["scopes"]
            org_name = tenant_record["org_name"]

        # 4. Resolve Billing details from org_billing database
        plan = "hobbyist"
        status = "active"
        seats_purchased = 1

        if tenant_id and tenant_id != "anonymous":
            billing = await billing_store.get_billing(tenant_id)
            if billing:
                plan = billing.get("plan", "hobbyist")
                status = billing.get("status", "active")
                seats_purchased = billing.get("seats_purchased", 1)

        # 5. Populate request state for routers
        request.state.tenant_id = tenant_id
        request.state.plan = plan
        request.state.scopes = scopes
        request.state.org_name = org_name
        request.state.seats_purchased = seats_purchased

        # 6. Enforce Tier Limits (Upgrade blocks)
        # Block hobbyist (free) plan from Team-only endpoints: mantis-verify, mantis-style, audit
        is_team_only_route = (
            "mantis-verify" in path 
            or "mantis-style" in path 
            or "audit" in path
        )

        if plan == "hobbyist" and is_team_only_route:
            return JSONResponse(
                status_code=402,
                content={
                    "detail": "Upgrade required. This feature requires the Developer or Team plan.",
                    "upgrade_url": "/billing"
                }
            )

        # 7. Enforce Seats count for Team plan
        if plan == "team":
            # Active seats are determined by the number of API keys generated for this tenant
            active_seats = 1
            if tenant_id and tenant_id != "anonymous":
                try:
                    active_seats = await key_store.count_tenant_keys(tenant_id)
                except Exception as e:
                    logger.error(f"Error querying active seats: {e}")
                    
            if active_seats > seats_purchased:
                return JSONResponse(
                    status_code=402,
                    content={
                        "detail": f"Seat limit exceeded. Active seats ({active_seats}) exceeds seats purchased ({seats_purchased}).",
                        "upgrade_url": "/billing"
                    }
                )

        # 8. Proceed with request
        response = await call_next(request)
        return response
