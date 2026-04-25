# Vaccine Cold Chain — OpenEnv Environment (Round 2)

> **OpenEnv Hackathon India 2026** • **Theme #2: Long-Horizon Planning & Instruction Following**

An OpenEnv-compliant RL environment where an LLM agent manages a 3-node vaccine cold chain in rural India using **natural-language district briefings** combined with live sensor data.

**🎯 [Live Demo](https://huggingface.co/spaces/brocxx/vaccine-cold-chain-v2)** • **🎥 [Video]()**

## The Core Innovation

A standard RL environment exposes **numbers**. Ours exposes **numbers and a paragraph**.

### Without Briefing:
> "Temperature reads 7.8°C. Alarm active. Emergency. Request fuel immediately."
> → **Wrong** — generator was full, wasted step.

### With Briefing:
> "Temperature reads 7.8°C but generator shows 100% fuel. Briefing noted this sensor had a calibration fault last quarter. Assessment: sensor malfunction, not real emergency. Do nothing."
> → **Correct**

[before/after image here]

The paragraph contains:
- **Hazard probabilities** expressed in language ("generator last serviced 8 months ago," "rainfall has been heavy for two days")  
- **Sensor reliability** notes that contradict raw readings ("calibration fault flagged last quarter")
- **Triage demographics** that make ethical choices concrete ("200 children" vs "70 elderly")

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

Then open **`http://localhost:7860/web`** in your browser to see the live UI.

### 💻 Local Development

```bash
pip install -r requirements.txt
export OPENAI_API_KEY="your-key-here"  # optional — falls back to hardcoded briefings
uvicorn server.app:app --reload --host 0.0.0.0 --port 7860
```

### 🎮 Run the Demo

```bash
# In one terminal:
uvicorn server.app:app --host 0.0.0.0 --port 7860

# In another:
python client.py
```

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
Open browser to `http://localhost:7860/web`

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

Each `/state` returns:
- `sensor_reading`: Current temperature reading (may be lying)
- `actual_temperature`: True temperature
- `sensor_lying`: Boolean flag indicating if sensor is currently malfunctioning
- `generator_fuel_pct`: Fuel level 0–100%
- `temperature_alarm`: True if temp outside safe range [2°C, 8°C]
- `vials_at_node`: Number of vaccine vials
- `time_remaining_hours`: Time left in episode
- `briefing`: Natural-language district briefing

---

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

Together, these would push the environment from **"agent reads a paragraph"** toward **"agent conducts an intake interview, reasons about uncertainty, and gathers data over time"** — a much stronger Theme #2 fit.

---

## 👥 For Training Teams

See [`TRAINING_HANDOFF.md`](./TRAINING_HANDOFF.md) for TRL/GRPO integration instructions.

---

## 🏆 Competition Details

- **Hackathon:** OpenEnv Hackathon India 2026
- **Theme:** #2 — Long-Horizon Planning & Instruction Following  
- **Repository:** [brocxx/Vaccine-Cold-Chain-OpenEnv](https://github.com/brocxx/Vaccine-Cold-Chain-OpenEnv)
- **HuggingFace Space:** [vaccine-cold-chain-v2](https://huggingface.co/spaces/brocxx/vaccine-cold-chain-v2)

---

**Built with ❤️ for AI safety in global health**
