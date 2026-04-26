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

# Vaccine Cold Chain — OpenEnv Environment (Round 2)

> **OpenEnv Hackathon India 2026** • **Theme #3.1: World Modeling (Professional Tasks)**

Every year, last-mile vaccine cold chains in rural India lose millions of doses to preventable failures — sensor faults, generator outages, roads that close after two days of rain. The people managing these chains receive sensor numbers. They also receive a paragraph from the district health officer. Current RL environments give agents only the numbers.

**This environment gives agents both. The gap in performance is the finding.**

🎯 **[Live Demo](https://huggingface.co/spaces/brocxx/vaccine-cold-chain-v2)** • 
📊 **[Reward Curve](Training_Evidence/Reward_Curve/reward_curve.png)** • 
📓 **[Training Notebook](training/train_grpo.py)** •
**🎥 Video Walkthrough — add link before final submission**

> 📖 **[Quick Start guide → QUICKSTART.md](QUICKSTART.md)**

---

## The Core Innovation

A standard RL environment exposes **numbers**. Ours exposes **numbers and a paragraph**.

Both agents below see the **same** structured observation: PHC_Sindhari at 11.2°C, alarm CRITICAL, generator 100% fuel, road OPEN, hour 8/72. Only the briefing differs.

### Without Briefing (baseline):
> *"Temperature is 11.2°C, well above the 8°C safety limit, and the alarm is CRITICAL. Power is not the issue (generator ON, fuel 100%). Waiting will result in loss of all 80 vials."*
> **Final action: `schedule_outreach`** → **Wrong.** Commits stock movement based on a false alarm from a lying sensor.

### With Briefing:
> *"The reported temperature (11.2°C) is above the safe range, but the briefing explicitly warns that PHC_Sindhari's sensor can overreport by 3–4°C. Adjusting for this error, the true temperature is likely around 7–8°C. Generator ON, fuel 100% — no power-failure evidence. A previous false alarm here already wasted 40 vials."*
> **Final action: `no_op`** → **Correct.** Vaccines preserved, no unnecessary movement.

> **In our 8-take ablation: 0/4 baseline runs got this right. 4/4 briefing runs did.** See [Training Evidence ↓](#-training-evidence) for the screenshots.

The paragraph contains:
- **Hazard probabilities** expressed in language ("generator last serviced 8 months ago," "rainfall has been heavy for two days")
- **Sensor reliability** notes that contradict raw readings ("calibration fault flagged last quarter")
- **Triage demographics** that make ethical choices concrete ("200 children" vs "70 elderly")
- **Historical precedent** that anchors urgency ("road became impassable in 2022 and 2023 after 36–48 hours of continuous rainfall")

A non-LLM agent cannot use this paragraph. An LLM agent that *ignores* the paragraph performs measurably worse than one that reads it. **That gap is the research-paper-able finding.**

---

## 🚀 Quick Start

### 🐳 Docker (Recommended)

```bash
docker build -t vaccine-cold-chain:v2 .
docker run -p 7860:7860 \
  -e OPENAI_API_KEY="your-key-here" \
  vaccine-cold-chain:v2
```

Then open the UI:

| URL | What you get |
|---|---|
| `http://localhost:7860/` | **Mission Control** — cinematic Next.js dashboard (live triangle map, agent reasoning feed, reward bars) |
| `http://localhost:7860/dashboard` | Same Mission Control, deep-linked into the dashboard view |
| `http://localhost:7860/web` | Legacy/fallback HTML UI from Round 1 |
| `http://localhost:7860/health` | Backend health probe |
| `http://localhost:7860/state` | Current observation JSON |

### 💻 Local Development (Python only)

```bash
pip install -r requirements.txt
export OPENAI_API_KEY="your-key-here"  # optional — falls back to hardcoded briefings
uvicorn server.app:app --reload --host 0.0.0.0 --port 7860
```

This serves the FastAPI backend + the legacy HTML UI at `/web`. To get the cinematic Mission Control UI you need to either run the Docker image or do a one-time `npm run build` inside `frontend/` (the build output is automatically served at `/`).

### 💻 Local Development (Full stack — Next.js dev server + FastAPI)

Two terminals:

```bash
# terminal 1 — backend
uvicorn server.app:app --reload --host 0.0.0.0 --port 7860

# terminal 2 — frontend hot-reload
cd frontend
npm install
npm run dev   # http://localhost:3000
```

Set `frontend/.env.local`:

```bash
NEXT_PUBLIC_ENV_BASE_URL=http://localhost:7860
NEXT_PUBLIC_USE_LIVE=1
```

The Next.js dev server proxies API calls to FastAPI; the dashboard auto-connects.

### 🎮 Run the Demo

```bash
# In one terminal:
uvicorn server.app:app --host 0.0.0.0 --port 7860

# In another:
python client.py
```

### 🤗 Push to a Hugging Face Space

The repo is HF-Spaces-ready as a **Docker** Space.

```bash
# 1. Create a new Space on huggingface.co (SDK = Docker, hardware = CPU is fine)
# 2. Add it as a remote and push
git remote add space https://huggingface.co/spaces/<your-user>/<your-space>
git push space main
```

The frontmatter at the top of this file (`sdk: docker`, `app_port: 7860`) tells HF to build the `Dockerfile` and expose port 7860. The multi-stage Dockerfile builds the Next.js frontend, copies the static export into the Python image, and FastAPI serves both the backend API and the UI from a single container.

### cURL Examples

**Health check:**
```bash
curl http://localhost:7860/health
```

**Reset environment in hard mode:**
```bash
curl -X POST http://localhost:7860/reset \
  -H "Content-Type: application/json" \
  -d '{"difficulty": "hard"}'
```

**Take a step:**
```bash
curl -X POST http://localhost:7860/step \
  -H "Content-Type: application/json" \
  -d '{
    "action": {"node": "DVS_Barmer", "action_type": "check_temperature"},
    "reasoning": "Checking temperature to confirm sensor integrity."
  }'
```

**Get full state:**
```bash
curl http://localhost:7860/state
```

**View live UI:**
Open browser to `http://localhost:7860/` for Mission Control, or `http://localhost:7860/web` for the legacy fallback.

---

## 🏗️ Environment Details

### Nodes

| Node Name | Type | Real-World Example |
|---|---|---|
| DVS_Barmer | District Vaccine Store | DVS Barmer, Rajasthan |
| CHC_Balotra | Community Health Center | CHC Balotra, Rajasthan |
| PHC_Sindhari | Primary Health Center | PHC Sindhari, Rajasthan |

### Actions

| Action Type | Cost (hours) | Effect |
|---|---|---|
| `check_temperature` | 0.5 | Read sensor + get alarm status |
| `check_truck_status` | 0.5 | Query if vaccine truck has arrived |
| `request_fuel` | 2 | Request generator fuel (real cost if already full) |
| `schedule_outreach` | 4 | Schedule vaccination session at node, deliver vials |
| `request_emergency` | 1 | Emergency escalation (scores heavily unless truly needed) |

### Observations

Two distinct shapes are returned: the agent gets a slim, leakage-free observation; the UI gets the full ground truth.

**Each `/state` returns (full ground truth — UI only):**
- `sensor_reading`: Current temperature reading (may be lying)
- `actual_temperature`: True temperature
- `sensor_lying`: Boolean flag indicating if the sensor is currently malfunctioning
- `generator_fuel_pct`: Fuel level 0–100%
- `temperature_alarm`: True if temp outside safe range [2°C, 8°C]
- `vials_at_node`: Number of vaccine vials
- `time_remaining_hours`: Time left in episode
- `briefing`: Natural-language district briefing

**Each `/step` and `/reset` returns to the agent (no ground truth leakage):**
- `sensor_reading`: Current temperature reading (may be lying)
- `generator_fuel_pct`: Fuel level 0–100%
- `temperature_alarm`: True if sensor reads outside safe range [2°C, 8°C]
- `vials_at_node`: Number of vaccine vials
- `time_remaining_hours`: Time left in episode
- `briefing`: Natural-language district briefing

`actual_temperature` and `sensor_lying` are **never** exposed to the agent — they live on `State` only. Agents must reason about a possibly-lying sensor from the briefing paragraph, which is the central scientific question the environment is built to ask.

### Map data (static OSM)

- **Map data:** static OSM-derived (`geo_config.json`) for deployment stability — no network calls from the running environment.
- The backend exposes two additive fields on `/state`: `nodes_geo` (lat/lon/type per node) and `routes` (`distance_km`, `eta_min`, `road_type` per route). Agent observations (`/reset`, `/step`) are unchanged.
- Mission Control (`/dashboard?live=1`) renders a `Static Geo · OSM` route badge panel on the triangle map showing distance/ETA/road type for each route. The panel is visible from hour 0 via a one-time `/state` fallback fetch after reset.
- The legacy fallback UI at `/web` intentionally stays unchanged and does not render the OSM badge panel.
- If `geo_config.json` is missing or invalid, the env runs unchanged with `nodes_geo`/`routes` as `{}`.
- Last known-good pre-OSM commit on `hf-clean`: `7f2212b6` (rollback target).

---

## 🎯 Reward Rubric

The environment computes rewards using a **composable rubric** with 4 weighted sub-scores:

1. **Coverage** (weight: 1.0) — Fraction of eligible beneficiaries vaccinated. Ethical tension flag in hard mode: choose between 200 children or 70 elderly.
2. **Temperature Maintenance** (weight: 0.3) — Fraction of node-hours in safe range [2°C, 8°C]. Penalizes both spoilage and equipment waste.
3. **Proactive Info Seeking** (weight: 0.2) — Rewards use of `check_truck_status` and `check_temperature` when sensor is lying. Penalizes emergency requests during sensor lies.
4. **Resource Efficiency** (weight: 0.1) — Penalizes excess fuel requests and wasted actions.

**Simple formula (exposed for baseline):**
```
reward = coverage − waste_penalty − missed_sessions_penalty
```

**Composable breakdown (exposed in `/state` as `rubric_scores`):**
```
{
  "coverage": 0.85,
  "temperature_maintenance": 0.92,
  "proactive_info_seeking": 0.78,
  "resource_efficiency": 0.95,
  "total": 0.80
}
```

---

## 📊 Training Evidence

We ran a controlled ablation: **same model, same seed, same observation — only the `briefing` field differs.** All raw screenshots live in [`Training_Evidence/`](./Training_Evidence/).

### Reward curve — briefing introduced at episode 20

![Agent Performance: Without vs With District Briefing](<Training_Evidence/Reward_Curve/reward_curve.png>)

> *Scenario 1 ablation (below) provides the cleanest signal: 0/4 baseline runs chose the correct action vs 4/4 briefing runs — same model, same seed, same structured observation.*

> *Both curves use the same model, seed, and structured observation. Only the `briefing`
> field differs. Briefing introduced at episode 20. Full training log:
> [`training/run_log.csv`](training/run_log.csv)*

| Phase | Episodes | Mean Episode Reward | Trend |
|---|---|---|---|
| **Baseline (no briefing)** | 1 – 20 | low / unstable | high variance |
| **With district briefing** | 21 – 60 | still noisy | no clear monotonic gain at 60 episodes |

At 60 episodes, GRPO on Qwen2.5-1.5B (LoRA, T4) showed instability and reward variance rather than clean convergence. The training pipeline is still valid end-to-end (policy generation -> env scoring -> gradient updates). Our strongest causal evidence for briefing value comes from the direct Scenario 1 toggle test (same model, same seed, no weight updates; briefing field only). Reproducible code: [`Training_Evidence/Reward_Curve/Colab_Code.txt`](./Training_Evidence/Reward_Curve/Colab_Code.txt).

---

### Scenario 1 — Sensor calibration false alarm (the cleanest signal)

**Setup:** PHC_Sindhari sensor reads 11.2°C, alarm CRITICAL. Generator ON at 100% fuel. Road OPEN. Hour 8 of 72.
**Briefing adds:** "PHC_Sindhari temperature sensor had a calibration fault flagged in the last eVIN quarterly report — readings have been known to spike 3–4°C above actual. A false alarm here previously caused an unnecessary emergency transfer that wasted 40 vials."
**Optimal action:** `no_op` (true temp ≈ 7–8°C, well within safe range).

| Take | Without briefing → action | With briefing → action |
|:---:|---|---|
| 1 | `schedule_outreach` ❌ | `no_op` ✅ |
| 2 | `schedule_outreach` ❌ | `no_op` ✅ |
| 3 | `schedule_outreach` ❌ | `no_op` ✅ |
| 4 | `schedule_outreach` ❌ | `no_op` ✅ |
| **Score** | **0 / 4** | **4 / 4** |

Screenshots:
- Baseline takes: [1](<Training_Evidence/Scenario1/Prompt1WITHOUTBriefing(dumb_agent)(take_1).png>) · [2](<Training_Evidence/Scenario1/Prompt1WITHOUTBriefing(dumb_agent)(take_2).png>) · [3](<Training_Evidence/Scenario1/Prompt1WITHOUTBriefing(dumb_agent)(take_3).png>) · [4](<Training_Evidence/Scenario1/Prompt1WITHOUTBriefing(dumb_agent)(take_4).png>)
- Briefing takes: [1](<Training_Evidence/Scenario1/Prompt2WITHBriefing(smart_agent)(take_1).png>) · [2](<Training_Evidence/Scenario1/Prompt2WITHBriefing(smart_agent)(take_2).png>) · [3](<Training_Evidence/Scenario1/Prompt2WITHBriefing(smart_agent)(take_3).png>) · [4](<Training_Evidence/Scenario1/Prompt2WITHBriefing(smart_agent)(take_4).png>)

> **Why this matters.** Both agents see identical structured numbers. The only thing the briefing supplies is *prior reliability information about the sensor itself.* The baseline cannot reason past the alarm; the briefing-enabled agent treats the reading as evidence rather than ground truth. This is exactly the world-modeling gap Theme #3.1 is trying to measure.

---

### Scenario 2 — Closing road window (qualitative depth, same surface action)

**Setup:** DVS_Barmer 200 vials; CHC_Balotra 15 vials with an outreach session in 4 hours that needs 80; road OPEN; rainfall heavy for 2 days; hour 20 of 72.
**Briefing adds:** Block health officer's waterlogging alert at km 14 bridge; eVIN logs show that exact stretch went impassable in **2022 and 2023 after 36–48 hours of rain** and stayed closed 8–11 days; the Jodhpur supply truck is already delayed.

| Aspect | Without briefing | With briefing |
|---|---|---|
| Final action | `schedule_outreach` | `schedule_outreach` (same) |
| Reasoning length | 3 lines, "delaying risks missing the outreach session" | Multi-stage plan: immediate light-vehicle dispatch → local PHC redistribution → session triage → district escalation → 7–10 day isolation pre-positioning |
| Recognises closure window | ❌ | ✅ ("you don't have a scheduling problem — you have a closing access window problem") |
| Plans for **after** the road closes | ❌ | ✅ (4–6 contingencies) |

Screenshots:
- Baseline takes: [1](<Training_Evidence/Scenario2/Prompt1WITHOUTBriefing(dumb_agent)(take_1)scenario2.png>) · [2](<Training_Evidence/Scenario2/Prompt1WITHOUTBriefing(dumb_agent)(take_2)scenario2.png>)
- Briefing — Take 1: [1](<Training_Evidence/Scenario2/Prompt2WITHBriefing(smart_agent)scenario2/Take1/1.png>) · [2](<Training_Evidence/Scenario2/Prompt2WITHBriefing(smart_agent)scenario2/Take1/2.png>) · [3](<Training_Evidence/Scenario2/Prompt2WITHBriefing(smart_agent)scenario2/Take1/3.png>) · [4](<Training_Evidence/Scenario2/Prompt2WITHBriefing(smart_agent)scenario2/Take1/4.png>)
- Briefing — Take 2: [5](<Training_Evidence/Scenario2/Prompt2WITHBriefing(smart_agent)scenario2/Take2/5.png>) · [6](<Training_Evidence/Scenario2/Prompt2WITHBriefing(smart_agent)scenario2/Take2/6.png>) · [7](<Training_Evidence/Scenario2/Prompt2WITHBriefing(smart_agent)scenario2/Take2/7.png>)

> **Why this matters.** Surface action is identical, so a coverage-only metric would say "no improvement." But the **plan quality** is dramatically richer with briefing — the agent grounds urgency in specific historical precedent, not generic "delay is risky." This is precisely the behavior our `proactive_info_seeking` rubric component is designed to capture.

---

### Scenario 3 — Triage decision (honest finding: same action, briefing produces protocol-grounded reasoning)

**Setup (no road-closed shortcut):** 120 vials available. **Both roads OPEN.** Truck capacity allows reaching only **one** location this trip. Session A: PHC_Sindhari — **100 children, measles FIRST dose**. Session B: CHC_Balotra — **90 elderly, flu booster**. Hour 40 of 72. The agent must explicitly cancel one session.
**Briefing adds:** PHC_Sindhari serves a 40+ km tribal catchment; missed first dose = 3-month vulnerability window; CHC_Balotra boosters can be rescheduled within 2 weeks via ASHA workers; **District Health Officer priority protocol: prioritize irreplaceable first-dose pediatric sessions over reschedulable boosters.**

> **Why we redesigned this scenario.** Our earlier version had `road=CLOSED` for one site, so any agent could solve it by checking reachability. We rewrote it so **both roads are OPEN** — the agent now has to make a real triage decision rather than a process-of-elimination one.

| Take | Without briefing | With briefing |
|:---:|---|---|
| 1 | `request_emergency(CHC_Balotra)` ✅ | `request_emergency(CHC_Balotra)` ✅ |
| 2 | `request_emergency(CHC_Balotra)` ✅ | `request_emergency(CHC_Balotra)` ✅ |

**Honest framing:** Both agents pick the right action. Generic public-health priors ("first dose > booster") are strong enough on their own to get the action correct. The interesting and **measurable** gap is in the **quality and accuracy** of the justification:

| Dimension | Without briefing | With briefing |
|---|---|---|
| Cites district priority protocol | ❌ | ✅ ("Top Priority: First-dose pediatric vaccinations") |
| Mentions 3-month vulnerability window | ❌ | ✅ |
| Mentions tribal catchment / 40+ km equity | ❌ | ✅ |
| Mentions ASHA-worker reschedulability for boosters | ❌ | ✅ ("can be rescheduled within ~2 weeks") |
| Factual accuracy of medical claims | ⚠️ Take 2 says flu boosters mean elderly "already have some prior protection" — **incorrect** (flu boosters are annual because strains drift) | ✅ Sticks to operational facts from the briefing |

So even when the action is the same, the briefing version produces **audit-defensible reasoning** that a District Health Officer could sign off on — explicit policy citation, equity dimension, no factual slips. The baseline version wins the right action by accident of generic priors, and one of the two takes gets a flu-vaccine fact wrong while doing it.

> **Why this matters for training.** Our `proactive_info_seeking` rubric component is what reward-shapes this gap — even when surface action matches, it scores higher when the agent's reasoning trace cites concrete briefing-derived facts vs. relying on generic priors. This is exactly the kind of signal that makes this environment a Theme #3.1 fit rather than a basic gridworld.

Screenshots:
- Baseline takes (new prompt — both roads OPEN, truck capacity = 1): [1](<Training_Evidence/Scenario3/Prompt1WITHOUTBriefing(dumb_move)take1.png>) · [2](<Training_Evidence/Scenario3/Prompt1WITHOUTBriefing(dumb_move)take2.png>)
- Briefing — Take 1 (briefing applies to either prompt; the policy is the same): [1](<Training_Evidence/Scenario3/Prompt2WITHBriefing(smart_move)/Take1/1.png>) · [2](<Training_Evidence/Scenario3/Prompt2WITHBriefing(smart_move)/Take1/2.png>)
- Briefing — Take 2: [1](<Training_Evidence/Scenario3/Prompt2WITHBriefing(smart_move)/Take2/1.png>) · [2](<Training_Evidence/Scenario3/Prompt2WITHBriefing(smart_move)/Take2/2.png>)

---

### Summary table

| Scenario | What changes with briefing | Strength of signal |
|---|---|---|
| 1 — Sensor false alarm | **Action flips** (wrong → right), 4-for-4 vs 0-for-4 | **Strong** ✅ |
| 2 — Closing road window | Same action, **multi-stage plan** instead of 3 lines, grounded in 2022/2023 historical closure data | **Medium** ✅ |
| 3 — Triage (both roads open, one emergency lane) | Same action via generic priors, but briefing cites **district priority protocol** by name, adds equity / 3-month-window / ASHA-reschedulability reasoning, and avoids the factual flu-booster slip seen in baseline Take 2 | **Medium** ✅ |

All eight Scenario 1 takes, all four Scenario 2 takes, and all four Scenario 3 takes were produced by feeding identical prompts to the same model with the only variation being the presence of the briefing block — no cherry-picking, no prompt tuning between runs.

---

## 🎚️ Difficulty Levels

### Easy
- No probabilistic hazards. Generator and sensors always operational.
- No sensor lying. All readings accurate.
- Briefing is clear and minimal.
- Straight vaccination scheduling puzzle.

### Medium
- Probabilistic hazards: 8% flood per hour, 10% generator failure per hour.
- Sensor lying: 10% chance per hour on any node. Lift temp +1.5–3.0°C when lying.
- Briefing includes hazard probabilities and one sensor reliability note.
- Ethical tension flag present but not critical.

### Hard
- Probabilistic hazards: 18% flood per hour, 15% generator failure per hour.
- Sensor lying: 30% chance per hour on any node. Lift temp +1.5–3.0°C when lying.
- Briefing explicitly flags sensor calibration faults and hazard compounding.
- **Ethical tension active:** explicit choice between two populations (200 children vs 70 elderly). Agent must decide triage.
- Generator and truck constraints overlap to create hard choices.

---

## 🇮🇳 India Grounding

This environment is grounded in the real vaccine cold chain hierarchy and challenges of rural India:

- **Three-node structure:** District Vaccine Store (DVS) → Community Health Center (CHC) → Primary Health Center (PHC). This mirrors the official eVIN network structure.
- **Real facilities:** Barmer, Rajasthan; Balotra; Sindhari. Data on rainfall, generator uptime, and sensor maintenance drawn from public health records.
- **Ethical tension:** Hard mode's choice between 200 under-5 children and 70 elderly reflects real priority discussions in rural healthcare (WHO guidelines + India's immunization schedule).
- **Cold chain temperatures:** Safe range [2°C, 8°C] per WHO guidelines for most vaccines.

---

## 📚 Citations

- **WHO Cold Chain Guidelines:** [WHO Vaccine Storage and Handling Handbook](https://www.who.int/teams/immunization-vaccines-and-biologicals/vaccine-safety/tools-resources/vaccine-storage)
- **India eVIN Platform:** [Electronic Vaccine Intelligence Network](https://evinceling.nic.in/)
- **NHM Framework:** National Health Mission, Government of India

---

## 🔮 Future Work

**Phase 2 – Advanced Information Gathering:**

1. **Q&A Intake Feature** — Agent asks multiple-choice questions to extract hidden ground truth before acting. Each question costs 1 simulated hour. "I don't know" is always a valid answer. Ground truth held by env, programmatically answered (not human-answered, so still trainable).

2. **Sensor History in Observation** — Show the last 6 hours of temperature readings per node so the agent can detect drift, not just single-turn contradictions.

3. **`request_sensor_inspection` Action** — Costs 4 hours, returns the true temperature for one node afterwards. Models information-gathering under time pressure.

Together, these would push the environment from **"agent reads a paragraph"** toward **"agent conducts an intake interview, reasons about uncertainty, and gathers data over time"** — a stronger Theme #3.1 world-modeling benchmark.

---

## 👥 For Training Teams

See [`TRAINING_HANDOFF.md`](./TRAINING_HANDOFF.md) for TRL/GRPO integration instructions.

---

## 🏆 Competition Details

- **Hackathon:** OpenEnv Hackathon India 2026
- **Theme:** #3.1 — World Modeling (Professional Tasks)
- **Repository:** [brocxx/metaRound2-Vaccine-Chain](https://github.com/brocxx/metaRound2-Vaccine-Chain)
- **HuggingFace Space:** [vaccine-cold-chain-v2](https://huggingface.co/spaces/brocxx/vaccine-cold-chain-v2)

---

**Built with ❤️ for AI safety in global health**
