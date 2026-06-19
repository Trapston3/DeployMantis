# core-api/test_mantis_style.py
import os
import sys
import pytest
import json
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

# Add core-api to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import app
from db import mantis_style_store
from services.prompt_optimizer import PromptOptimizer

client = TestClient(app)


def test_db_setup_on_import():
    # Verify database file is created
    db_path = os.path.join(os.path.dirname(__file__), "data", "mantis_style.db")
    assert os.path.exists(db_path)


def test_prompt_optimizer_injection():
    # 1. Seed a fake style profile in SQLite database
    fake_profile = {
        "naming": {
            "functions": "snake_case",
            "classes": "PascalCase",
            "constants": "UPPER_SNAKE"
        },
        "error_handling": {
            "prefer_explicit": True
        },
        "docstrings": {
            "style": "google",
            "coverage": 0.65
        }
    }
    mantis_style_store.store_profile(json.dumps(fake_profile))
    
    # 2. Call PromptOptimizer
    payload = {
        "messages": [
            {"role": "user", "content": "Write a class to check files."}
        ]
    }
    
    optimized = PromptOptimizer.optimize(payload)
    messages = optimized["messages"]
    
    # Ensure system style constraint is injected at index 0
    assert len(messages) == 2
    assert messages[0]["role"] == "system"
    assert "functions use snake_case" in messages[0]["content"]
    assert "classes use PascalCase" in messages[0]["content"]
    assert "constants use UPPER_SNAKE" in messages[0]["content"]
    assert "prefer explicit try/except" in messages[0]["content"]
    assert "use google-style docstrings" in messages[0]["content"]


def test_get_style_profile_endpoint():
    # Seed profile
    fake_profile = {
        "naming": {"functions": "camelCase", "classes": "PascalCase", "constants": "UPPER_SNAKE"},
        "error_handling": {"prefer_explicit": False},
        "docstrings": {"style": "sphinx", "coverage": 0.40}
    }
    mantis_style_store.store_profile(json.dumps(fake_profile))
    
    response = client.get("/api/v1/mantis-style/profile")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["profile"]["naming"]["functions"] == "camelCase"


@patch("httpx.AsyncClient.post")
def test_refresh_style_profile_endpoint(mock_post):
    # Mock return value from mantis-graph
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "naming": {"functions": "snake_case", "classes": "PascalCase", "constants": "UPPER_SNAKE"},
        "error_handling": {"prefer_explicit": True},
        "docstrings": {"style": "google", "coverage": 0.90}
    }
    mock_post.return_value = mock_resp
    
    response = client.post("/api/v1/mantis-style/refresh")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["profile"]["docstrings"]["coverage"] == 0.90
    
    # Verify it updated in the SQLite cache
    cached_profile_str = mantis_style_store.get_profile()
    assert cached_profile_str is not None
    cached = json.loads(cached_profile_str)
    assert cached["docstrings"]["coverage"] == 0.90
