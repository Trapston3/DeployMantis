"""
DeployMantis Reliability Suite — Orchestrator Router
==============================================
Provides container lifecycle management and health probing
for all services in the DeployMantis Docker Compose cluster.
"""

import os
import logging
import httpx
from fastapi import APIRouter, HTTPException
from typing import Optional

logger = logging.getLogger("deploymantis.orchestrator")

router = APIRouter()

# ── Service Registry ──────────────────────────────────────────
# Maps service names to their internal URLs and compose service names.
_SERVICES = {
    "strata":        {"url": "http://strata:3000",        "container": "ai-suite-strata-1"},
    "deploymantis-env":     {"url": "http://deploymantis-env:8000",     "container": "ai-suite-deploymantis-env-1"},
    "core-api":      {"url": "http://localhost:4000",      "container": "ai-suite-core-api-1"},
    "swarm-chaos":   {"url": "http://swarm-chaos:5000",   "container": "ai-suite-swarm-chaos-1"},
    "vault-guard":   {"url": "http://vault-guard:5001",   "container": "ai-suite-vault-guard-1"},
    "token-breaker": {"url": "http://token-breaker:5002", "container": "ai-suite-token-breaker-1"},
    "deploymantis-dash":    {"url": "http://deploymantis-dash:3000",    "container": "ai-suite-deploymantis-dash-1"},
}

# ── Health Probing (lightweight — no Docker SDK dependency) ───

async def _probe_service(name: str, info: dict) -> dict:
    """Probe a service's /health endpoint and return status."""
    # Don't probe ourselves
    if name == "core-api":
        return {"name": name, "status": "online", "container": info["container"]}

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{info['url']}/health")
            if resp.status_code == 200:
                return {"name": name, "status": "online", "container": info["container"], "detail": resp.json()}
            else:
                return {"name": name, "status": "degraded", "container": info["container"], "statusCode": resp.status_code}
    except httpx.ConnectError:
        return {"name": name, "status": "offline", "container": info["container"]}
    except Exception as e:
        return {"name": name, "status": "unknown", "container": info["container"], "error": str(e)}


@router.get("/status")
async def get_all_status():
    """Returns health status for all services in the cluster."""
    import asyncio
    tasks = [_probe_service(name, info) for name, info in _SERVICES.items()]
    results = await asyncio.gather(*tasks)
    return {"services": results}


@router.get("/status/{service_name}")
async def get_service_status(service_name: str):
    """Returns health status for a specific service."""
    info = _SERVICES.get(service_name)
    if not info:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service_name}")
    return await _probe_service(service_name, info)


@router.get("/stats")
async def get_node_stats():
    """Returns resource usage stats (CPU/Memory) for all containers."""
    client = _get_docker_client()
    stats_data = []
    
    try:
        containers = client.containers.list()
        for container in containers:
            # Only track containers that are part of the deploymantis cluster
            if "ai-suite" in container.name:
                try:
                    stats = container.stats(stream=False)
                    
                    # Calculate CPU %
                    cpu_delta = stats['cpu_stats']['cpu_usage']['total_usage'] - stats['precpu_stats']['cpu_usage']['total_usage']
                    system_cpu_delta = stats['cpu_stats']['system_cpu_usage'] - stats['precpu_stats']['system_cpu_usage']
                    number_cpus = stats['cpu_stats'].get('online_cpus', len(stats['cpu_stats']['cpu_usage'].get('percpu_usage', [1])))
                    cpu_percent = 0.0
                    if system_cpu_delta > 0.0 and cpu_delta > 0.0:
                        cpu_percent = (cpu_delta / system_cpu_delta) * number_cpus * 100.0

                    # Calculate Memory %
                    mem_usage = stats['memory_stats'].get('usage', 0)
                    mem_limit = stats['memory_stats'].get('limit', 1)
                    mem_percent = (mem_usage / mem_limit) * 100.0
                    
                    stats_data.append({
                        "name": container.name.replace("ai-suite-", "").replace("-1", ""),
                        "cpu_percent": round(cpu_percent, 2),
                        "mem_percent": round(mem_percent, 2)
                    })
                except Exception as e:
                    logger.warning("Failed to get stats for %s: %s", container.name, e)
    except Exception as e:
        logger.error("Failed to list containers for stats: %s", e)
        # If docker isn't available, return empty rather than breaking the UI
        return {"stats": []}
        
    return {"stats": stats_data}


# ── Container Lifecycle (uses Docker SDK when available) ──────

def _get_docker_client():
    """Lazily import and create Docker client."""
    try:
        import docker
        return docker.from_env()
    except ImportError:
        raise HTTPException(status_code=501, detail="Docker SDK not installed. Run: pip install docker")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Cannot connect to Docker daemon: {str(e)}")


@router.post("/restart/{service_name}")
async def restart_service(service_name: str):
    """Restart a specific container."""
    info = _SERVICES.get(service_name)
    if not info:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service_name}")
    if service_name == "core-api":
        raise HTTPException(status_code=400, detail="Cannot restart self (core-api)")

    client = _get_docker_client()
    try:
        container = client.containers.get(info["container"])
        container.restart(timeout=10)
        logger.info("Restarted container: %s", info["container"])
        return {"message": f"Restarted {service_name}", "container": info["container"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to restart {service_name}: {str(e)}")


@router.post("/start/{service_name}")
async def start_service(service_name: str):
    """Start a stopped container."""
    info = _SERVICES.get(service_name)
    if not info:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service_name}")

    client = _get_docker_client()
    try:
        container = client.containers.get(info["container"])
        container.start()
        logger.info("Started container: %s", info["container"])
        return {"message": f"Started {service_name}", "container": info["container"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start {service_name}: {str(e)}")


@router.post("/stop/{service_name}")
async def stop_service(service_name: str):
    """Stop a running container."""
    info = _SERVICES.get(service_name)
    if not info:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service_name}")
    if service_name == "core-api":
        raise HTTPException(status_code=400, detail="Cannot stop self (core-api)")

    client = _get_docker_client()
    try:
        container = client.containers.get(info["container"])
        container.stop(timeout=10)
        logger.info("Stopped container: %s", info["container"])
        return {"message": f"Stopped {service_name}", "container": info["container"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to stop {service_name}: {str(e)}")
