"""
FastAPI routes for the Vaccine Cold Chain OpenEnv environment.

Thin routing layer ? all logic lives in environment.py and rubrics.py.
Endpoints expose the standard OpenEnv contract: /reset, /step, /state.
Additional endpoints: /health, /web (live UI), /openenv.yaml.
"""

import os
import sys
import json
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, PlainTextResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server.environment import VaccineColdChainEnv
from models import Action

app = FastAPI(
    title="Vaccine Cold Chain ? OpenEnv Environment",
    description=(
        "OpenEnv-compliant RL environment for vaccine cold chain management "
        "in rural India. Agent must combine natural-language district briefings "
        "with live sensor data to detect sensor lies and make correct decisions."
    ),
    version="2.0.0",
)

# Permissive CORS ? needed for the Next.js dev server (port 3000) to hit
# the env (port 7860) during local development, and harmless when both
# are co-served from the same HF Space origin in production.
_ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,http://localhost:7860",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _ALLOWED_ORIGINS if o.strip()] or ["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

_env = VaccineColdChainEnv()
_WEB_HTML_PATH = Path(__file__).parent / "web.html"
# Repo-root log file (works on Windows, Linux/HF, and teammates' machines).
_DEBUG_LOG_PATH = Path(__file__).resolve().parent.parent / "debug-096157.log"


def _debug_log(hypothesis_id: str, message: str, data: dict) -> None:
    # #region agent log
    payload = {
        "sessionId": "096157",
        "runId": "runtime-check",
        "hypothesisId": hypothesis_id,
        "location": "server/app.py",
        "message": message,
        "data": data,
        "timestamp": int(time.time() * 1000),
    }
    try:
        with _DEBUG_LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=True) + "\n")
    except Exception:
        pass
    # #endregion


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

    Accepts optional `user_briefing` ? if provided, used directly instead of
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
    """Full ground-truth state ? the UI polling endpoint.

    Returns both the simple `coverage/waste/missed_sessions` formula (per Bible)
    and the composable `rubric_scores` breakdown. Sensor lie is always exposed
    as `sensor_lying` on each node so the UI can render the amber callout.
    """
    try:
        return _env.state().to_dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/legacy", response_class=HTMLResponse)
@app.get("/web", response_class=HTMLResponse)
async def web():
    """Legacy live UI (server/web.html).

    Self-contained HTML+CSS+JS, polls /state every 1500ms. Kept as a
    failsafe/fallback under both /legacy and the original /web path.
    The default frontend at "/" is the Next.js mission-control build.
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


# ---------------------------------------------------------------------------
# Static frontend mount (must come LAST so it doesn't shadow the API routes)
# ---------------------------------------------------------------------------
#
# In the Docker image, the Next.js project at frontend/ is built with
# `next build` (output: 'export') and the resulting flat-file `out/`
# directory is copied to /app/static_frontend. When that directory
# exists we mount it at "/" with html=True so requests like /,
# /dashboard/, /start/, etc. serve the corresponding index.html.
#
# When the directory is missing (e.g. running uvicorn directly during
# Python-only development) we silently skip the mount and the JSON
# routes above remain available; the legacy /web HTML UI also still
# works as a fallback.
_STATIC_FRONTEND_DIR = Path(
    os.getenv(
        "STATIC_FRONTEND_DIR",
        str(Path(__file__).resolve().parent.parent / "static_frontend"),
    )
)

# #region agent log
_debug_log(
    "H2",
    "static_frontend_probe",
    {"path": str(_STATIC_FRONTEND_DIR), "exists": _STATIC_FRONTEND_DIR.is_dir()},
)
# #endregion

if _STATIC_FRONTEND_DIR.is_dir():
    # #region agent log
    _debug_log("H2", "mounting_static_frontend", {"directory": str(_STATIC_FRONTEND_DIR)})
    # #endregion
    app.mount(
        "/",
        StaticFiles(directory=str(_STATIC_FRONTEND_DIR), html=True),
        name="frontend",
    )
    print(f"[INFO] Mounted Next.js static export at / from {_STATIC_FRONTEND_DIR}")
else:
    @app.get("/", response_class=HTMLResponse)
    async def root_fallback():
        """Fallback root when the Next.js export hasn't been built into
        the container ? sends the user to the legacy HTML UI."""
        # #region agent log
        _debug_log("H3", "root_fallback_served", {"reason": "static_frontend_missing"})
        # #endregion
        return HTMLResponse(
            content=(
                "<h1>Vaccine Cold Chain ? API up</h1>"
                "<p>The Next.js mission control bundle is not present in this container "
                "(<code>static_frontend/</code> missing). The JSON env API at "
                "<code>/health</code>, <code>/reset</code>, <code>/step</code>, "
                "<code>/state</code> is still live.</p>"
                "<p>Try the legacy UI at <a href=\"/legacy\">/legacy</a>.</p>"
            )
        )
    print(
        f"[WARN] static_frontend dir not found at {_STATIC_FRONTEND_DIR}; "
        "serving legacy /web UI only."
    )
