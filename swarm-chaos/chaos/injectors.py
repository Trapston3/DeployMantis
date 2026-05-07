import asyncio
import json
import os
import random
import httpx
from fastapi import HTTPException

CORE_API_URL = os.getenv("CORE_API_URL", "http://core-api:4000")

async def inject_latency():
    """Sleep for 5-15 seconds."""
    delay = random.uniform(5.0, 15.0)
    await asyncio.sleep(delay)

async def inject_gateway():
    """Raise a 502 or 529."""
    choice = random.choice(["502", "529"])
    if choice == "502":
        raise HTTPException(status_code=502, detail="Chaos Injector: 502 Bad Gateway")
    elif choice == "529":
        raise HTTPException(status_code=529, detail="Chaos Injector: 529 Site Overloaded")

def inject_amnesia(payload: dict) -> dict:
    """Safely attempts to find a messages array in the JSON payload and deletes a chunk of the middle messages."""
    if not isinstance(payload, dict):
        return payload

    messages = payload.get("messages")
    if isinstance(messages, list) and len(messages) > 3:
        # Keep the system prompt (if index 0) and the very latest message
        # Drop a chunk from the middle
        start_drop = 1
        end_drop = len(messages) - 1
        if start_drop < end_drop:
            num_to_drop = random.randint(1, end_drop - start_drop)
            drop_idx = random.randint(start_drop, end_drop - num_to_drop)
            
            new_messages = messages[:drop_idx] + messages[drop_idx + num_to_drop:]
            payload["messages"] = new_messages

    return payload

async def inject_hallucination(valid_response: dict) -> dict:
    """Uses the Core API to subtly corrupt the provided valid_response JSON."""
    system_prompt = (
        "You are a chaos monkey. Your job is to subtly corrupt the provided JSON payload. "
        "Change names, flip booleans, slightly alter numbers, or change severities. "
        "Keep the exact same JSON structure, just change the values. "
        "Output ONLY valid JSON, nothing else."
    )
    
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{CORE_API_URL}/api/v1/inference/generate",
                json={
                    "prompt": json.dumps(valid_response),
                    "system_prompt": system_prompt
                },
                timeout=30.0
            )
            res.raise_for_status()
            data = res.json()
            
            response_text = data.get("response", "")
            
            # Clean up potential markdown formatting from LLM
            if response_text.startswith("```json"):
                response_text = response_text[7:]
            if response_text.endswith("```"):
                response_text = response_text[:-3]
            
            corrupted_data = json.loads(response_text.strip())
            if isinstance(corrupted_data, dict):
                return corrupted_data
            return valid_response
    except Exception:
        # Fallback if the LLM hallucination injection fails
        return valid_response
