import os
import json
import logging
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from graph_engine import RepositoryIndexer, query_index
from verifier import analyze_diff
from profiler import analyze_style

logger = logging.getLogger("deploymantis.mantis_graph")

app = FastAPI(title="DeployMantis - Graph Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _get_workspace_path(payload: dict = None) -> str:
    workspace_path = None
    if payload and "workspace_path" in payload:
        workspace_path = payload["workspace_path"]
    if not workspace_path:
        workspace_path = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    return workspace_path

# ... [rest of endpoints left untouched] ...
@app.post("/ingest")
async def ingest(payload: dict = None):
    workspace_path = _get_workspace_path(payload)
    if not os.path.isdir(workspace_path):
        raise HTTPException(status_code=400, detail=f"Workspace path {workspace_path} is not a directory")
    
    try:
        indexer = RepositoryIndexer(workspace_path)
        index = indexer.index_repo()
        index_file = os.path.join(workspace_path, ".mantis_graph_index.json")
        with open(index_file, "w", encoding="utf-8") as f:
            json.dump(index, f, indent=2)
        return {
            "status": "success",
            "workspace_path": workspace_path,
            "classes_count": len(index["classes"]),
            "functions_count": len(index["functions"]),
            "calls_count": len(index["calls"])
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/query")
async def query(q: str):
    workspace_path = _get_workspace_path()
    index_file = os.path.join(workspace_path, ".mantis_graph_index.json")
    
    if not os.path.exists(index_file):
        try:
            indexer = RepositoryIndexer(workspace_path)
            index = indexer.index_repo()
            with open(index_file, "w", encoding="utf-8") as f:
                json.dump(index, f, indent=2)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Auto-ingest failed: {e}")
    else:
        try:
            with open(index_file, "r", encoding="utf-8") as f:
                index = json.load(f)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Reading index failed: {e}")
            
    results = query_index(index, q)
    return results

# ── MantisVerify endpoint ────────────────────────────────────

class VerifyRequest(BaseModel):
    diff: str
    files: Optional[List[str]] = []
    language: Optional[str] = "python"
    agent_id: Optional[str] = None


@app.post("/verify")
async def verify_diff(payload: VerifyRequest):
    """
    Analyse a unified diff and return raw signals for the MantisVerify gate.
    """
    if not payload.diff or not payload.diff.strip():
        raise HTTPException(status_code=400, detail="'diff' field must be a non-empty string.")

    workspace_root = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..")
    )

    result = analyze_diff(
        diff_text=payload.diff,
        explicit_files=payload.files or [],
        workspace_root=workspace_root,
    )

    logger.info(
        "MantisVerify/graph: agent=%s lang=%s files=%s cv=%.2f reuse=%.2f risk=%.2f",
        payload.agent_id or "unknown",
        payload.language or "unknown",
        len(result["files_analyzed"]),
        result["convention_match"],
        result["reuse_score"],
        result["risk_score"],
    )

    return result


# ── MantisStyle Endpoint ──────────────────────────────────────

class StyleRequest(BaseModel):
    workspace_path: Optional[str] = None
    force: Optional[bool] = False


@app.post("/style-profile")
async def get_style_profile(payload: Optional[StyleRequest] = None):
    """
    Trigger AST style profiling of the workspace.
    Returns style metadata representing conventions.
    """
    payload_dict = payload.dict() if payload else None
    workspace_path = _get_workspace_path(payload_dict)
    if not os.path.isdir(workspace_path):
        raise HTTPException(status_code=400, detail=f"Workspace path {workspace_path} is not a directory")
    
    force_rebuild = payload.force if payload else False
    try:
        profile = analyze_style(workspace_path, force=force_rebuild)
        return profile
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return {"status": "ok", "service": "mantis-graph"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5003, reload=False)
