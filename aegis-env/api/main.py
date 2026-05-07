from fastapi import FastAPI, HTTPException
from typing import Optional
import os

from rl_core.engine import AegisEnvironment
from evaluators.remote_judge import RemoteJudge
from schemas.domain import ActionRequest, ObservationResponse, JudgeResult

app = FastAPI(title="AegisEnv - Phase 3")

env = AegisEnvironment()
core_api_url = os.getenv("CORE_API_URL", "http://core-api:4000")
judge = RemoteJudge(core_api_url=core_api_url)

@app.post("/api/v1/reset", response_model=ObservationResponse)
async def reset_env():
    return env.reset()

@app.post("/api/v1/step", response_model=ObservationResponse)
async def step_env(action: ActionRequest):
    return env.step(action)

@app.post("/api/v1/judge", response_model=JudgeResult)
async def evaluate_trace(trace: str):
    return await judge.evaluate_deferral_reasoning(trace)

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "aegis-env"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
