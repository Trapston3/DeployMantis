# core-api/test_gateway_route.py
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

def test_missing_target_url():
    response = client.post("/v1/chat/completions", json={"message": "hello"})
    assert response.status_code == 400
    assert response.json()["detail"] == "Missing X-Target-Url header"

@patch("httpx.AsyncClient.request")
def test_successful_json_proxy_forwarding(mock_request):
    # Setup mock response
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = {"content-type": "application/json"}
    mock_resp.content = b'{"response": "hello back"}'
    
    mock_request.return_value = mock_resp
    
    payload = {
        "model": "gpt-4o",
        "messages": [
            {"role": "user", "content": "  hello  "}
        ]
    }
    
    headers = {
        "X-Target-Url": "https://api.openai.com/v1/chat/completions",
        "Authorization": "Bearer test-key"
    }
    
    response = client.post("/v1/chat/completions", json=payload, headers=headers)
    
    assert response.status_code == 200
    assert response.json()["response"] == "hello back"
    
    # Verify mock_request arguments
    mock_request.assert_called_once()
    args, kwargs = mock_request.call_args
    
    # The forwarded method and URL should be correct
    assert args[0] == "POST"
    assert args[1] == "https://api.openai.com/v1/chat/completions"
    
    # Authorization header should be forwarded, Host and X-Target-Url stripped
    forwarded_headers = kwargs["headers"]
    assert forwarded_headers["authorization"] == "Bearer test-key"
    assert "x-target-url" not in forwarded_headers
    assert "host" not in forwarded_headers
    
    # Body payload should be optimized (whitespace stripped, directive injected)
    forwarded_body = json.loads(kwargs["content"].decode("utf-8"))
    assert forwarded_body["messages"][0]["content"] == "hello\n\n(DeployMantis Directive: Think step-by-step and verify your logic before responding)"
