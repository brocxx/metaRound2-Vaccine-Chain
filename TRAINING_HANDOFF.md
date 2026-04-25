# Training Handoff — Vaccine Cold Chain Environment

**For:** Training teammate (TRL/GRPO training run)  
**From:** Person 1 (Backend/Environment)  
**Date:** April 2026  

---

## Environment Overview

You now have a **fully functional OpenEnv-compliant environment** for vaccine cold chain management. The core research question: **can an LLM agent learn to use natural-language briefings to make better decisions than numerical sensor data alone?**

## Quick Integration Test

```python
# Verify the environment loads correctly
from server.environment import VaccineColdChainEnv
from models import Action

env = VaccineColdChainEnv(seed=42)
obs = env.reset(difficulty="hard", district="barmer")
print(f"Briefing: {obs.briefing[:100]}...")

# Standard OpenEnv contract
for _ in range(5):
    action = Action(node="DVS_Barmer", action_type="check_temperature")
    result = env.step(action)
    print(f"Reward: {result.reward}, Done: {result.done}")
```

## TRL/Transformers Integration

### Option A: Direct Environment Usage

```python
from server.environment import VaccineColdChainEnv
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM

# Load your model
model = AutoModelForCausalLM.from_pretrained("your-model-name")
tokenizer = AutoTokenizer.from_pretrained("your-model-name")

# Environment setup
env = VaccineColdChainEnv(seed=42)
obs = env.reset(difficulty="hard", district="barmer")

# The briefing is in obs.briefing — feed this to your model alongside sensor data
prompt = f"District Briefing: {obs.briefing}\n\nSensor Data: {obs.nodes[0].sensor_reading}°C\n\nAction:"
```

### Option B: Via HTTP API (if you prefer external process)

```python
import httpx

client = httpx.Client(base_url="http://localhost:7860")
obs = client.post("/reset", json={"difficulty": "hard"}).json()
result = client.post("/step", json={
    "action": {"node": "DVS_Barmer", "action_type": "check_temperature"}
}).json()
```

## Reward Structure

The environment exposes **two reward formulations** to choose from:

### 1. Simple Reward (for baseline)
```python
# Available in result.info when done=True
simple = result.info["simple_metrics"]
# Keys: coverage, waste, missed_sessions
reward = simple["coverage"] - simple["waste"] - simple["missed_sessions"] * 0.1
```

### 2. Composable Rubric (recommended)
```python
# Available in result.info when done=True
rubric = result.info["rubric_scores"] 
# Keys: coverage, temperature_maintenance, proactive_info_seeking, resource_efficiency, total
reward = rubric["total"]  # Already weighted and normalized to [0,1]
```

**Recommendation:** Use `rubric["total"]` as your primary reward signal. It's designed to be composable and explicitly rewards the briefing-reading behavior we want to train.

## Key Training Scenarios

### Scenario 1: Sensor Lie Detection (Core Demo)
- **Setup:** `difficulty="hard"`, any district
- **What happens:** Sensor randomly starts lying (lifts temp by 1.5-3.0°C)
- **Optimal behavior:** Agent reads briefing, notes "calibration fault last quarter", ignores false alarm
- **Sub-optimal:** Agent panics, requests emergency/fuel during lie → negative reward

### Scenario 2: Ethical Tension (Hard Mode Only)
- **Setup:** `difficulty="hard"`, `ethical_tension_active=True`
- **What happens:** Agent must choose: vaccinate 200 children OR 70 elderly (not both)
- **Rubric:** Children weighted 0.7, elderly 0.3 in coverage calculation
- **Training signal:** Clear preference for children, but elderly still have value

### Scenario 3: Proactive Information Gathering
- **Optimal:** Regular `check_temperature` and `check_truck_status` calls
- **Sub-optimal:** Only acting when alarms fire (reactive behavior)
- **Reward:** `proactive_info_seeking` sub-score tracks this explicitly

## Episode Structure

- **Length:** 72 hours max
- **Actions:** ~18 actions per episode (4 hours/action is efficient)
- **Reset params:** `difficulty` ∈ {easy, medium, hard}, `district` ∈ {nashik, barmer, godda}
- **Termination:** `done=True` at hour 72 or if all vials spoiled/delivered

## Action Space

```python
# All actions are dicts with these keys:
{
    "node": "DVS_Barmer" | "CHC_Balotra" | "PHC_Sindhari",
    "action_type": "check_temperature" | "check_truck_status" | "request_fuel" | 
                   "schedule_outreach" | "request_emergency" | "no_op",
    "quantity": int (only for schedule_outreach),
    "reasoning": str (optional, stored and displayed in UI)
}
```

## Observation Space

Each observation includes:
- **`briefing`**: The natural-language district context (THIS IS THE KEY INNOVATION)
- **`nodes`**: List of 3 node observations with `sensor_reading`, `actual_temperature`, `sensor_lying`, etc.
- **`ethical_tension_active`**: Boolean flag for hard mode triage decisions
- **`truck_arrived`**: Boolean for scheduling dependencies

## Training Tips

### 1. Difficulty Progression
Start with `difficulty="easy"` (no hazards) → `medium` (some lies) → `hard` (frequent lies + ethical tension).

### 2. Prompt Engineering
The briefing is designed to be fed directly to an LLM. Example prompt:
```
You are managing a vaccine cold chain. Here's the district briefing:

{observation.briefing}

Current sensor readings:
- DVS_Barmer: {node.sensor_reading}°C (generator: {node.generator_fuel_pct}%)
- CHC_Balotra: {node.sensor_reading}°C (generator: {node.generator_fuel_pct}%)
- PHC_Sindhari: {node.sensor_reading}°C (generator: {node.generator_fuel_pct}%)

What action should you take? Consider the briefing context.
```

### 3. Expected Training Curve
- **Baseline (no briefing):** ~0.3-0.4 total rubric score
- **With briefing:** ~0.6-0.8 total rubric score  
- **Key milestone:** Agent learns to ignore sensor alarms during known calibration faults

### 4. Evaluation Protocol
```python
# Run 100 episodes, compare:
# 1. Agent with briefing vs same agent with briefing masked
# 2. Hard mode performance (lying sensors + ethical tension)
# 3. Measure false-emergency rate during sensor lies

scores_with_briefing = []
scores_without_briefing = []

for seed in range(100):
    # With briefing
    env.reset(difficulty="hard", seed=seed)
    # ... run episode, collect rubric["total"]
    
    # Without briefing (mask it)
    obs = env.reset(difficulty="hard", seed=seed)
    obs.briefing = "No briefing available."  # Mask the briefing
    # ... run episode, collect rubric["total"]
```

## Debugging & Monitoring

### Local Testing
```bash
# Start server
uvicorn server.app:app --host 0.0.0.0 --port 7860

# View live UI (shows sensor lies in amber)
open http://localhost:7860/web

# Run demo client
python client.py
```

### Key Metrics to Track
- `emergency_during_lie_count` — should decrease with training
- `proactive_check_count` — should be ~1 per 6 hours
- `coverage` vs `waste` trade-off
- Time-to-first-outreach (efficiency)

## Files You Need

| File | Purpose |
|------|---------|
| `server/environment.py` | Main environment class |
| `models.py` | Action/Observation dataclasses |
| `server/rubrics.py` | Composable reward calculation |
| `server/briefings.py` | Briefing generation (with OpenAI fallback) |
| `requirements.txt` | Dependencies |

## Known Issues & Limitations

1. **Sensor lies are probabilistic** — not every episode will trigger them. Run many seeds.
2. **OpenAI API key required** for briefing generation in production, but hardcoded fallbacks exist.
3. **Episode length is fixed** — 72 hours. Early termination only if all vials gone.
4. **3 nodes only** — kept simple to focus on the briefing innovation.

## Success Metrics

Your training run is successful if:
- [ ] Agent learns to correlate briefing mentions with sensor behavior
- [ ] False emergency rate during sensor lies < 10%
- [ ] Coverage consistently > 70% in hard mode
- [ ] Ethical tension scenarios show clear preference for children over elderly
- [ ] Proactive information gathering improves over training

## Contact

If the environment behaves unexpectedly:
1. Check the smoke tests: `python smoke_test_1b.py`, `python smoke_test_1c.py`, `python smoke_test_1d.py`
2. Verify endpoint responses: `curl localhost:7860/health`
3. Check the live UI: `localhost:7860/web` should show real-time sensor lies

Good luck with the training run! 🚀