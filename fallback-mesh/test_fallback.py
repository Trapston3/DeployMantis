import pytest
import os
import json
from unittest.mock import MagicMock, AsyncMock, patch
from fastapi.testclient import TestClient

# Adjust path so fallback-mesh imports work correctly
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from main import app, cache
from kv_cache import make_prompt_key

client = TestClient(app)

@pytest.fixture(autouse=True)
def clear_cache():
    # Clear memory cache and SQLite cache
    cache.memory_cache.clear()
    import sqlite3
    conn = sqlite3.connect(cache.db_path)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM prompt_cache")
    conn.commit()
    conn.close()

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "fallback-mesh"}

def test_cache_miss_and_hit_non_stream():
    payload = {
        "messages": [{"role": "user", "content": "hello"}],
        "stream": False
    }

    # Mock response is a synchronous MagicMock
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [{
            "message": {"role": "assistant", "content": "hi there!"}
        }]
    }

    # httpx.AsyncClient.post is async, so we patch it with AsyncMock returning mock_response
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response
        
        # Cache Miss
        response = client.post("/v1/chat/completions", json=payload, headers={"Authorization": "Bearer fake_key"})
        assert response.status_code == 200
        assert response.json()["choices"][0]["message"]["content"] == "hi there!"
        assert mock_post.call_count == 1
        
        # Verify it was cached
        key = make_prompt_key(payload["messages"])
        assert cache.get(key) == "hi there!"

    # Cache Hit (No HTTP post should happen)
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post_hit:
        response = client.post("/v1/chat/completions", json=payload)
        assert response.status_code == 200
        assert response.json()["choices"][0]["message"]["content"] == "hi there!"
        mock_post_hit.assert_not_called()

def test_specialized_tokens_appended():
    payload = {
        "messages": [{"role": "user", "content": "hello"}],
        "stream": False
    }

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [{
            "message": {"role": "assistant", "content": "reply"}
        }]
    }

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response
        response = client.post("/v1/chat/completions", json=payload, headers={"Authorization": "Bearer fake_key"})
        assert response.status_code == 200
        
        # Verify specialized tokens were wrapped around user content
        called_args, called_kwargs = mock_post.call_args
        called_payload = called_kwargs["json"]
        assert called_payload["messages"][0]["content"] == "<｜begin_of_sentence｜>hello<｜end_of_sentence｜>"

def test_fallback_to_local_ollama():
    payload = {
        "messages": [{"role": "user", "content": "hello"}],
        "stream": False
    }

    # Official API returns 500
    mock_official_response = MagicMock()
    mock_official_response.status_code = 500

    # Local API returns 200
    mock_local_response = MagicMock()
    mock_local_response.status_code = 200
    mock_local_response.json.return_value = {
        "choices": [{
            "message": {"role": "assistant", "content": "local reply"}
        }]
    }

    # Mock find_working_local_url to just return localhost
    with patch("main.find_working_local_url", return_value="http://localhost:11434/v1/chat/completions"):
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            # First call returns official 500, second call returns local 200
            mock_post.side_effect = [mock_official_response, mock_local_response]
            
            response = client.post("/v1/chat/completions", json=payload, headers={"Authorization": "Bearer fake_key"})
            assert response.status_code == 200
            assert response.json()["choices"][0]["message"]["content"] == "local reply"
            assert mock_post.call_count == 2
