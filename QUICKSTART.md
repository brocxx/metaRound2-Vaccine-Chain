# Quick Start

## 1. Run the benchmark (no server needed)

```bash
pip install -r requirements.txt
python run_eval.py --agent rule_based_no_briefing --scenario 1 --episodes 50
python run_eval.py --agent rule_based_with_briefing --scenario 1 --episodes 50
```

Results saved to `eval_results.json`. This reproduces the core
briefing vs no-briefing ablation from the README in ~2 minutes,
no Docker or running server required.

## 2. Run the full Mission Control UI (Docker)

```bash
docker build -t vaccine-cold-chain:v2 .
docker run -p 7860:7860 -e OPENAI_API_KEY="your-key" vaccine-cold-chain:v2
```

Open http://localhost:7860 for the Mission Control dashboard.

## 3. Run training (Google Colab)

Open `training/train_grpo.py` in Colab.
Install deps: `pip install -r training/requirements_training.txt`
Run all cells. Outputs: reward curve PNG + results_summary.json.

## 4. Local dev (two terminals)

```bash
# Terminal 1
uvicorn server.app:app --reload --host 0.0.0.0 --port 7860

# Terminal 2
cd frontend && npm install && npm run dev
```
