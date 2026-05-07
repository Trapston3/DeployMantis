from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from proxy.router import router as proxy_router, CHAOS_CONFIG

app = FastAPI(title="Aegis Reliability Suite - SwarmChaos")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Toggles(BaseModel):
    amnesia: bool
    badGateway: bool
    hallucination: bool
    latency: bool

class ChaosConfigModel(BaseModel):
    injectionRate: int
    toggles: Toggles

@app.get("/api/config")
def get_config():
    return CHAOS_CONFIG

@app.put("/api/config")
def update_config(config: ChaosConfigModel):
    CHAOS_CONFIG["injectionRate"] = config.injectionRate
    CHAOS_CONFIG["toggles"]["amnesia"] = config.toggles.amnesia
    CHAOS_CONFIG["toggles"]["badGateway"] = config.toggles.badGateway
    CHAOS_CONFIG["toggles"]["hallucination"] = config.toggles.hallucination
    CHAOS_CONFIG["toggles"]["latency"] = config.toggles.latency
    return {"status": "updated", "config": CHAOS_CONFIG}

app.include_router(proxy_router)

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "swarm-chaos"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5000, reload=True)
