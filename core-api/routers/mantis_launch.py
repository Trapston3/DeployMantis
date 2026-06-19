"""
MantisLaunch Router — Environment Orchestrator
===============================================
Mounted at: /api/v1/mantis-launch (registered in core-api/main.py)

Endpoints
---------
POST /api/v1/mantis-launch/run
    Trigger launch / verification sequence. Checks ports, reachability of
    dependencies, and logs the environment snapshot.
    Returns HTTP 200 (run + maybe reuse snapshot).

GET /api/v1/mantis-launch/snapshots
    Returns a list of all stored snapshots (returning hashes and timestamps).

GET /api/v1/mantis-launch/snapshots/{snapshot_hash}
    Returns a full environment snapshot metadata by hash.
"""

import asyncio
import hashlib
import json
import logging
import os
import socket
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from db.mantis_launch_store import (
    get_snapshot,
    init_db,
    insert_snapshot,
    list_snapshots,
)

logger = logging.getLogger("deploymantis.mantis_launch")

router = APIRouter()

# ── Initialise DB on router load ──────────────────────────────
# Called at import time to ensure the table and indices exist.
init_db()

# ── Service Registry Details ──────────────────────────────────
# Default ports on local host
DEFAULT_PORTS = {
    "strata": 3002,
    "mantis-env": 8000,
    "core-api": 4000,
    "swarm-chaos": 5000,
    "vault-guard": 5001,
    "token-breaker": 5002,
    "mantis-dash": 3001,
    "fallback-mesh": 5004,
    "mantis-graph": 5003,
}

# Docker network base URLs mapping
DOCKER_URLS = {
    "strata": "http://strata:3000",
    "mantis-env": "http://mantis-env:8000",
    "core-api": "http://localhost:4000",
    "swarm-chaos": "http://swarm-chaos:5000",
    "vault-guard": "http://vault-guard:5001",
    "token-breaker": "http://token-breaker:5002",
    "mantis-dash": "http://deploymantis-dash:3000",
    "fallback-mesh": "http://fallback-mesh:5004",
    "mantis-graph": "http://mantis-graph:5003",
}

# ── Pydantic models ───────────────────────────────────────────

class LaunchRequest(BaseModel):
    config_override: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional service and port configuration dictionary to override defaults."
    )
    allow_start: bool = Field(
        default=False,
        description="If True, attempts to automatically start offline service containers using Docker."
    )


class ServiceStep(BaseModel):
    service: str = Field(..., description="Name of the service checked or launched.")
    status: str = Field(..., description="Status of the operation: e.g., online, launched, offline, failed.")
    message: str = Field(..., description="Details regarding the check or action.")


class LaunchResponse(BaseModel):
    status: str = Field(..., description="Overall launch run status (success, warning, failed).")
    steps: List[ServiceStep] = Field(..., description="Verification steps completed during launch.")
    snapshot_hash: str = Field(..., description="SHA-256 hash of the environment snapshot metadata.")
    snapshot: Dict[str, Any] = Field(..., description="Full environment metadata snapshot.")


class SnapshotListItem(BaseModel):
    snapshot_hash: str
    captured_at: str


class SnapshotDetails(BaseModel):
    snapshot_hash: str
    captured_at: str
    snapshot: Dict[str, Any]


# ── Snapshot Hashing helper ───────────────────────────────────

def compute_snapshot_hash(snapshot_data: Dict[str, Any]) -> str:
    """
    Computes a SHA-256 hash of the snapshot metadata dictionary.
    
    The snapshot data must contain:
      - service_versions: Dict[str, str] (e.g. {'core-api': '1.0.0'})
      - ports: Dict[str, int] (e.g. {'core-api': 4000})
      - env_names: List[str] (list of environmental variable names captured)
      
    This function sorts keys in the JSON representation to ensure deterministic hashing.
    """
    serialized = json.dumps(snapshot_data, sort_keys=True).encode("utf-8")
    return hashlib.sha256(serialized).hexdigest()


# ── Service Check Logic Helper ────────────────────────────────

async def _check_service(service: str, host_port: int, docker_url: str, allow_start: bool) -> tuple[ServiceStep, str]:
    """
    Checks if a service is running by probing its health routes.
    If offline, performs port conflict checks and optional Docker container start.
    
    Returns (ServiceStep, version_string).
    """
    # 1. Probe health checks on container network and localhost
    # Strata and mantis-dash might respond to different URLs or paths
    urls_to_try = [docker_url, f"http://localhost:{host_port}", f"http://127.0.0.1:{host_port}"]
    
    is_healthy = False
    version = "unknown"
    details = ""
    
    async with httpx.AsyncClient(timeout=2.0) as client:
        for url in urls_to_try:
            try:
                # Probing health check path, fallback to base URL for nextjs/dash
                probe_url = f"{url}/health" if service != "mantis-dash" else url
                resp = await client.get(probe_url)
                if resp.status_code == 200:
                    is_healthy = True
                    details = f"Reachable at {url}"
                    try:
                        resp_data = resp.json()
                        version = resp_data.get("version", resp_data.get("service_version", "1.0.0"))
                    except Exception:
                        version = "1.0.0"
                    break
            except Exception:
                continue

    if is_healthy:
        return ServiceStep(
            service=service,
            status="online",
            message=f"Service is online and healthy. {details}"
        ), version

    # 2. Port conflict check (if port is open but health check failed)
    port_occupied = False
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex(("127.0.0.1", host_port)) == 0:
                port_occupied = True
    except Exception:
        pass

    if port_occupied:
        return ServiceStep(
            service=service,
            status="failed",
            message=f"Port conflict: Port {host_port} is occupied, but health probe failed (service may be degraded)."
        ), version

    # 3. Port is free, service is offline. Try starting it via Docker if allowed.
    if not allow_start:
        return ServiceStep(
            service=service,
            status="offline",
            message=f"Service is offline (port {host_port} is free). Auto-start disabled."
        ), version

    # Attempt to start container via docker SDK (imported inside function to keep optional)
    try:
        import docker
        client_docker = docker.from_env()
        
        # Check candidate container names
        candidate_names = [service, f"ai-suite-{service}-1", f"ai-suite_{service}_1"]
        container = None
        for name in candidate_names:
            try:
                container = client_docker.containers.get(name)
                break
            except docker.errors.NotFound:
                continue
                
        if container is None:
            return ServiceStep(
                service=service,
                status="offline",
                message=f"Service is offline. Docker container not found (tried candidate names: {', '.join(candidate_names)})."
            ), version
            
        if container.status == "running":
            return ServiceStep(
                service=service,
                status="failed",
                message="Container is running in Docker, but health check failed (service may be degraded)."
            ), version
            
        # Start the container
        container.start()
        await asyncio.sleep(2.0)  # brief wait for service to boot
        
        # Re-probe health
        is_healthy_now = False
        async with httpx.AsyncClient(timeout=2.0) as client:
            for url in urls_to_try:
                try:
                    probe_url = f"{url}/health" if service != "mantis-dash" else url
                    resp = await client.get(probe_url)
                    if resp.status_code == 200:
                        is_healthy_now = True
                        try:
                            resp_data = resp.json()
                            version = resp_data.get("version", resp_data.get("service_version", "1.0.0"))
                        except Exception:
                            version = "1.0.0"
                        break
                except Exception:
                    continue
                    
        if is_healthy_now:
            return ServiceStep(
                service=service,
                status="launched",
                message="Service started successfully via Docker."
            ), version
        else:
            return ServiceStep(
                service=service,
                status="failed",
                message="Container started via Docker, but service failed post-start health checks."
            ), version
            
    except ImportError:
        return ServiceStep(
            service=service,
            status="offline",
            message=f"Docker SDK not available; skipping auto-start for {service}."
        ), version
    except Exception as e:
        return ServiceStep(
            service=service,
            status="offline",
            message=f"Docker daemon not running; skipping auto-start for {service}. Error: {str(e)}"
        ), version


# ── Endpoints ─────────────────────────────────────────────────

@router.post("/run", response_model=LaunchResponse, status_code=200)
async def run_launch(body: LaunchRequest):
    """
    Trigger the launch and validation sequence.
    
    Checks port availability, reachability of dependent services, and
    spawns any missing services (if allow_start=True).
    
    Returns HTTP 200 (Run + maybe reuse existing snapshot).
    """
    # 1. Resolve configuration with any overrides
    ports = DEFAULT_PORTS.copy()
    if body.config_override and "ports" in body.config_override:
        ports.update(body.config_override["ports"])
        
    # Order service checks: independent first, followed by dependent services
    execution_order = [
        "strata",
        "mantis-env",
        "vault-guard",
        "token-breaker",
        "fallback-mesh",
        "mantis-graph",
        "swarm-chaos",
        "mantis-dash"
    ]
    
    steps = []
    service_versions = {}
    
    # 2. Check each service sequentially
    for service in execution_order:
        host_port = ports[service]
        docker_url = DOCKER_URLS[service]
        
        step, version = await _check_service(
            service=service,
            host_port=host_port,
            docker_url=docker_url,
            allow_start=body.allow_start
        )
        steps.append(step)
        service_versions[service] = version
        
    # Include self (core-api) status
    steps.append(
        ServiceStep(
            service="core-api",
            status="online",
            message="core-api is online (self)."
        )
    )
    service_versions["core-api"] = "1.0.0"
    
    # 3. Determine overall run status
    # success: all services are online/launched/self
    # failed: any service has failed
    # warning: some services are offline (port free, no conflict)
    overall_status = "success"
    if any(step.status == "failed" for step in steps):
        overall_status = "failed"
    elif any(step.status == "offline" for step in steps):
        overall_status = "warning"
        
    # 4. Environment snapshot vars
    target_env_vars = [
        "MANTIS_ENV_PORT",
        "CORE_API_PORT",
        "STRATA_PORT",
        "CUSTOM_MODEL_NAME",
        "INFERENCE_PROVIDER",
    ]
    
    snapshot_data = {
        "service_versions": service_versions,
        "ports": ports,
        "env_names": [var for var in target_env_vars if var in os.environ] or ["CUSTOM_MODEL_NAME", "INFERENCE_PROVIDER"],
    }
    
    snapshot_hash = compute_snapshot_hash(snapshot_data)
    captured_at = datetime.now(timezone.utc).isoformat()
    
    # Store snapshot
    snapshot_json = json.dumps(snapshot_data, ensure_ascii=False)
    await insert_snapshot(snapshot_hash, captured_at, snapshot_json)
    
    return LaunchResponse(
        status=overall_status,
        steps=steps,
        snapshot_hash=snapshot_hash,
        snapshot=snapshot_data
    )


@router.get("/snapshots", response_model=List[SnapshotListItem])
async def get_snapshots():
    """
    List all stored environment snapshots.
    
    Returns a list of objects containing only the snapshot_hash and captured_at timestamp.
    """
    rows = await list_snapshots()
    return [
        SnapshotListItem(
            snapshot_hash=row["snapshot_hash"],
            captured_at=row["captured_at"]
        ) for row in rows
    ]


@router.get("/snapshots/{snapshot_hash}", response_model=SnapshotDetails)
async def get_snapshot_details(snapshot_hash: str):
    """
    Retrieve the full details of a specific snapshot by its SHA-256 hash.
    """
    row = await get_snapshot(snapshot_hash)
    if not row:
        raise HTTPException(status_code=404, detail=f"Snapshot with hash '{snapshot_hash}' not found.")
        
    try:
        snapshot_data = json.loads(row["snapshot_json"])
    except Exception:
        raise HTTPException(status_code=500, detail="Corrupted snapshot data stored in database.")
        
    return SnapshotDetails(
        snapshot_hash=row["snapshot_hash"],
        captured_at=row["captured_at"],
        snapshot=snapshot_data
    )
