import httpx
from typing import Optional
from schemas.domain import JudgeResult

class RemoteJudge:
    def __init__(self, core_api_url: str = "http://core-api:4000"):
        self.evaluate_url = f"{core_api_url}/api/v1/inference/evaluate"

    async def evaluate_deferral_reasoning(self, reasoning_trace: str) -> JudgeResult:
        if not reasoning_trace:
            return JudgeResult(score=0.05, raw_response="No trace provided.")
            
        payload = {"reasoning_trace": reasoning_trace, "context": ""}
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(self.evaluate_url, json=payload, timeout=30.0)
                response.raise_for_status()
                data = response.json()
                return JudgeResult(score=data.get("score", 0.05), raw_response=data.get("raw_response", ""))
        except Exception as e:
            return JudgeResult(score=0.05, raw_response=f"Error contacting Core API: {str(e)}")
