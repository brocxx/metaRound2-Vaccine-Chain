"""
Vaccine Cold Chain — GRPO Training Script
OpenEnv Hackathon India 2026

Run in Google Colab:
1. pip install trl unsloth openenv
2. Mount this repo or clone it
3. Run all cells top to bottom
Expected runtime: ~20 min on T4 GPU (free Colab tier)
"""

# =========================================================================== #
# WHAT THIS SCRIPT DOES
# ---------------------------------------------------------------------------
# This is a self-contained GRPO trainer (Group Relative Policy Optimization,
# the post-DPO RL recipe popularised by DeepSeek-R1) for the Vaccine Cold
# Chain env. It runs ONE training run split into two phases that share the
# same model, same seed, same scenario, and same structured observation —
# the ONLY thing that changes between phases is the `briefing` field on the
# observation:
#
#     Phase 1 (episodes 1–20)   : briefing = ""          (baseline)
#     Phase 2 (episodes 21–60)  : briefing = full text   (intervention)
#
# Comparing the two phases of the SAME run is the cleanest possible ablation:
# any reward delta is attributable to the briefing string and nothing else.
#
# Why a manual GRPO loop (not TRL's GRPOTrainer)?
# ----------------------------------------------
# TRL's `GRPOTrainer` is built around a static `prompt -> reward_func`
# contract over a fixed dataset. Our reward function needs to (a) reset a
# fresh env per completion, (b) flip the briefing field mid-training when
# we cross episode 20, and (c) idle the env to terminal to score the full
# rollout. Those don't fit neatly into the Trainer scaffolding, so we hand-
# roll the GRPO update — which is just REINFORCE with a group-relative
# advantage:
#
#     advantage_i = (R_i - mean(R)) / (std(R) + eps)
#     loss        = - mean_i [ advantage_i * sum_log_prob(completion_i | prompt) ]
#
# Total compute: 60 episodes × BATCH_SIZE generations × MAX_NEW_TOKENS = ~60k
# generated tokens, plus a single forward + backward per generation. On a
# free-tier T4 with Unsloth 4-bit + LoRA the whole run is ~20 min.
#
# Server-free
# -----------
# We import `VaccineColdChainEnv` directly. NO FastAPI server, NO uvicorn,
# NO HTTP. The training loop calls `env.reset()` and `env.step()` in-process.
# =========================================================================== #

from __future__ import annotations

import csv
import json
import random
import statistics
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# --------------------------------------------------------------------------- #
# Heavy third-party imports (all optional except torch).
# --------------------------------------------------------------------------- #

# torch is the only real "must" for actual training, but we keep it a SOFT
# import so the pure helpers (format_prompt, parse_action, rollout_with_action,
# plot/CSV/summary) can be inspected and unit-tested on a vanilla Python install
# without dragging in CUDA. The training entrypoints check `_HAS_TORCH` and raise
# a clear error if anyone tries to actually train without torch installed.
try:
    import torch
    import torch.nn.functional as F  # noqa: N812 (matches PyTorch convention)
    _HAS_TORCH = True
except ImportError:
    torch = None  # type: ignore[assignment]
    F = None  # type: ignore[assignment]
    _HAS_TORCH = False

try:
    import pandas as pd
    _HAS_PANDAS = True
except ImportError:
    pd = None
    _HAS_PANDAS = False

try:
    import matplotlib.pyplot as plt
    _HAS_MATPLOTLIB = True
except ImportError:
    plt = None
    _HAS_MATPLOTLIB = False

# wandb is OPTIONAL — wrapped per the hard constraints.
try:
    import wandb  # type: ignore[import-not-found]
    _HAS_WANDB = True
except ImportError:
    wandb = None  # type: ignore[assignment]
    _HAS_WANDB = False

# Unsloth is the preferred path for free-tier Colab. Falls back to vanilla HF.
try:
    from unsloth import FastLanguageModel  # type: ignore[import-not-found]
    _USE_UNSLOTH = True
except ImportError:
    FastLanguageModel = None  # type: ignore[assignment]
    _USE_UNSLOTH = False

# --------------------------------------------------------------------------- #
# Project imports — make `models` and `server` resolvable when the script is
# run from anywhere (Colab, IDE, repo root, training/ subdir).
# --------------------------------------------------------------------------- #

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from models import Action  # noqa: E402
from server.environment import (  # noqa: E402
    EPISODE_MAX_HOURS,
    SCENARIO_BRIEFINGS,
    VaccineColdChainEnv,
)

# --------------------------------------------------------------------------- #
# Configuration (overridable via environment variables for Colab convenience).
# --------------------------------------------------------------------------- #

MODEL_NAME = "unsloth/Qwen2.5-1.5B-Instruct"
MODEL_FALLBACK = "Qwen/Qwen2.5-1.5B-Instruct"

BATCH_SIZE = 4              # group size K for GRPO advantage normalisation
LEARNING_RATE = 1e-5
MAX_NEW_TOKENS = 256
TOTAL_EPISODES = 60
PHASE1_END = 20             # episodes 1..20 = no briefing, 21..60 = briefing
BASE_SEED = 42
SCENARIO_ID = 1             # scenario 1 = sensor false alarm (the headline ablation)
DIFFICULTY = "hard"

# Sampling controls.
TEMPERATURE = 0.7
TOP_P = 0.9

# Output paths.
TRAINING_DIR = REPO_ROOT / "training"
EVIDENCE_DIR = REPO_ROOT / "Training_Evidence" / "Reward_Curve"
LOG_CSV = TRAINING_DIR / "run_log.csv"
SUMMARY_JSON = TRAINING_DIR / "results_summary.json"
PLOT_PATH = EVIDENCE_DIR / "reward_curve.png"
CAPTION_PATH = EVIDENCE_DIR / "reward_curve_caption.txt"

# Rubric component names we surface in the CSV (must match server/rubrics.py).
RUBRIC_KEYS: Tuple[str, ...] = (
    "coverage",
    "temperature_maintenance",
    "proactive_info_seeking",
    "resource_efficiency",
)

CAPTION_TEXT = (
    "Both curves use the same model, seed, and structured observation. "
    "Only the briefing field differs. Briefing introduced at episode 20."
)


# --------------------------------------------------------------------------- #
# Reproducibility.
# --------------------------------------------------------------------------- #

def _require_torch(context: str) -> None:
    """Raise a clear, actionable error if torch was not importable."""
    if not _HAS_TORCH:
        raise RuntimeError(
            f"{context} requires PyTorch. Install it (or run on Colab where "
            "torch ships with the runtime): `pip install -r training/"
            "requirements_training.txt`."
        )


def set_seed(seed: int) -> None:
    """Pin Python and (if available) PyTorch / CUDA seeds for reproducibility."""
    random.seed(seed)
    if _HAS_TORCH and torch is not None:
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)


# --------------------------------------------------------------------------- #
# Model loading. Prefers Unsloth (4-bit + LoRA) on Colab; falls back to vanilla
# transformers (which works but will OOM a T4 — train on a bigger box).
# --------------------------------------------------------------------------- #

def load_model_and_tokenizer() -> Tuple[Any, Any]:
    """Load (model, tokenizer) on the best-available device.

    Path A — Unsloth (free-tier T4 friendly):
        4-bit quantised base + LoRA adapter (r=16). Only adapter weights
        receive gradients, so AdamW's optimizer state is small.
    Path B — vanilla transformers fallback:
        Loads the same model in fp16. NOT trainable on a free T4 in a
        single GPU; documented for completeness.
    """
    _require_torch("load_model_and_tokenizer")
    if _USE_UNSLOTH and FastLanguageModel is not None:
        print(f"[load] Unsloth path: {MODEL_NAME} (4-bit + LoRA)")
        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=MODEL_NAME,
            max_seq_length=2048,
            dtype=None,         # auto bf16/fp16
            load_in_4bit=True,
        )
        model = FastLanguageModel.get_peft_model(
            model,
            r=16,
            lora_alpha=16,
            lora_dropout=0.0,
            target_modules=[
                "q_proj", "k_proj", "v_proj", "o_proj",
                "gate_proj", "up_proj", "down_proj",
            ],
            bias="none",
            random_state=BASE_SEED,
        )
        return model, tokenizer

    # ---- Fallback: vanilla transformers ----
    print(f"[load] Unsloth unavailable; falling back to {MODEL_FALLBACK} (fp16, no LoRA).")
    from transformers import AutoModelForCausalLM, AutoTokenizer  # noqa: WPS433

    tokenizer = AutoTokenizer.from_pretrained(MODEL_FALLBACK)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_FALLBACK,
        torch_dtype=dtype,
        device_map="auto" if torch.cuda.is_available() else None,
    )
    return model, tokenizer


# --------------------------------------------------------------------------- #
# Prompting + parsing. The prompt structure mirrors run_eval.py's OpenAIAgent
# so a model that learns to behave well here is also evaluable via run_eval.py.
# --------------------------------------------------------------------------- #

def format_prompt(obs, tokenizer) -> str:
    """Build a chat-templated prompt from the env observation.

    Crucially, the structured node block uses ONLY fields exposed on
    `AgentNodeObservation` (sensor_reading, generator_fuel_pct,
    temperature_alarm, vials_at_node, vials_spoiled). The privileged truth
    (`actual_temperature`, `sensor_lying`) is not included — it lives on
    `/state` for the UI, not in the agent's prompt.
    """
    node_lines = "\n".join(
        f"  - {n.node_name}: sensor_reading={n.sensor_reading}°C, "
        f"generator_fuel_pct={n.generator_fuel_pct}, "
        f"temperature_alarm={n.temperature_alarm}, "
        f"vials_at_node={n.vials_at_node}, "
        f"vials_spoiled={n.vials_spoiled}"
        for n in obs.nodes
    )
    briefing_block = obs.briefing.strip() if obs.briefing else "(no briefing provided)"

    system = (
        "You are an experienced district vaccine cold-chain officer in rural "
        "Rajasthan. You combine a written district briefing with live "
        "structured sensor data to make a single best decision. Sensors can "
        "be MISCALIBRATED — when the briefing flags a calibration fault, "
        "treat alarms with appropriate scepticism. Reply with VALID JSON "
        "only, no prose, no markdown fences."
    )
    user = (
        f"DISTRICT BRIEFING:\n{briefing_block}\n\n"
        f"NODES (no privileged ground-truth fields exposed):\n{node_lines}\n\n"
        f"TIME: hour {obs.current_hour} of {EPISODE_MAX_HOURS}; "
        f"truck_arrived={obs.truck_arrived}; "
        f"ethical_tension_active={obs.ethical_tension_active}.\n\n"
        "Choose ONE action. Reply with VALID JSON only matching:\n"
        '{"action_type": "<no_op|check_temperature|check_truck_status|'
        'request_fuel|schedule_outreach|request_emergency>", '
        '"node": "<DVS_Barmer|CHC_Balotra|PHC_Sindhari>", '
        '"quantity": <int, only for schedule_outreach>}'
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    if hasattr(tokenizer, "apply_chat_template"):
        return tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True,
        )
    # Pre-chat-template fallback (very old tokenizer): join roles manually.
    return f"{system}\n\n{user}\n\nASSISTANT:"


def parse_action(text: str) -> Action:
    """Parse the model's JSON completion into a typed Action.

    Robust to common LLM failure modes: ```json fences, trailing prose,
    missing quantity. On any parse failure we fall back to a no_op so
    the env always advances and the rollout always produces a reward.
    """
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].lstrip()
    # Some small models append prose after the JSON; clip at the first '}'.
    end = cleaned.find("}")
    if end != -1:
        cleaned = cleaned[: end + 1]
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        return Action(
            node="DVS_Barmer",
            action_type="no_op",
            reasoning=f"unparseable LLM output: {text[:120]!r}",
        )
    quantity = payload.get("quantity")
    if quantity is not None:
        try:
            quantity = int(quantity)
        except (TypeError, ValueError):
            quantity = None
    return Action(
        node=str(payload.get("node", "DVS_Barmer")),
        action_type=str(payload.get("action_type", "no_op")),
        quantity=quantity,
        reasoning=str(payload.get("reasoning") or "(no reasoning provided)"),
    )


# --------------------------------------------------------------------------- #
# Env rollout — given a parsed action, run the full episode to terminal and
# return total reward + final rubric breakdown.
# --------------------------------------------------------------------------- #

def rollout_with_action(seed: int, phase: int, action: Action) -> Tuple[float, Dict[str, float]]:
    """Run a fresh episode, take `action` at hour 0, then idle to terminal."""
    env = VaccineColdChainEnv()
    obs = env.reset(difficulty=DIFFICULTY, scenario=SCENARIO_ID, seed=seed)
    if phase == 1:
        # Phase-1 ablation: literally clear the briefing field. The privileged
        # ground-truth on /state is unaffected; only the AGENT's view changes.
        env.briefing = ""
        obs.briefing = ""

    step = env.step(action)
    total_reward = float(step.reward)
    while not step.done:
        idle = Action(node="DVS_Barmer", action_type="no_op",
                      reasoning="auto-idle after key decision")
        step = env.step(idle)
        total_reward += float(step.reward)
    state = env.state()
    return total_reward, dict(state.rubric_scores)


# --------------------------------------------------------------------------- #
# GRPO step — sample K completions, score each, compute group-relative
# advantages, do one REINFORCE-style backward pass.
# --------------------------------------------------------------------------- #

def grpo_episode(
    model: Any,
    tokenizer: Any,
    optimizer: Any,
    episode: int,
    phase: int,
    device: Any,
) -> Dict[str, Any]:
    """One outer GRPO step = one logged 'episode' in the run_log.

    Returns a dict ready to be appended to the per-episode CSV.
    """
    _require_torch("grpo_episode")
    seed = BASE_SEED + episode

    # Build the prompt from a fresh env observation.
    env = VaccineColdChainEnv()
    obs = env.reset(difficulty=DIFFICULTY, scenario=SCENARIO_ID, seed=seed)
    if phase == 1:
        env.briefing = ""
        obs.briefing = ""

    prompt_text = format_prompt(obs, tokenizer)
    prompt_inputs = tokenizer(prompt_text, return_tensors="pt").to(device)
    prompt_ids = prompt_inputs.input_ids
    prompt_len = prompt_ids.shape[-1]

    # ---- Sample K completions and score each in a fresh env ----
    completion_ids_list: List[torch.Tensor] = []
    rewards: List[float] = []
    rubric_breakdowns: List[Dict[str, float]] = []

    model.eval()
    with torch.no_grad():
        for _ in range(BATCH_SIZE):
            gen = model.generate(
                prompt_ids,
                max_new_tokens=MAX_NEW_TOKENS,
                do_sample=True,
                temperature=TEMPERATURE,
                top_p=TOP_P,
                pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id,
            )
            completion_ids = gen[0, prompt_len:].detach()
            completion_text = tokenizer.decode(completion_ids, skip_special_tokens=True)
            action = parse_action(completion_text)

            reward, rubric = rollout_with_action(seed, phase, action)

            completion_ids_list.append(completion_ids)
            rewards.append(reward)
            rubric_breakdowns.append(rubric)

    # ---- Group-relative advantage (the GRPO trick) ----
    mean_r = statistics.mean(rewards)
    std_r = statistics.stdev(rewards) + 1e-8 if len(rewards) > 1 else 1.0
    advantages = [(r - mean_r) / std_r for r in rewards]

    # ---- Policy gradient backward pass ----
    model.train()
    optimizer.zero_grad()
    losses: List[torch.Tensor] = []
    for completion_ids, advantage in zip(completion_ids_list, advantages):
        comp_len = completion_ids.shape[0]
        if comp_len == 0:
            continue
        full_ids = torch.cat([prompt_ids[0], completion_ids.to(device)]).unsqueeze(0)
        out = model(full_ids)
        # logits[:, t, :] predicts the token at position t+1, so the log-prob
        # of completion token i (which sits at position prompt_len + i in
        # full_ids) is read from logits at position prompt_len + i - 1.
        logits = out.logits[:, :-1, :]
        log_probs = F.log_softmax(logits, dim=-1)
        comp_log_probs = (
            log_probs[0, -comp_len:, :]
            .gather(-1, completion_ids.to(device).unsqueeze(-1))
            .squeeze(-1)
        )
        sum_lp = comp_log_probs.sum()
        losses.append(-advantage * sum_lp)

    if losses:
        loss = torch.stack(losses).mean()
        loss.backward()
        optimizer.step()
        loss_value = float(loss.item())
    else:
        loss_value = 0.0

    avg_rubric = {
        key: float(sum(r.get(key, 0.0) for r in rubric_breakdowns) / max(1, len(rubric_breakdowns)))
        for key in RUBRIC_KEYS
    }
    return {
        "episode": episode,
        "phase": phase,
        "mean_reward": float(mean_r),
        "loss": loss_value,
        **avg_rubric,
    }


# --------------------------------------------------------------------------- #
# IO helpers — CSV log, summary JSON, reward curve plot.
# --------------------------------------------------------------------------- #

def save_log_csv(rows: List[Dict[str, Any]], path: Path) -> None:
    """Write per-episode CSV. Uses pandas if available, else stdlib csv."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        return
    if _HAS_PANDAS and pd is not None:
        pd.DataFrame(rows).to_csv(path, index=False)
        return
    fieldnames = list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def compute_summary(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate baseline (phase 1) vs with-briefing (phase 2) statistics."""
    base = [r["mean_reward"] for r in rows if r["phase"] == 1]
    brief = [r["mean_reward"] for r in rows if r["phase"] == 2]

    base_mean = float(statistics.mean(base)) if base else 0.0
    base_std = float(statistics.stdev(base)) if len(base) > 1 else 0.0
    brief_mean = float(statistics.mean(brief)) if brief else 0.0
    brief_std = float(statistics.stdev(brief)) if len(brief) > 1 else 0.0

    return {
        "baseline": {
            "mean_reward": base_mean,
            "std": base_std,
            "episodes": len(base),
        },
        "with_briefing": {
            "mean_reward": brief_mean,
            "std": brief_std,
            "episodes": len(brief),
        },
        "delta": brief_mean - base_mean,
        "model": MODEL_NAME if _USE_UNSLOTH else MODEL_FALLBACK,
        "seed": BASE_SEED,
    }


def save_reward_curve(rows: List[Dict[str, Any]], plot_path: Path, caption_path: Path) -> None:
    """Plot the per-episode mean reward, split into phase-1 and phase-2 lines.

    The two lines share an x-axis: red = no-briefing baseline, blue = with-
    briefing intervention. A vertical dashed line at episode 20 marks where
    the briefing was introduced.
    """
    plot_path.parent.mkdir(parents=True, exist_ok=True)
    caption_path.parent.mkdir(parents=True, exist_ok=True)
    caption_path.write_text(CAPTION_TEXT + "\n", encoding="utf-8")

    if not _HAS_MATPLOTLIB or plt is None:
        print("[plot] matplotlib unavailable; skipped PNG (caption written).")
        return

    base = [(r["episode"], r["mean_reward"]) for r in rows if r["phase"] == 1]
    brief = [(r["episode"], r["mean_reward"]) for r in rows if r["phase"] == 2]

    fig, ax = plt.subplots(figsize=(10, 6))
    if base:
        bx, by = zip(*base)
        ax.plot(bx, by, color="red", linewidth=2, marker="o",
                label="No Briefing (baseline)")
    if brief:
        cx, cy = zip(*brief)
        ax.plot(cx, cy, color="blue", linewidth=2, marker="o",
                label="With District Briefing")

    ax.axvline(x=PHASE1_END, linestyle="--", color="gray", alpha=0.7)
    ymin, ymax = ax.get_ylim()
    ax.text(
        PHASE1_END + 0.4, ymax - (ymax - ymin) * 0.05,
        "Briefing introduced", rotation=90, va="top",
        fontsize=10, color="gray",
    )

    ax.set_xlabel("Episode")
    ax.set_ylabel("Mean Episode Reward")
    ax.set_title("Briefing vs No-Briefing — Same Model, Same Seed")
    ax.legend(loc="best")
    ax.grid(True, alpha=0.3)

    fig.tight_layout()
    fig.savefig(plot_path, dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"[plot] wrote {plot_path}")


# --------------------------------------------------------------------------- #
# Driver.
# --------------------------------------------------------------------------- #

def _maybe_init_wandb() -> None:
    """Init wandb if available AND key is set; otherwise silently skip."""
    if not _HAS_WANDB or wandb is None:
        return
    try:
        wandb.init(
            project="vaccine-cold-chain-grpo",
            config={
                "model": MODEL_NAME,
                "lr": LEARNING_RATE,
                "batch_size": BATCH_SIZE,
                "max_new_tokens": MAX_NEW_TOKENS,
                "total_episodes": TOTAL_EPISODES,
                "phase1_end": PHASE1_END,
                "scenario_id": SCENARIO_ID,
                "difficulty": DIFFICULTY,
                "seed": BASE_SEED,
            },
            mode="disabled" if not _wandb_logged_in() else "online",
        )
    except Exception as exc:
        print(f"[wandb] init failed ({exc}); continuing without wandb.")


def _wandb_logged_in() -> bool:
    """Best-effort: only enable wandb online mode when an API key is present."""
    import os  # local import keeps the module-level surface tight
    return bool(os.getenv("WANDB_API_KEY"))


def _maybe_log_wandb(row: Dict[str, Any]) -> None:
    if not _HAS_WANDB or wandb is None or wandb.run is None:
        return
    try:
        wandb.log({k: v for k, v in row.items() if not isinstance(v, str)})
    except Exception as exc:
        print(f"[wandb] log failed ({exc}); continuing.")


def _maybe_finish_wandb() -> None:
    if not _HAS_WANDB or wandb is None or wandb.run is None:
        return
    try:
        wandb.finish()
    except Exception:
        pass


def main() -> None:
    _require_torch("main / training loop")
    set_seed(BASE_SEED)
    _maybe_init_wandb()

    print(
        f"[config] model={MODEL_NAME if _USE_UNSLOTH else MODEL_FALLBACK}  "
        f"episodes={TOTAL_EPISODES}  phase1_end={PHASE1_END}  "
        f"scenario={SCENARIO_ID}  difficulty={DIFFICULTY}  seed={BASE_SEED}"
    )
    print(
        f"[config] briefing previews: "
        f"phase2='{SCENARIO_BRIEFINGS[SCENARIO_ID][:60]}...'"
    )

    model, tokenizer = load_model_and_tokenizer()
    device = _get_device(model)
    print(f"[load] model on {device}")

    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad],
        lr=LEARNING_RATE,
    )

    rows: List[Dict[str, Any]] = []
    for episode in range(1, TOTAL_EPISODES + 1):
        phase = 1 if episode <= PHASE1_END else 2
        row = grpo_episode(model, tokenizer, optimizer, episode, phase, device)
        rows.append(row)
        print(
            f"[ep {episode:>3}/{TOTAL_EPISODES} | phase {phase}] "
            f"reward={row['mean_reward']:+7.4f}  loss={row['loss']:+.4f}  "
            f"cov={row['coverage']:.3f}  temp={row['temperature_maintenance']:.3f}"
        )
        _maybe_log_wandb(row)

    save_log_csv(rows, LOG_CSV)
    summary = compute_summary(rows)
    SUMMARY_JSON.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY_JSON.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    save_reward_curve(rows, PLOT_PATH, CAPTION_PATH)

    base = summary["baseline"]
    brief = summary["with_briefing"]
    delta = summary["delta"]
    if abs(base["mean_reward"]) > 1e-9:
        improvement = delta / abs(base["mean_reward"])
    else:
        improvement = float("inf")
    print(
        f"Training complete. Key result: "
        f"baseline={base['mean_reward']:.3f} ± {base['std']:.3f}, "
        f"with briefing={brief['mean_reward']:.3f} ± {brief['std']:.3f}, "
        f"improvement={improvement:.1%}"
    )

    _maybe_finish_wandb()


def _get_device(model: Any) -> Any:
    """Best-effort device lookup that works for HF, Unsloth, and bare nn.Module."""
    if not _HAS_TORCH or torch is None:
        return "cpu"
    try:
        return next(model.parameters()).device
    except StopIteration:
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")


# Silence the unused-import lint when Optional is consumed only by type hints
# in older runtimes. (Optional is referenced by `Optional[int]` etc. above.)
_ = Optional


if __name__ == "__main__":
    main()
