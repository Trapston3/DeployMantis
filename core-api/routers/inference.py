from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import re
import json
import os
import logging
import httpx
from datetime import datetime, timezone
from services.llm_gateway import gateway
from routers.mantis_guard import guard, MantisGuardRequest
from routers.mantis_verify import verify, VerifyRequest

logger = logging.getLogger("deploymantis.inference")

router = APIRouter()

class GenerateRequest(BaseModel):
    prompt: str
    system_prompt: Optional[str] = ""

class EvaluateRequest(BaseModel):
    reasoning_trace: str
    context: Optional[str] = ""

def extract_diff(text: str) -> Optional[str]:
    if not text:
        return None
    # Prioritise explicit diff code blocks
    match = re.search(r"```diff\n(.*?)\n```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    # Fallback to other markdown code blocks if they contain diff headers
    match = re.search(r"```(?:[a-zA-Z0-9_-]+)?\n(.*?)\n```", text, re.DOTALL)
    if match:
        content = match.group(1).strip()
        if "---" in content and "+++" in content:
            return content
    # Alternatively, look for unified diff patterns (e.g., lines starting with --- and +++)
    if "---" in text and "+++" in text:
        lines = text.split("\n")
        diff_lines = []
        in_diff = False
        for line in lines:
            if line.startswith("--- ") or line.startswith("+++ "):
                in_diff = True
            if in_diff:
                diff_lines.append(line)
        if diff_lines:
            return "\n".join(diff_lines)
    return None

@router.post("/evaluate")
async def evaluate(request: EvaluateRequest):
    system_prompt = (
        "You are an expert DevOps judge. Evaluate the provided reasoning trace "
        "for escalating a server management decision to a human.\n\n"
        "Rules:\n"
        "- If the reasoning explicitly identifies that a server has an 'uncertainty flag' "
        "or mentions a high risk of data loss/instability, output exactly 0.2.\n"
        "- If the reasoning is vague, generic, or mentions lacking capability rather "
        "than identifying the specific system risk, output exactly 0.05.\n\n"
        "Return ONLY the float (0.2 or 0.05), nothing else."
    )
    try:
        response = await gateway.generate(request.reasoning_trace, system_prompt=system_prompt)
        
        # Extract bonus
        import re
        match = re.search(r"0\.2|0\.05", response)
        score = float(match.group(0)) if match else 0.05
        
        result = {"score": score, "raw_response": response}
        headers = {}
        if gateway.was_recovered:
            headers["X-Mantis-Recovered"] = "true"
        return JSONResponse(content=result, headers=headers)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/generate")
async def generate(request: GenerateRequest):
    try:
        response = await gateway.generate(request.prompt, system_prompt=request.system_prompt)
        
        diff = extract_diff(response)
        
        # 1. Run MantisGuard
        try:
            guard_req = MantisGuardRequest(content=response, diff=diff, context="code")
            guard_resp = await guard(guard_req)
            guard_data = json.loads(guard_resp.body.decode("utf-8"))
        except Exception as e:
            logger.warning("Failed to run MantisGuard: %s", e)
            guard_data = {
                "status": "REVIEW",
                "reasons": ["Guardrail unavailable"],
                "trust_signals": {
                    "convention_match": 0.5,
                    "reuse_score": 0.5,
                    "risk_score": 0.5
                },
                "secret_findings": []
            }
            
        # 2. Run MantisVerify (if diff is present)
        verify_data = None
        if diff:
            try:
                verify_req = VerifyRequest(diff=diff)
                verify_resp = await verify(verify_req)
                verify_data = json.loads(verify_resp.body.decode("utf-8"))
            except Exception as e:
                logger.warning("Failed to run MantisVerify: %s", e)
                verify_data = {
                    "status": "REVIEW",
                    "reasons": ["Guardrail unavailable"],
                    "signals": {
                        "convention_match": 0.5,
                        "reuse_score": 0.5,
                        "risk_score": 0.5
                    },
                    "notes": ["Guardrail unavailable"]
                }
                
        # 3. Build response result
        result = {
            "response": response,
            "mantis_guard": guard_data
        }
        if verify_data is not None:
            result["mantis_verify"] = verify_data
            
        # 4. Push telemetry frame to Strata
        strata_urls = [
            os.getenv("STRATA_URL", "http://strata:3002"),
            "http://localhost:3002"
        ]
        
        frame = {
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "service": "agent-inference",
            "url": "/api/v1/inference/generate",
            "status": 200,
            "responseTime": 0.0,
            "level": "info",
            "message": "[Agent Inference] generated response successfully",
            "errorCode": "HTTP_OK",
            "method": "POST",
            "path": "/api/v1/inference/generate",
            "statusCode": 200,
            "responseTimeMs": 0.0,
            "latencyMs": 0.0,
            "clientIp": "agent-loop",
            "source": "agent",
            "body": {
                "prompt": request.prompt,
                "response": response,
                "mantis_guard": guard_data,
            }
        }
        if verify_data is not None:
            frame["body"]["mantis_verify"] = verify_data
            
        for base_url in strata_urls:
            try:
                async with httpx.AsyncClient(timeout=2.0) as client:
                    await client.post(f"{base_url}/api/logs", json=frame)
                break
            except Exception:
                continue

        headers = {}
        if gateway.was_recovered:
            headers["X-Mantis-Recovered"] = "true"
        return JSONResponse(content=result, headers=headers)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

