# core-api/test_inference_guardrails.py
import pytest
import sys
import os
import json
from unittest.mock import AsyncMock, patch, MagicMock

# Add core-api to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

@pytest.mark.anyio
@patch("services.llm_gateway.gateway.generate", new_callable=AsyncMock)
@patch("routers.inference.guard", new_callable=AsyncMock)
@patch("routers.inference.verify", new_callable=AsyncMock)
@patch("httpx.AsyncClient.post", new_callable=AsyncMock)
async def test_generate_without_diff(mock_strata_post, mock_verify, mock_guard, mock_generate):
    # Setup mocks
    mock_generate.return_value = "This is a safe response without code."
    
    # Mock MantisGuard Response
    mock_guard_resp = MagicMock()
    mock_guard_resp.body = b'{"status": "SAFE", "reasons": ["Safe content"], "trust_signals": {"convention_match": 1.0, "reuse_score": 1.0, "risk_score": 0.0}, "secret_findings": []}'
    mock_guard.return_value = mock_guard_resp

    # Make request
    response = client.post("/api/v1/inference/generate", json={"prompt": "Hello", "system_prompt": ""})
    
    assert response.status_code == 200
    data = response.json()
    assert data["response"] == "This is a safe response without code."
    assert data["mantis_guard"]["status"] == "SAFE"
    assert "mantis_verify" not in data
    
    # Verify guard called with content and no diff
    mock_guard.assert_called_once()
    assert mock_guard.call_args[0][0].content == "This is a safe response without code."
    assert mock_guard.call_args[0][0].diff is None
    
    # Verify verify not called
    mock_verify.assert_not_called()
    
    # Verify Strata push was called
    mock_strata_post.assert_called_once()


@pytest.mark.anyio
@patch("services.llm_gateway.gateway.generate", new_callable=AsyncMock)
@patch("routers.inference.guard", new_callable=AsyncMock)
@patch("routers.inference.verify", new_callable=AsyncMock)
@patch("httpx.AsyncClient.post", new_callable=AsyncMock)
async def test_generate_with_diff(mock_strata_post, mock_verify, mock_guard, mock_generate):
    # Setup response containing a diff
    diff_content = "--- a/file.py\n+++ b/file.py\n@@ -1,1 +1,2 @@\n-old\n+new"
    mock_generate.return_value = f"Here is the code change:\n```diff\n{diff_content}\n```"
    
    # Mock MantisGuard Response
    mock_guard_resp = MagicMock()
    mock_guard_resp.body = b'{"status": "SAFE", "reasons": ["Safe content"], "trust_signals": {"convention_match": 1.0, "reuse_score": 1.0, "risk_score": 0.0}, "secret_findings": []}'
    mock_guard.return_value = mock_guard_resp

    # Mock MantisVerify Response
    mock_verify_resp = MagicMock()
    mock_verify_resp.body = b'{"status": "PASS", "reasons": ["Code conforms"], "signals": {"convention_match": 1.0, "reuse_score": 1.0, "risk_score": 0.0}, "notes": []}'
    mock_verify.return_value = mock_verify_resp

    # Make request
    response = client.post("/api/v1/inference/generate", json={"prompt": "Hello", "system_prompt": ""})
    
    assert response.status_code == 200
    data = response.json()
    assert data["mantis_guard"]["status"] == "SAFE"
    assert data["mantis_verify"]["status"] == "PASS"
    
    # Verify both called with correct args
    mock_guard.assert_called_once()
    assert mock_guard.call_args[0][0].diff == diff_content
    mock_verify.assert_called_once()
    assert mock_verify.call_args[0][0].diff == diff_content


@pytest.mark.anyio
@patch("services.llm_gateway.gateway.generate", new_callable=AsyncMock)
@patch("routers.inference.guard", new_callable=AsyncMock)
@patch("routers.inference.verify", new_callable=AsyncMock)
@patch("httpx.AsyncClient.post", new_callable=AsyncMock)
async def test_generate_with_guardrail_failure_degradation(mock_strata_post, mock_verify, mock_guard, mock_generate):
    # Force guard to throw exception (e.g. backend down)
    mock_generate.return_value = "Some output"
    mock_guard.side_effect = Exception("Service unavailable")

    response = client.post("/api/v1/inference/generate", json={"prompt": "Hello", "system_prompt": ""})
    
    # Assert response succeeds with HTTP 200 and falls back to REVIEW
    assert response.status_code == 200
    data = response.json()
    assert data["response"] == "Some output"
    assert data["mantis_guard"]["status"] == "REVIEW"
    assert data["mantis_guard"]["reasons"] == ["Guardrail unavailable"]
