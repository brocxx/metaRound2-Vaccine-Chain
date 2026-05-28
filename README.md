---
title: Meta Round 2 — Vaccine Cold Chain
emoji: 🧊
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
short_description: Vaccine cold chain OpenEnv + Mission Control UI
---

<div align="center">

<!-- Logo / badge placeholders — replace src URLs with your own assets -->
<!-- ![Vaccine Cold Chain Logo](docs/assets/logo.png) -->

[![OpenEnv](https://img.shields.io/badge/OpenEnv-v2.0-compliant-blue)](openenv.yaml)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](Dockerfile)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Demo-Hugging%20Face%20Spaces-yellow)](https://huggingface.co/spaces/brocxx/vaccine-cold-chain-v2)

# Vaccine Cold Chain

### LLM World-Modeling RL Environment & Mission Control

**OpenEnv Hackathon India 2026** · Theme #3.1 — World Modeling (Professional Tasks)

[Live Demo](https://huggingface.co/spaces/brocxx/vaccine-cold-chain-v2) · [Quick Start](QUICKSTART.md) · [Training Handoff](TRAINING_HANDOFF.md) · [Deployment Checklist](DEPLOYMENT_CHECKLIST.md)

</div>

---

## Introduction

Every year, last-mile vaccine cold chains in rural India lose millions of doses to preventable failures—sensor faults, generator outages, and roads that close after sustained rainfall. Field coordinators do not rely on numbers alone; they also receive **natural-language district briefings** (eVIN reports, block health officer alerts, historical closure data). Standard RL environments expose only structured state.

**Vaccine Cold Chain** is a production-grade **OpenEnv-compliant reinforcement learning environment** plus a **Mission Control dashboard** that evaluates whether AI agents can combine **sensor data and language** the way human coordinators do. The central research question: when structured readings and briefings disagree, does the agent treat the sensor as **evidence** or **ground truth**?

> **Headline finding:** In controlled ablations (Scenario 1 — sensor false alarm), agents with district briefings chose the correct action **4/4** times; agents without briefings chose incorrectly **0/4** times—despite identical numeric observations.

---

## Problem Statement

| Gap in typical RL benchmarks | What this project provides |
|------------------------------|----------------------------|
| Numeric state only | Structured state **plus** natural-language district briefing |
| Ground-truth flags leaked to agents | **Leakage-safe contract:** `sensor_lying` and `actual_temperature` are UI-only (`/state`), never on `/reset` or `/step` |
| Monolithic reward | **Composable 4-factor rubric** (coverage, temperature, info-seeking, efficiency) |
| Toy action spaces | **Professional actions:** temperature checks, fuel requests, outreach scheduling, emergency escalation |

Without the briefing, an agent seeing **11.2°C** and a **CRITICAL** alarm tends to panic and move stock—wasting vials when the true temperature is ~7–8°C and a calibration fault is documented in the district report. This environment measures that gap rigorously.

---

## Key Features

- 🧊 **OpenEnv-compliant RL environment** — `reset` / `step` / `state` contract with 72-hour episodes across a 3-node cold chain (DVS → CHC → PHC)
- 📋 **Language-augmented observations** — District briefings encode hazard probabilities, sensor reliability, triage policy, and historical precedent
- 🔒 **Leakage-safe observation design** — Agents never receive `sensor_lying` or `actual_temperature`; ablations remain scientifically valid
- ⚡ **Probabilistic hazards** — Floods, generator failures, and lying sensors (+1.5–3.0°C false highs) scaled by difficulty (easy / medium / hard)
- ⚖️ **Ethical tension (hard mode)** — Weighted triage between pediatric first-dose sessions and elderly booster sessions
- 📊 **Composable reward rubric** — Four weighted sub-scores exposed in `/state` for training and evaluation
- 🗺️ **Static OSM geo layer** — Node coordinates and route distance/ETA/road type via `geo_config.json` (no runtime map API)
- 🖥️ **Mission Control UI** — Next.js dashboard with live triangle map, agent reasoning feed, briefing panel, and reward breakdown
- 🐳 **Single-container deployment** — Multi-stage Docker build (Node + Python) for Hugging Face Spaces and production
- 🔬 **Reproducible evaluation** — `run_eval.py` and Makefile targets run server-free ablations in ~2 minutes
- 🤖 **GRPO training pipeline** — Qwen2.5-1.5B + LoRA with mid-training briefing intervention (`training/train_grpo.py`)

---

## Tech Stack

| Layer | Technologies |
|-------|----------------|
| **Environment & API** | Python 3.11+, FastAPI, Pydantic v2, Uvicorn, OpenEnv-core |
| **Data models** | Dataclasses (`models.py`), OpenEnv manifest (`openenv.yaml`) |
| **LLM integration** | OpenAI API (GPT-4o-mini briefings, GPT-4 eval agents) |
| **Training** | PyTorch, Unsloth, LoRA, GRPO (manual loop), Qwen2.5-1.5B |
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS 4, Framer Motion, GSAP |
| **Infrastructure** | Docker multi-stage builds, Hugging Face Spaces, healthchecks |
| **Tooling** | `run_eval.py`, Makefile, smoke tests, `validate_submission.py` |

---

## Target Audience

| Audience | How to use this repo |
|----------|----------------------|
| **ML / RL researchers** | Run ablations via `run_eval.py`, train with GRPO, extend rubrics and scenarios |
| **LLM agent developers** | Integrate against `/reset` and `/step`; inject custom briefings for controlled experiments |
| **Full-stack engineers** | Extend Mission Control UI, API routes, or Docker deployment |
| **DevOps / platform** | Deploy Docker image to HF Spaces or any container host on port `7860` |
| **Hackathon judges & reviewers** | Reproduce Scenario 1 numbers with `make eval-scenario1` (no server required) |

---

## Getting Started

### Prerequisites

| Requirement | Version / notes |
|-------------|-----------------|
| **Python** | 3.11+ recommended (3.8+ supported per `pyproject.toml`) |
| **Node.js** | 20.x (for frontend dev/build) |
| **Docker** | Optional but recommended for full-stack demo |
| **OpenAI API key** | Optional — briefings fall back to hardcoded text without it |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | No | Enables GPT-generated district briefings and GPT eval agents |
| `OPENAI_GPT4_MODEL` | No | Override default GPT-4 model in `run_eval.py` (default: `gpt-4o`) |
| `ALLOWED_ORIGINS` | No | CORS origins (comma-separated). Default includes `localhost:3000` and `7860` |
| `STATIC_FRONTEND_DIR` | No | Path to Next.js static export (set automatically in Docker) |
| `ENABLE_WEB_INTERFACE` | No | Legacy flag; web UI served at `/web` and `/legacy` |
| `NEXT_PUBLIC_ENV_BASE_URL` | Frontend dev | Backend URL for Next.js dev server (e.g. `http://localhost:7860`) |
| `NEXT_PUBLIC_USE_LIVE` | Frontend dev | Set to `1` to connect dashboard to live backend |

**Frontend local dev** — create `frontend/.env.local`:

```bash
NEXT_PUBLIC_ENV_BASE_URL=http://localhost:7860
NEXT_PUBLIC_USE_LIVE=1
```

### Installation

**Option A — Python only (API + evaluation, no Mission Control build):**

```bash
git clone https://github.com/brocxx/metaRound2-Vaccine-Chain.git
cd metaRound2-Vaccine-Chain
pip install -r requirements.txt
```

**Option B — Full stack with Docker (recommended for demo):**

```bash
docker build -t vaccine-cold-chain:v2 .
docker run -p 7860:7860 \
  -e OPENAI_API_KEY="your-key-here" \
  vaccine-cold-chain:v2
```

**Option C — Frontend development dependencies:**

```bash
cd frontend
npm install
```

### Running Locally

#### 1. Benchmark only (no server, ~2 minutes)

Reproduces the core briefing vs no-briefing ablation:

```bash
pip install -r requirements.txt
python run_eval.py --agent rule_based_no_briefing --scenario 1 --episodes 50
python run_eval.py --agent rule_based_with_briefing --scenario 1 --episodes 50
```

Or via Makefile:

```bash
make eval-scenario1
```

Results are written to `eval_outputs/scenario1_*.json`.

#### 2. API server (Python only)

```bash
export OPENAI_API_KEY="your-key-here"   # optional
uvicorn server.app:app --reload --host 0.0.0.0 --port 7860
```

| URL | Description |
|-----|-------------|
| `http://localhost:7860/health` | Liveness probe |
| `http://localhost:7860/reset` | Start new episode (POST) |
| `http://localhost:7860/step` | Execute action (POST) |
| `http://localhost:7860/state` | Full ground-truth state (GET) |
| `http://localhost:7860/web` | Legacy HTML UI (fallback) |

> **Note:** Without a built Next.js export, `/` serves an API fallback page. Use Docker or build the frontend for Mission Control at `/`.

#### 3. Full stack — two terminals (hot reload)

```bash
# Terminal 1 — backend
uvicorn server.app:app --reload --host 0.0.0.0 --port 7860

# Terminal 2 — frontend
cd frontend && npm run dev
```

Open `http://localhost:3000` (proxies API to port 7860 via env vars).

#### 4. Demo client

```bash
uvicorn server.app:app --host 0.0.0.0 --port 7860
python client.py
```

#### 5. Production-like local run (Docker)

```bash
docker build -t vaccine-cold-chain:v2 .
docker run -p 7860:7860 vaccine-cold-chain:v2
```

Open `http://localhost:7860/` for Mission Control, `/dashboard` for the live dashboard.

#### 6. Validation & smoke tests

```bash
python validate_submission.py   # 16-check OpenEnv submission validation
python smoke_test_1b.py         # Environment logic
python smoke_test_1c.py         # Rubric scoring
python smoke_test_1d.py         # HTTP endpoints
```

---

## Project Structure

```
vaccine_cold_chain/
├── server/
│   ├── app.py              # FastAPI routes (/health, /reset, /step, /state)
│   ├── environment.py      # VaccineColdChainEnv — core RL logic
│   ├── rubrics.py          # Composable 4-factor reward rubric
│   ├── briefings.py        # District briefing generation (user / OpenAI / hardcoded)
│   └── web.html            # Legacy fallback UI
├── frontend/               # Next.js Mission Control dashboard
│   ├── app/                # Pages: /, /dashboard, /start, /replay, /before-after
│   ├── components/         # Dashboard, hero, chrome UI components
│   └── lib/                # API client, hooks, types, mock data
├── training/
│   ├── train_grpo.py       # GRPO training script (Colab-ready)
│   └── requirements_training.txt
├── models.py               # OpenEnv dataclasses (Action, Observation, State)
├── openenv.yaml            # OpenEnv environment manifest
├── geo_config.json         # Static OSM node/route data
├── run_eval.py             # Server-free evaluation harness
├── client.py               # HTTP demo client
├── Dockerfile              # Multi-stage: Node build + Python runtime
├── Makefile                # Eval ablation shortcuts
├── requirements.txt        # Python dependencies
├── pyproject.toml          # Package metadata
├── QUICKSTART.md
├── TRAINING_HANDOFF.md
└── DEPLOYMENT_CHECKLIST.md
```

---

## Architecture & Design Decisions

### High-level flow

```
┌─────────────────┐     /reset, /step      ┌──────────────────┐
│  Agent (LLM /   │ ◄────────────────────► │  FastAPI         │
│  rule-based /   │   Observation +        │  server/app.py   │
│  GRPO policy)   │   briefing (no leak)   └────────┬─────────┘
└─────────────────┘                                  │
                                                     ▼
                                          ┌──────────────────┐
                                          │ VaccineColdChain │
                                          │ Env + Rubrics    │
                                          └──────────────────┘
                                                     ▲
┌─────────────────┐     /state (privileged)          │
│ Mission Control │ ◄────────────────────────────────┘
│ (Next.js UI)    │   ground truth + rubric + geo
└─────────────────┘
```

### Key design choices

1. **Observation leakage fix (v2.0)** — Agents receive `AgentNodeObservation` only. `sensor_lying` and `actual_temperature` exist on `/state` for the UI. This ensures briefing ablations measure language comprehension, not boolean flag peeking.

2. **Composable rubrics over monolithic scoring** — Four weighted sub-rubrics align with OpenEnv judging guidance and capture plan quality even when surface actions match.

3. **Static geo, no runtime dependencies** — `geo_config.json` provides OSM-derived coordinates and routes for stable HF Space deployment.

4. **Single-container production** — Multi-stage Docker builds the Next.js static export and serves it from FastAPI alongside the API.

5. **Server-free evaluation** — `run_eval.py` imports the environment in-process so judges can reproduce numbers without Docker, npm, or a running server.

### Environment model

| Concept | Detail |
|---------|--------|
| **Nodes** | `DVS_Barmer` (district store), `CHC_Balotra` (community health center), `PHC_Sindhari` (primary health center) |
| **Episode length** | 72 simulated hours |
| **Safe temperature** | 2°C – 8°C (WHO cold chain guidelines) |
| **Difficulty** | `easy` / `medium` / `hard` — scales hazard rates and ethical tension |

---

## API Reference

### `GET /health`

Liveness check. No side effects.

```bash
curl http://localhost:7860/health
```

```json
{
  "status": "healthy",
  "service": "vaccine-cold-chain-env",
  "version": "2.0"
}
```

### `POST /reset`

Start a new episode. Returns **agent-facing** observation (no ground-truth leakage).

```bash
curl -X POST http://localhost:7860/reset \
  -H "Content-Type: application/json" \
  -d '{"difficulty": "hard", "district": "barmer", "seed": 42}'
```

| Field | Type | Description |
|-------|------|-------------|
| `difficulty` | string | `easy`, `medium`, or `hard` |
| `district` | string | `barmer`, `nashik`, or `godda` |
| `user_briefing` | string? | Override generated briefing |
| `seed` | int? | Reproducible episode seed |

### `POST /step`

Execute one action. Optional `reasoning` trace for rubric scoring and UI display.

```bash
curl -X POST http://localhost:7860/step \
  -H "Content-Type: application/json" \
  -d '{
    "action": {"node": "PHC_Sindhari", "action_type": "no_op"},
    "reasoning": "Sensor likely overreporting per district briefing; no power failure evidence."
  }'
```

**Valid action types:** `check_temperature`, `check_truck_status`, `request_fuel`, `schedule_outreach`, `request_emergency`, `no_op`

### `GET /state`

Full ground-truth state for UI and debugging. Includes `sensor_lying`, `actual_temperature`, `rubric_scores`, `nodes_geo`, and `routes`.

```bash
curl http://localhost:7860/state
```

### Other endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /openenv.yaml` | OpenEnv manifest |
| `GET /web`, `GET /legacy` | Legacy HTML dashboard |
| `GET /` | Mission Control (when static frontend is built) |

---

## Reward Rubric

| Component | Weight | Measures |
|-----------|--------|----------|
| **Coverage** | 1.0 | Vaccination reach; ethical weighting in hard mode |
| **Temperature maintenance** | 0.3 | Node-hours in safe range (uses true temperature) |
| **Proactive info seeking** | 0.2 | Verification when sensors lie; penalizes blind emergencies |
| **Resource efficiency** | 0.1 | Fuel waste and redundant actions |

Exposed in `/state` as `rubric_scores` with per-component and `total` values.

---

## Training

See [`TRAINING_HANDOFF.md`](TRAINING_HANDOFF.md) for full integration details.

**Quick path (Google Colab):**

1. Open `training/train_grpo.py`
2. `pip install -r training/requirements_training.txt`
3. Run all cells (~20 min on T4 GPU)

The script runs a two-phase ablation on the same model and seed: episodes 1–20 without briefing, episodes 21–60 with briefing—isolating the effect of the language field.

---

## Deployment

### Hugging Face Spaces (Docker)

The repository includes HF Space frontmatter in this README (`sdk: docker`, `app_port: 7860`).

```bash
# Create a Docker Space on huggingface.co, then:
git remote add space https://huggingface.co/spaces/<your-user>/<your-space>
git push space main
```

Set `OPENAI_API_KEY` in Space **Settings → Repository secrets** for dynamic briefings.

### Docker (any host)

```bash
docker build -t vaccine-cold-chain:v2 .
docker run -p 7860:7860 \
  -e OPENAI_API_KEY="..." \
  -e ALLOWED_ORIGINS="*" \
  vaccine-cold-chain:v2
```

Healthcheck probes `GET /health` every 30s (see `Dockerfile`).

### CI/CD

<!-- TODO: Add your CI/CD pipeline documentation here -->
<!-- Example: GitHub Actions workflow for lint, smoke tests, Docker build, and HF Space deploy -->

| Stage | Suggested checks |
|-------|------------------|
| **Lint** | `ruff` / `eslint` on PR |
| **Test** | `python validate_submission.py`, `smoke_test_1b.py`–`1d.py` |
| **Build** | `docker build` on `main` |
| **Deploy** | Push to Hugging Face Space on tagged release |

> **Placeholder:** Add `.github/workflows/ci.yml` when your pipeline is finalized.

---

## Research Evidence

Controlled ablation: **same model, same seed, same structured observation** — only the `briefing` field differs.

| Scenario | Briefing effect | Signal strength |
|----------|-----------------|-----------------|
| **1 — Sensor false alarm** | Action flips: `schedule_outreach` → `no_op` | **Strong** (0/4 → 4/4) |
| **2 — Closing road window** | Same action; richer multi-stage contingency plan | **Medium** |
| **3 — Triage** | Same action; protocol-cited, audit-defensible reasoning | **Medium** |

- [Reward curve](https://github.com/brocxx/metaRound2-Vaccine-Chain/blob/evidence-assets/Training_Evidence/Reward_Curve/reward_curve.png)
- [Training evidence folder](https://github.com/brocxx/metaRound2-Vaccine-Chain/tree/evidence-assets/Training_Evidence)

---

## India Grounding & References

- **Cold chain hierarchy:** DVS → CHC → PHC (aligned with [eVIN](https://evinceling.nic.in/) network structure)
- **Facilities:** Barmer, Balotra, Sindhari — Rajasthan
- **Temperature bounds:** [WHO Vaccine Storage and Handling](https://www.who.int/teams/immunization-vaccines-and-biologicals/vaccine-safety/tools-resources/vaccine-storage)
- **Framework:** National Health Mission, Government of India

---

## Contributing

We welcome contributions from researchers, engineers, and domain experts.

### How to contribute

1. **Fork** the repository and create a feature branch (`git checkout -b feature/your-feature`)
2. **Run validation** before opening a PR:
   ```bash
   python validate_submission.py
   python smoke_test_1b.py && python smoke_test_1c.py && python smoke_test_1d.py
   ```
3. **Follow existing conventions** — preserve Bible field names in `models.py` (`sensor_reading`, `actual_temperature`, etc.)
4. **Open a pull request** with a clear description, test plan, and linked issue (if applicable)

### Development guidelines

- Do **not** expose `sensor_lying` or `actual_temperature` on `/reset` or `/step`
- Prefer composable rubric extensions over monolithic reward changes
- Keep `geo_config.json` optional — environment must run if the file is missing
- Frontend changes should work in both `live` and `mock` data modes

### Code of Conduct

<!-- TODO: Link to CODE_OF_CONDUCT.md when added -->
<!-- Example: This project follows the [Contributor Covenant](https://www.contributor-covenant.org/). -->

This project adheres to a standard open-source code of conduct. Be respectful, constructive, and inclusive in all interactions. A formal `CODE_OF_CONDUCT.md` will be added in a future release.

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

Built for **OpenEnv Hackathon India 2026** (Theme #3.1 — World Modeling, Professional Tasks).

- **Repository:** [brocxx/metaRound2-Vaccine-Chain](https://github.com/brocxx/metaRound2-Vaccine-Chain)
- **Live demo:** [vaccine-cold-chain-v2 on Hugging Face](https://huggingface.co/spaces/brocxx/vaccine-cold-chain-v2)

---

<div align="center">

**Built for AI safety in global health**

If this work is useful to your research or deployment, please ⭐ star the repository.

</div>
