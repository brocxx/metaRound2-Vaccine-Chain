# Training

Run `train_grpo.py` in Google Colab (free T4 tier works).

Install deps first:

```bash
pip install -r training/requirements_training.txt
```

Expected output:

- `training/run_log.csv` — per-episode reward log
- `training/results_summary.json` — baseline vs briefing comparison
- `Training_Evidence/Reward_Curve/reward_curve.png` — updated reward curve plot

Note: on short runs (e.g., 60 episodes on a 1.5B model), GRPO can show high variance
or temporary degradation instead of monotonic improvement. This is expected on sparse,
stochastic environments and does not mean the training loop is broken. The cleaner
causal signal for this project is the Scenario 1 briefing toggle ablation (same model,
same seed, no weight updates, briefing field only).
