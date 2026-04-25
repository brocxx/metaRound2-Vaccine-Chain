"""
FastAPI routes for the Vaccine Cold Chain OpenEnv environment.

Thin routing layer — all logic lives in environment.py and rubrics.py.
Endpoints expose the standard OpenEnv contract: /reset, /step, /state.
Additional endpoints: /health, /web (live UI), /openenv.yaml.
"""

import os
import sys
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, JSONResponse
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server.environment import VaccineColdChainEnv
from models import Action

app = FastAPI(
    title="Vaccine Cold Chain — OpenEnv Environment",
    description=(
        "OpenEnv-compliant RL environment for vaccine cold chain management "
        "in rural India. Agent must combine natural-language district briefings "
        "with live sensor data to detect sensor lies and make correct decisions."
    ),
    version="2.0.0",
)

_env = VaccineColdChainEnv()
_WEB_HTML_PATH = Path(__file__).parent / "web.html"


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class ResetRequest(BaseModel):
    difficulty: str = "medium"
    district: str = "barmer"
    user_briefing: Optional[str] = None
    seed: Optional[int] = None


class StepRequest(BaseModel):
    action: dict
    reasoning: Optional[str] = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    """Liveness check. Returns 200 immediately; no dependencies called."""
    return {
        "status": "healthy",
        "service": "vaccine-cold-chain-env",
        "version": "2.0",
    }


@app.post("/reset")
async def reset(req: ResetRequest):
    """Start a new episode.

    Accepts optional `user_briefing` — if provided, used directly instead of
    OpenAI generation or the hardcoded fallback. This lets the calling agent
    inject its own district briefing for controlled experiments.
    """
    try:
        obs = _env.reset(
            difficulty=req.difficulty,
            district=req.district,
            user_briefing=req.user_briefing,
            seed=req.seed,
        )
        return obs.to_dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/step")
async def step(req: StepRequest):
    """Execute one action.

    The `reasoning` field is stored and surfaced in /state for the UI.
    It is also used by the ProactiveRubric to assess the agent's intent.
    """
    try:
        action_data = dict(req.action)
        if req.reasoning:
            action_data["reasoning"] = req.reasoning

        action = Action(
            node=action_data.get("node", "DVS_Barmer"),
            action_type=action_data.get("action_type", "no_op"),
            quantity=action_data.get("quantity"),
            reasoning=action_data.get("reasoning"),
        )
        result = _env.step(action)
        return result.to_dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/state")
async def state():
    """Full ground-truth state — the UI polling endpoint.

    Returns both the simple `coverage/waste/missed_sessions` formula (per Bible)
    and the composable `rubric_scores` breakdown. Sensor lie is always exposed
    as `sensor_lying` on each node so the UI can render the amber callout.
    """
    try:
        return _env.state().to_dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/web", response_class=HTMLResponse)
async def web():
    """Live UI page.

    Self-contained HTML+CSS+JS. Polls /state every 1500ms.
    Shows sensor-lie callout in amber with warning icon when sensor_lying=true.
    """
    if not _WEB_HTML_PATH.exists():
        return HTMLResponse(
            content="<h1>web.html not found</h1><p>Run Phase 1D to generate it.</p>",
            status_code=503,
        )
    return HTMLResponse(content=_WEB_HTML_PATH.read_text(encoding="utf-8"))


@app.get("/openenv.yaml", response_class=PlainTextResponse)
async def openenv_yaml():
    """Serve the OpenEnv manifest file as plain text."""
    manifest_path = Path(__file__).resolve().parent.parent / "openenv.yaml"
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="openenv.yaml not found")
    return PlainTextResponse(content=manifest_path.read_text(encoding="utf-8"))
