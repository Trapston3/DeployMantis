"""
MantisStyle Router — AST Style Profiler Interface
=================================================
Mounted at: /api/v1/mantis-style (registered in core-api/main.py)

Endpoints
---------
POST /api/v1/mantis-style/refresh
    Triggers profiling in mantis-graph, pulls the style metadata, and caches it
    locally in SQLite.

GET /api/v1/mantis-style/profile
    Retrieves the current cached style profile.
"""

import json
import logging
import os
import httpx
import asyncio
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from db.mantis_style_store import init_db, store_profile, get_profile

logger = logging.getLogger("deploymantis.mantis_style")

router = APIRouter()

# ── Initialise DB on router import ────────────────────────────
init_db()

_GRAPH_URL = os.getenv("MANTIS_GRAPH_URL", "http://mantis-graph:5003")
_GRAPH_FALLBACK = "http://localhost:5003"


class RefreshResponse(BaseModel):
    status: str
    profile: Optional[Dict[str, Any]] = None
    message: Optional[str] = None


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_style_profile(force: bool = False):
    """
    Trigger AST style profiling inside mantis-graph and cache the result locally.
    
    If mantis-graph is unreachable, returns HTTP 200 with degraded state.
    """
    targets = [f"{_GRAPH_URL}/style-profile", f"{_GRAPH_FALLBACK}/style-profile"]
    payload = {"force": force}
    
    profile = None
    success = False
    error_msg = ""
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        for target in targets:
            try:
                resp = await client.post(target, json=payload)
                if resp.status_code == 200:
                    profile = resp.json()
                    success = True
                    break
                else:
                    error_msg = f"Graph returned status {resp.status_code}"
            except Exception as e:
                error_msg = str(e)
                continue
                
    if success and profile:
        profile_json = json.dumps(profile)
        # Store profile asynchronously
        await asyncio.to_thread(store_profile, profile_json)
        return RefreshResponse(
            status="success",
            profile=profile,
            message="Style profile successfully refreshed and cached."
        )
    else:
        # Gracefully degrade instead of failing with 5xx
        logger.warning("MantisStyle refresh failed: %s", error_msg)
        return RefreshResponse(
            status="warning",
            profile=None,
            message=f"Could not reach mantis-graph to refresh style profile. Error: {error_msg}"
        )


@router.get("/profile")
async def get_cached_style_profile():
    """
    Retrieve the current cached style profile from SQLite.
    """
    profile_json = await asyncio.to_thread(get_profile)
    if not profile_json:
        return JSONResponse(
            content={"status": "not_cached", "profile": None, "message": "No style profile has been cached yet. Run /refresh first."},
            status_code=200
        )
        
    try:
        profile = json.loads(profile_json)
        return {"status": "success", "profile": profile}
    except Exception:
        logger.error("MantisStyle: Cache data in DB is corrupted.")
        return JSONResponse(
            content={"status": "error", "profile": None, "message": "Corrupted style cache found in database."},
            status_code=200
        )
