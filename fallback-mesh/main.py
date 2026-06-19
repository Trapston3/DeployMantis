import os
import json
import logging
import httpx
from urllib.parse import urlparse
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from kv_cache import PromptKVCache, make_prompt_key

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fallback-mesh")

app = FastAPI(title="DeployMantis - Fallback Mesh Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

cache = PromptKVCache("prompt_cache.db")

async def find_working_local_url(client: httpx.AsyncClient, urls: list) -> str:
    for url in urls:
        try:
            parsed = urlparse(url)
            host_url = f"{parsed.scheme}://{parsed.netloc}"
            await client.get(host_url, timeout=0.5)
            return url
        except Exception:
            continue
    return urls[0]

@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    messages = payload.get("messages", [])
    tools = payload.get("tools")
    stream = payload.get("stream", False)

    prompt_key = make_prompt_key(messages, tools)
    cached_response = cache.get(prompt_key)

    if cached_response:
        logger.info("KV Cache Hit! Returning cached completion.")
        if stream:
            async def stream_cached():
                chunk = {
                    "id": "chatcmpl-cached",
                    "object": "chat.completion.chunk",
                    "created": 12345678,
                    "model": "deepseek-chat",
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"content": cached_response},
                            "finish_reason": None
                        }
                    ]
                }
                yield f"data: {json.dumps(chunk)}\n\n"
                
                done_chunk = {
                    "id": "chatcmpl-cached",
                    "object": "chat.completion.chunk",
                    "created": 12345678,
                    "model": "deepseek-chat",
                    "choices": [
                        {
                            "index": 0,
                            "delta": {},
                            "finish_reason": "stop"
                        }
                    ]
                }
                yield f"data: {json.dumps(done_chunk)}\n\n"
                yield "data: [DONE]\n\n"
            return StreamingResponse(stream_cached(), media_type="text/event-stream")
        else:
            response_data = {
                "id": "chatcmpl-cached",
                "object": "chat.completion",
                "created": 12345678,
                "model": "deepseek-chat",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": cached_response
                        },
                        "finish_reason": "stop"
                    }
                ],
                "usage": {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0
                }
            }
            return JSONResponse(content=response_data, status_code=200)

    # Cache Miss: Forward request
    official_url = os.getenv("DEEPSEEK_API_URL", "https://api.deepseek.com/chat/completions")
    local_urls = [
        os.getenv("OLLAMA_API_URL", "http://localhost:11434/v1/chat/completions"),
        "http://host.docker.internal:11434/v1/chat/completions"
    ]

    # Intercept and append specialized tokens for the public DeepSeek channels
    messages_copy = [dict(m) for m in messages]
    for msg in messages_copy:
        if isinstance(msg, dict) and "content" in msg:
            content = msg["content"]
            if isinstance(content, str) and not content.startswith("<｜begin_of_sentence｜>"):
                msg["content"] = f"<｜begin_of_sentence｜>{content}<｜end_of_sentence｜>"

    official_payload = {**payload, "messages": messages_copy}

    forwarded_headers = {"Content-Type": "application/json"}
    auth_header = request.headers.get("Authorization") or request.headers.get("authorization")
    if auth_header:
        forwarded_headers["Authorization"] = auth_header
    elif os.getenv("DEEPSEEK_API_KEY"):
        forwarded_headers["Authorization"] = f"Bearer {os.getenv('DEEPSEEK_API_KEY')}"

    client = httpx.AsyncClient()

    # Try official first if API key is provided
    if auth_header or os.getenv("DEEPSEEK_API_KEY"):
        try:
            if not stream:
                resp = await client.post(official_url, headers=forwarded_headers, json=official_payload, timeout=httpx.Timeout(3.0, read=30.0))
                if resp.status_code == 200:
                    data = resp.json()
                    choices = data.get("choices", [])
                    if choices:
                        content = choices[0].get("message", {}).get("content") or ""
                        if content:
                            cache.set(prompt_key, content)
                    return JSONResponse(content=data, status_code=resp.status_code)
                else:
                    logger.warning(f"DeepSeek API returned status {resp.status_code}, falling back.")
            else:
                async def stream_official_with_fallback():
                    try:
                        async with client.stream("POST", official_url, headers=forwarded_headers, json=official_payload, timeout=httpx.Timeout(3.0, read=30.0)) as resp:
                            if resp.status_code == 200:
                                accumulated = []
                                async for line in resp.aiter_lines():
                                    if not line:
                                        continue
                                    yield f"{line}\n"
                                    if line.startswith("data:"):
                                        data_str = line[5:].strip()
                                        if data_str == "[DONE]":
                                            continue
                                        try:
                                            j = json.loads(data_str)
                                            choices = j.get("choices", [])
                                            if choices:
                                                delta = choices[0].get("delta", {})
                                                content = delta.get("content") or ""
                                                if content:
                                                    accumulated.append(content)
                                        except Exception:
                                            pass
                                full_text = "".join(accumulated)
                                if full_text:
                                    cache.set(prompt_key, full_text)
                                return
                            else:
                                logger.warning(f"DeepSeek API stream returned {resp.status_code}, falling back.")
                    except Exception as e:
                        logger.warning(f"DeepSeek API stream exception: {e}, falling back.")

                    # Fallback streaming
                    local_url = await find_working_local_url(client, local_urls)
                    local_payload = {**payload}
                    local_payload["model"] = os.getenv("CUSTOM_MODEL_NAME") or payload.get("model") or "deepseek-coder"
                    try:
                        async with client.stream("POST", local_url, headers={"Content-Type": "application/json"}, json=local_payload, timeout=httpx.Timeout(3.0, read=30.0)) as resp:
                            accumulated = []
                            async for line in resp.aiter_lines():
                                if not line:
                                    continue
                                yield f"{line}\n"
                                if line.startswith("data:"):
                                    data_str = line[5:].strip()
                                    if data_str == "[DONE]":
                                        continue
                                    try:
                                        j = json.loads(data_str)
                                        choices = j.get("choices", [])
                                        if choices:
                                            delta = choices[0].get("delta", {})
                                            content = delta.get("content") or ""
                                            if content:
                                                accumulated.append(content)
                                    except Exception:
                                        pass
                            full_text = "".join(accumulated)
                            if full_text:
                                cache.set(prompt_key, full_text)
                    except Exception as e:
                        yield f"data: {json.dumps({'error': str(e)})}\n\n"

                return StreamingResponse(stream_official_with_fallback(), media_type="text/event-stream")
        except Exception as e:
            logger.warning(f"Official API attempt failed: {e}, falling back to local Ollama.")

    # Fallback to Local Ollama
    local_url = await find_working_local_url(client, local_urls)
    local_payload = {**payload}
    local_payload["model"] = os.getenv("CUSTOM_MODEL_NAME") or payload.get("model") or "deepseek-coder"

    if not stream:
        try:
            resp = await client.post(local_url, headers={"Content-Type": "application/json"}, json=local_payload, timeout=httpx.Timeout(10.0))
            if resp.status_code == 200:
                data = resp.json()
                choices = data.get("choices", [])
                if choices:
                    content = choices[0].get("message", {}).get("content") or ""
                    if content:
                        cache.set(prompt_key, content)
                return JSONResponse(content=data, status_code=resp.status_code)
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Local Ollama failed: {e}")
    else:
        async def stream_local():
            try:
                async with client.stream("POST", local_url, headers={"Content-Type": "application/json"}, json=local_payload, timeout=httpx.Timeout(3.0, read=30.0)) as resp:
                    accumulated = []
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        yield f"{line}\n"
                        if line.startswith("data:"):
                            data_str = line[5:].strip()
                            if data_str == "[DONE]":
                                continue
                            try:
                                j = json.loads(data_str)
                                choices = j.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    content = delta.get("content") or ""
                                    if content:
                                        accumulated.append(content)
                            except Exception:
                                pass
                    full_text = "".join(accumulated)
                    if full_text:
                        cache.set(prompt_key, full_text)
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
        return StreamingResponse(stream_local(), media_type="text/event-stream")

@app.get("/health")
async def health():
    return {"status": "ok", "service": "fallback-mesh"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5004, reload=False)
