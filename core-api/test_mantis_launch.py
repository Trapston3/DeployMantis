# core-api/test_mantis_launch.py
import os
import sys
import pytest
import json
import hashlib
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

# Add core-api to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import app
from db import mantis_launch_store

client = TestClient(app)


def test_db_setup_on_import():
    # Verify that the DB file is created in data/
    db_path = os.path.join(os.path.dirname(__file__), "data", "mantis_launch.db")
    assert os.path.exists(db_path), "Database file should exist"


@patch("httpx.AsyncClient.get")
def test_run_launch_endpoint_success(mock_get):
    # Mock all health checks to succeed
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"status": "ok", "version": "1.2.3"}
    mock_get.return_value = mock_resp

    # Trigger launch run
    response = client.post("/api/v1/mantis-launch/run", json={"config_override": None, "allow_start": False})
    assert response.status_code == 200
    
    data = response.json()
    assert data["status"] == "success"
    assert "steps" in data
    assert len(data["steps"]) > 0
    assert "snapshot_hash" in data
    assert "snapshot" in data
    
    # Check that all steps (excluding self) have "online" status
    for step in data["steps"]:
        if step["service"] != "core-api":
            assert step["status"] == "online"
            
    # Validate hash matches deterministic calculation of the snapshot
    snapshot = data["snapshot"]
    serialized = json.dumps(snapshot, sort_keys=True).encode("utf-8")
    expected_hash = hashlib.sha256(serialized).hexdigest()
    assert data["snapshot_hash"] == expected_hash, "Hash should be deterministic"


@patch("httpx.AsyncClient.get")
@patch("socket.socket.connect_ex")
def test_run_launch_degraded_states(mock_connect, mock_get):
    # Mock health check to fail (raise exception)
    mock_get.side_effect = Exception("Connection refused")
    # Mock port conflict: strata port (3002) is occupied (connect_ex returns 0)
    # others are free (connect_ex returns 111 or non-zero)
    def side_effect(address):
        if address[1] == 3002: # strata port
            return 0
        return 111
    mock_connect.side_effect = side_effect

    # Trigger launch run
    response = client.post("/api/v1/mantis-launch/run", json={"config_override": None, "allow_start": False})
    assert response.status_code == 200
    
    data = response.json()
    # Should be failed overall because strata has port conflict
    assert data["status"] == "failed"
    
    # Verify steps
    steps = {step["service"]: step for step in data["steps"]}
    assert steps["strata"]["status"] == "failed"
    assert "port conflict" in steps["strata"]["message"].lower()
    
    # Other services should be "offline"
    assert steps["vault-guard"]["status"] == "offline"
    assert "auto-start disabled" in steps["vault-guard"]["message"].lower()


@patch("httpx.AsyncClient.get")
@patch("socket.socket.connect_ex")
def test_run_launch_docker_autostart_failed(mock_connect, mock_get):
    # Mock health checks to fail
    mock_get.side_effect = Exception("Connection refused")
    # Mock ports to be free
    mock_connect.return_value = 111
    
    # Mock Docker SDK using sys.modules patching
    mock_docker = MagicMock()
    class NotFound(Exception):
        pass
    mock_docker.errors.NotFound = NotFound
    
    mock_docker_client = MagicMock()
    mock_docker_client.containers.get.side_effect = Exception("Docker daemon down")
    mock_docker.from_env.return_value = mock_docker_client
    
    with patch.dict("sys.modules", {"docker": mock_docker}):
        # Trigger launch run with allow_start=True
        response = client.post("/api/v1/mantis-launch/run", json={"config_override": None, "allow_start": True})
        assert response.status_code == 200
        
        data = response.json()
        # Should be "warning" overall because they are offline (no conflicts)
        assert data["status"] == "warning"
        
        steps = {step["service"]: step for step in data["steps"]}
        assert steps["strata"]["status"] == "offline"
        assert "daemon not running" in steps["strata"]["message"].lower()


def test_get_snapshots_list():
    # Seed a snapshot directly into the DB to avoid network timeout
    snapshot_data = {
        "service_versions": {"core-api": "1.0.0"},
        "ports": {"core-api": 4000},
        "env_names": [],
    }
    serialized = json.dumps(snapshot_data, sort_keys=True)
    h = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    mantis_launch_store.insert_snapshot(h, "2026-06-14T23:59:59Z", serialized)
    
    response = client.get("/api/v1/mantis-launch/snapshots")
    assert response.status_code == 200
    
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    found = False
    for item in data:
        assert "snapshot_hash" in item
        assert "captured_at" in item
        if item["snapshot_hash"] == h:
            found = True
    assert found


def test_get_snapshot_details_success():
    # Seed a snapshot directly into the DB to avoid network timeout
    snapshot_data = {
        "service_versions": {"core-api": "1.0.0"},
        "ports": {"core-api": 4000},
        "env_names": [],
    }
    serialized = json.dumps(snapshot_data, sort_keys=True)
    h = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    mantis_launch_store.insert_snapshot(h, "2026-06-14T23:59:59Z", serialized)
    
    # Retrieve details
    resp = client.get(f"/api/v1/mantis-launch/snapshots/{h}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["snapshot_hash"] == h
    assert "captured_at" in data
    assert data["snapshot"] == snapshot_data


def test_get_snapshot_details_not_found():
    unknown_hash = "a" * 64
    resp = client.get(f"/api/v1/mantis-launch/snapshots/{unknown_hash}")
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()
