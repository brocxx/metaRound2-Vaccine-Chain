#!/usr/bin/env python3
"""run_eval.py — One-command, no-server evaluator for Vaccine Cold Chain.

Usage (--no-server: no FastAPI, no Docker, no Next.js required — pure Python):

    python run_eval.py --agent rule_based_no_briefing --scenario 1 --episodes 50
    python run_eval.py --agent rule_based_with_briefing --scenario 1 --episodes 50
    OPENAI_API_KEY=sk-... python run_eval.py --agent gpt4 --scenario 3 --episodes 10

Why this script exists
----------------------
Running an evaluation against the live FastAPI/Next.js stack requires three
terminals, npm, Docker, and (often) HuggingFace Spaces credentials. That's
fine for an interactive demo, but it is the wrong shape for a judge who just
wants to reproduce a number from the README.

`run_eval.py` instantiates `VaccineColdChainEnv` directly via Python import
(NO HTTP CALLS, NO SERVER). It runs N reproducible episodes for a single
(agent, scenario) pair, collects per-episode total reward / rubric breakdown
/ actions / reasoning, then writes a JSON file with every raw episode plus
summary statistics and prints a concise terminal summary.

Agent design
------------
There are exactly four agent types, matching the ablation in the README:

    rule_based_no_briefing  : looks at structured sensor fields only.
                              If any node has temperature_alarm=True it
                              fires a panic emergency; otherwise it does
                              nothing. The ENV's existing action set has no
                              `transfer_stock`, so we map "panic at alarm"
                              to `request_emergency` (which the env
                              explicitly penalises during a sensor lie —
                              that is the false-alarm trap we want to
                              measure).
    rule_based_with_briefing: identical decision rule, but the briefing
                              text is prepended to its `reasoning`. This is
                              the CONTROL condition — it shows that simply
                              concatenating the briefing into the prompt
                              does nothing on its own; what matters is
                              whether the model can READ it.
    gpt35                   : OpenAI gpt-3.5-turbo. Builds a structured
                              prompt from `AgentNodeObservation` (no
                              leakage) plus the briefing, asks for a JSON
                              action, parses it.
    gpt4                    : same prompt, OpenAI gpt-4o (overridable via
                              OPENAI_GPT4_MODEL env var).

Episode shape
-------------
Each episode runs ONE key decision at hour 0, then no_op-advances time
until the env terminates (~72 hours later). This (a) keeps LLM cost
predictable (one API call per episode), and (b) gives a clean per-episode
signal: did the agent's first action match the scenario's optimal action?

Output
------
Writes a JSON file (default `eval_results.json`) with:

    {
      "config": {agent, scenario, episodes, seed, difficulty, ...},
      "episodes": [
        {episode_idx, seed, action, reasoning, total_reward,
         rubric_scores, optimal_action_taken, ...}
      ],
      "summary": {
        "mean_total_reward", "std_total_reward",
        "rubric_means": {...}, "rubric_stds": {...},
        "pct_optimal_action": <float>, ...
      }
    }
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Make `models` and `server.environment` importable when run from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from models import Action, AgentNodeObservation, Observation  # noqa: E402
from server.environment import (  # noqa: E402
    EPISODE_MAX_HOURS,
    SCENARIO_BRIEFINGS,
    VaccineColdChainEnv,
)


# --------------------------------------------------------------------------- #
# Optimal-action specs per scenario.
#
# The "optimal action at the key decision step" is what the briefed agent
# should pick at hour 0. Anything outside the optimal set counts as a miss.
# --------------------------------------------------------------------------- #

@dataclass
class OptimalActionSpec:
    """Declarative description of what counts as the optimal hour-0 action."""

    description: str
    allowed_action_types: Tuple[str, ...]
    required_node: Optional[str] = None
    forbidden_action_types: Tuple[str, ...] = ()
    forbidden_nodes: Tuple[str, ...] = ()

    def matches(self, action: Action) -> bool:
        if action.action_type in self.forbidden_action_types:
            return False
        if action.action_type not in self.allowed_action_types:
            return False
        if self.required_node and action.node != self.required_node:
            return False
        if action.node in self.forbidden_nodes:
            return False
        return True


SCENARIO_OPTIMAL: Dict[int, OptimalActionSpec] = {
    1: OptimalActionSpec(
        description=(
            "DON'T panic. The sensor is lying per the briefing; vials are "
            "physically safe. Optimal: no_op or a cheap info-gathering check."
        ),
        allowed_action_types=("no_op", "check_temperature", "check_truck_status"),
        forbidden_action_types=("request_emergency", "request_fuel"),
    ),
    2: OptimalActionSpec(
        description=(
            "Schedule outreach to PHC_Sindhari NOW, before the bridge closes "
            "at hour 8. Anything else (no_op, request_fuel, etc.) misses the window."
        ),
        allowed_action_types=("schedule_outreach",),
        required_node="PHC_Sindhari",
    ),
    3: OptimalActionSpec(
        description=(
            "Schedule outreach to CHC_Balotra (90 elderly confirmed). "
            "Picking PHC_Sindhari falls into the school-exam trap "
            "(only 12 of 100 children actually present)."
        ),
        allowed_action_types=("schedule_outreach",),
        required_node="CHC_Balotra",
        forbidden_nodes=("PHC_Sindhari",),
    ),
}


# --------------------------------------------------------------------------- #
# Agents.
# --------------------------------------------------------------------------- #

class BaseAgent:
    """Strategy interface. `decide(obs)` returns the next Action."""

    name: str = "base"
    uses_briefing: bool = False

    def decide(self, obs: Observation) -> Action:
        raise NotImplementedError

    def reset(self) -> None:
        """Hook for per-episode state. Default agents are stateless."""
        return None


class RuleBasedNoBriefingAgent(BaseAgent):
    """Acts only on structured sensor data; ignores the briefing entirely.

    Decision rule:
        if any(node.temperature_alarm): request_emergency at that node
        else:                          no_op
    """

    name = "rule_based_no_briefing"
    uses_briefing = False

    def decide(self, obs: Observation) -> Action:
        for node in obs.nodes:
            if node.temperature_alarm:
                return Action(
                    node=node.node_name,
                    action_type="request_emergency",
                    reasoning=(
                        f"temperature_alarm=True at {node.node_name} "
                        f"(sensor={node.sensor_reading}°C). "
                        "Rule-based response: escalate."
                    ),
                )
        return Action(
            node="DVS_Barmer",
            action_type="no_op",
            reasoning="No alarm fired across nodes. Rule-based response: idle.",
        )


class RuleBasedWithBriefingAgent(BaseAgent):
    """CONTROL condition: same rule as no-briefing, briefing prepended to reasoning.

    Demonstrates that merely shipping the briefing inside the prompt is
    insufficient — what matters is whether the policy can READ it. By
    construction this agent picks the same action as the no-briefing version
    at every step, so any reward delta comes purely from rubric components
    that read the reasoning string (e.g. proactive_info_seeking does not).
    """

    name = "rule_based_with_briefing"
    uses_briefing = True

    def __init__(self) -> None:
        self._inner = RuleBasedNoBriefingAgent()

    def decide(self, obs: Observation) -> Action:
        action = self._inner.decide(obs)
        action.reasoning = f"[BRIEFING: {obs.briefing}] {action.reasoning}"
        return action


class OpenAIAgent(BaseAgent):
    """LLM agent. Builds a prompt from AgentNodeObservation + briefing.

    Crucially, the prompt is constructed from `AgentNodeObservation`, which
    by design (Fix 1) does NOT carry `sensor_lying` or `actual_temperature`.
    The model must reason about a possibly-lying sensor from the briefing
    alone — the same constraint a real district officer would face.
    """

    uses_briefing = True

    def __init__(self, model: str, agent_label: str) -> None:
        self.name = agent_label
        self.model = model
        self._client = None  # lazy-initialised so the script imports without openai

    def _get_client(self):
        if self._client is None:
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise RuntimeError(
                    f"Agent '{self.name}' requires OPENAI_API_KEY. "
                    "Export it and re-run, or pick a rule_based_* agent."
                )
            try:
                from openai import OpenAI
            except ImportError as e:
                raise RuntimeError(
                    "openai package not installed. Run: pip install -r requirements.txt"
                ) from e
            self._client = OpenAI(api_key=api_key)
        return self._client

    @staticmethod
    def _node_line(node: AgentNodeObservation) -> str:
        return (
            f"  - {node.node_name}: sensor_reading={node.sensor_reading}°C, "
            f"generator_fuel_pct={node.generator_fuel_pct}, "
            f"temperature_alarm={node.temperature_alarm}, "
            f"vials_at_node={node.vials_at_node}, "
            f"vials_spoiled={node.vials_spoiled}"
        )

    def _build_prompt(self, obs: Observation) -> List[Dict[str, str]]:
        node_lines = "\n".join(self._node_line(n) for n in obs.nodes)
        system = (
            "You are an experienced district vaccine cold-chain officer in "
            "rural Rajasthan. You combine a written district briefing with "
            "live structured sensor data to make a single best decision. "
            "Sensors can be MISCALIBRATED — when the briefing flags a "
            "calibration fault, treat alarms with appropriate scepticism. "
            "Never invent fields you have not been shown.\n\n"
            "Reply with VALID JSON only, no prose, matching this schema:\n"
            '  {"action_type": "<one of: check_temperature, '
            'check_truck_status, request_fuel, schedule_outreach, '
            'request_emergency, no_op>", '
            '"node": "<DVS_Barmer | CHC_Balotra | PHC_Sindhari>", '
            '"quantity": <int, only for schedule_outreach>, '
            '"reasoning": "<one short sentence>"}'
        )
        user = (
            f"DISTRICT BRIEFING:\n{obs.briefing}\n\n"
            f"NODES (no privileged ground-truth fields are exposed to you):\n"
            f"{node_lines}\n\n"
            f"TIME: hour {obs.current_hour} of {EPISODE_MAX_HOURS}; "
            f"truck_arrived={obs.truck_arrived}; "
            f"ethical_tension_active={obs.ethical_tension_active}.\n\n"
            "Choose ONE action. Reply with VALID JSON only."
        )
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]

    def decide(self, obs: Observation) -> Action:
        client = self._get_client()
        messages = self._build_prompt(obs)
        # Low temperature so the rubric measures the model's reasoning, not
        # sampling variance. Episodes still vary because the env's RNG drifts
        # the observation across seeds.
        try:
            response = client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.2,
                max_tokens=200,
            )
            raw = response.choices[0].message.content.strip()
        except Exception as e:
            return Action(
                node="DVS_Barmer",
                action_type="no_op",
                reasoning=f"OpenAI call failed ({e}); falling back to no_op.",
            )
        return self._parse(raw)

    @staticmethod
    def _parse(raw: str) -> Action:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            # Strip ```json ... ``` wrappers.
            cleaned = cleaned.strip("`")
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:].lstrip()
        try:
            payload = json.loads(cleaned)
        except json.JSONDecodeError:
            return Action(
                node="DVS_Barmer",
                action_type="no_op",
                reasoning=f"LLM produced unparseable JSON: {raw[:200]!r}",
            )
        node = payload.get("node", "DVS_Barmer")
        action_type = payload.get("action_type", "no_op")
        quantity = payload.get("quantity")
        reasoning = payload.get("reasoning") or "(LLM provided no reasoning)"
        if quantity is not None:
            try:
                quantity = int(quantity)
            except (TypeError, ValueError):
                quantity = None
        return Action(
            node=str(node),
            action_type=str(action_type),
            quantity=quantity,
            reasoning=str(reasoning),
        )


def make_agent(agent_name: str) -> BaseAgent:
    if agent_name == "rule_based_no_briefing":
        return RuleBasedNoBriefingAgent()
    if agent_name == "rule_based_with_briefing":
        return RuleBasedWithBriefingAgent()
    if agent_name == "gpt4":
        model = os.getenv("OPENAI_GPT4_MODEL", "gpt-4o")
        return OpenAIAgent(model=model, agent_label="gpt4")
    if agent_name == "gpt35":
        model = os.getenv("OPENAI_GPT35_MODEL", "gpt-3.5-turbo")
        return OpenAIAgent(model=model, agent_label="gpt35")
    raise ValueError(
        f"Unknown agent '{agent_name}'. Pick one of: "
        "rule_based_no_briefing, rule_based_with_briefing, gpt4, gpt35"
    )


# --------------------------------------------------------------------------- #
# Episode runner.
# --------------------------------------------------------------------------- #

@dataclass
class EpisodeResult:
    episode_idx: int
    seed: int
    key_action: Dict[str, Any]
    key_reasoning: str
    optimal_action_taken: bool
    actions: List[Dict[str, Any]] = field(default_factory=list)
    reasoning_trace: List[str] = field(default_factory=list)
    total_reward: float = 0.0
    final_rubric_scores: Dict[str, float] = field(default_factory=dict)
    coverage: float = 0.0
    waste: float = 0.0
    missed_sessions: int = 0
    population_reached: int = 0
    total_population_target: int = 0
    final_hour: int = 0
    done: bool = False
    elapsed_ms: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "episode_idx": self.episode_idx,
            "seed": self.seed,
            "key_action": self.key_action,
            "key_reasoning": self.key_reasoning,
            "optimal_action_taken": self.optimal_action_taken,
            "actions": self.actions,
            "reasoning_trace": self.reasoning_trace,
            "total_reward": round(self.total_reward, 4),
            "final_rubric_scores": self.final_rubric_scores,
            "coverage": round(self.coverage, 4),
            "waste": round(self.waste, 4),
            "missed_sessions": self.missed_sessions,
            "population_reached": self.population_reached,
            "total_population_target": self.total_population_target,
            "final_hour": self.final_hour,
            "done": self.done,
            "elapsed_ms": round(self.elapsed_ms, 2),
        }


def run_one_episode(
    env: VaccineColdChainEnv,
    agent: BaseAgent,
    scenario: int,
    seed: int,
    difficulty: str,
    episode_idx: int,
    max_steps: int = 200,
) -> EpisodeResult:
    """Run a single episode: agent acts at hour 0, then env idles to done.

    Returns an EpisodeResult capturing the key decision, the full rollout,
    and end-of-episode rubric breakdown.
    """
    t0 = time.perf_counter()
    obs = env.reset(difficulty=difficulty, seed=seed, scenario=scenario)
    agent.reset()

    # ---- Key decision step ----
    key_action = agent.decide(obs)
    spec = SCENARIO_OPTIMAL[scenario]
    optimal = spec.matches(key_action)
    key_step = env.step(key_action)

    actions: List[Dict[str, Any]] = [key_action.to_dict()]
    reasoning_trace: List[str] = [key_action.reasoning or ""]
    total_reward = key_step.reward

    # ---- Idle the rest of the episode with no_op so total_reward and the
    # rubric reflect the consequences of the key decision, not whatever the
    # agent might have improvised next. This also caps LLM cost at 1 call/ep.
    steps_taken = 1
    while not key_step.done and steps_taken < max_steps:
        idle_action = Action(
            node="DVS_Barmer",
            action_type="no_op",
            reasoning="auto-idle after key decision",
        )
        key_step = env.step(idle_action)
        actions.append(idle_action.to_dict())
        reasoning_trace.append(idle_action.reasoning or "")
        total_reward += key_step.reward
        steps_taken += 1

    final_state = env.state()
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    return EpisodeResult(
        episode_idx=episode_idx,
        seed=seed,
        key_action=key_action.to_dict(),
        key_reasoning=key_action.reasoning or "",
        optimal_action_taken=optimal,
        actions=actions,
        reasoning_trace=reasoning_trace,
        total_reward=total_reward,
        final_rubric_scores=dict(final_state.rubric_scores),
        coverage=final_state.coverage,
        waste=final_state.waste,
        missed_sessions=final_state.missed_sessions,
        population_reached=final_state.population_reached,
        total_population_target=final_state.total_population_target,
        final_hour=final_state.current_hour,
        done=final_state.done,
        elapsed_ms=elapsed_ms,
    )


# --------------------------------------------------------------------------- #
# Aggregation + reporting.
# --------------------------------------------------------------------------- #

def _mean_std(values: List[float]) -> Tuple[float, float]:
    if not values:
        return 0.0, 0.0
    if len(values) == 1:
        return float(values[0]), 0.0
    return float(statistics.mean(values)), float(statistics.stdev(values))


def summarise(episodes: List[EpisodeResult]) -> Dict[str, Any]:
    rewards = [e.total_reward for e in episodes]
    coverages = [e.coverage for e in episodes]
    wastes = [e.waste for e in episodes]
    optimal_hits = sum(1 for e in episodes if e.optimal_action_taken)

    rubric_keys = sorted({
        k for e in episodes for k in e.final_rubric_scores.keys()
    })
    rubric_means: Dict[str, float] = {}
    rubric_stds: Dict[str, float] = {}
    for key in rubric_keys:
        values = [e.final_rubric_scores.get(key, 0.0) for e in episodes]
        m, s = _mean_std(values)
        rubric_means[key] = round(m, 4)
        rubric_stds[key] = round(s, 4)

    reward_mean, reward_std = _mean_std(rewards)
    coverage_mean, coverage_std = _mean_std(coverages)
    waste_mean, waste_std = _mean_std(wastes)

    pct_optimal = (optimal_hits / len(episodes) * 100.0) if episodes else 0.0

    return {
        "n_episodes": len(episodes),
        "mean_total_reward": round(reward_mean, 4),
        "std_total_reward": round(reward_std, 4),
        "mean_coverage": round(coverage_mean, 4),
        "std_coverage": round(coverage_std, 4),
        "mean_waste": round(waste_mean, 4),
        "std_waste": round(waste_std, 4),
        "rubric_means": rubric_means,
        "rubric_stds": rubric_stds,
        "pct_optimal_action": round(pct_optimal, 2),
        "optimal_action_hits": optimal_hits,
    }


def print_summary(
    args: argparse.Namespace, summary: Dict[str, Any], output_path: Path
) -> None:
    spec = SCENARIO_OPTIMAL[args.scenario]
    bar = "=" * 78
    print(bar)
    print("  Vaccine Cold Chain — Eval Summary")
    print(bar)
    print(f"  Agent      : {args.agent}")
    print(f"  Scenario   : {args.scenario}  ({spec.description.splitlines()[0]})")
    print(f"  Difficulty : {args.difficulty}")
    print(f"  Episodes   : {summary['n_episodes']}  (base seed: {args.seed})")
    print("-" * 78)
    print(
        f"  Mean total reward      : {summary['mean_total_reward']:>8.4f}  "
        f"± {summary['std_total_reward']:.4f}"
    )
    print(
        f"  Mean coverage          : {summary['mean_coverage'] * 100:>7.2f}%  "
        f"± {summary['std_coverage'] * 100:.2f}%"
    )
    print(
        f"  Mean waste             : {summary['mean_waste'] * 100:>7.2f}%  "
        f"± {summary['std_waste'] * 100:.2f}%"
    )
    print(
        f"  Optimal-action rate    : {summary['pct_optimal_action']:>7.2f}%  "
        f"({summary['optimal_action_hits']}/{summary['n_episodes']})"
    )
    print("-" * 78)
    print("  Rubric breakdown (mean ± std):")
    for key in sorted(summary["rubric_means"].keys()):
        m = summary["rubric_means"][key]
        s = summary["rubric_stds"][key]
        print(f"    {key:<28}: {m:>7.4f}  ± {s:.4f}")
    print(bar)
    print(f"  Wrote raw + summary JSON -> {output_path}")
    print(bar)


# --------------------------------------------------------------------------- #
# CLI.
# --------------------------------------------------------------------------- #

def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="run_eval.py",
        description=(
            "One-command in-process evaluator for Vaccine Cold Chain (no "
            "FastAPI server, no Docker, no Next.js — pure Python)."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--agent",
        choices=("rule_based_no_briefing", "rule_based_with_briefing",
                 "gpt4", "gpt35"),
        required=True,
        help=(
            "Which agent to evaluate. gpt4 / gpt35 require OPENAI_API_KEY "
            "in the environment."
        ),
    )
    parser.add_argument(
        "--scenario", type=int, choices=(1, 2, 3), required=True,
        help="1 = sensor false alarm, 2 = closing road window, 3 = triage.",
    )
    parser.add_argument("--episodes", type=int, default=50,
                        help="Number of episodes to run.")
    parser.add_argument("--seed", type=int, default=42,
                        help="Base seed; episode i uses seed + i.")
    parser.add_argument(
        "--difficulty",
        choices=("easy", "medium", "hard"), default="hard",
        help="Difficulty preset for HAZARD_PROBABILITIES.",
    )
    parser.add_argument(
        "--output", type=str, default="eval_results.json",
        help="Path to write the raw + summary JSON.",
    )
    parser.add_argument(
        "--max-steps", type=int, default=EPISODE_MAX_HOURS + 5,
        help="Hard cap on env steps per episode (safety net).",
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)

    # Sanity-check the OpenAI key BEFORE we spin up the env / waste time.
    if args.agent in {"gpt4", "gpt35"} and not os.getenv("OPENAI_API_KEY"):
        print(
            f"[ERROR] Agent '{args.agent}' requires OPENAI_API_KEY in the "
            "environment. Export it and re-run, or pick a rule_based_* agent.",
            file=sys.stderr,
        )
        return 2

    if args.scenario not in SCENARIO_BRIEFINGS:
        print(
            f"[ERROR] Unknown scenario {args.scenario}. Expected one of "
            f"{sorted(SCENARIO_BRIEFINGS.keys())}.",
            file=sys.stderr,
        )
        return 2

    agent = make_agent(args.agent)
    env = VaccineColdChainEnv()

    print(
        f"[INFO] Running {args.episodes} episode(s) of agent={args.agent} "
        f"on scenario={args.scenario} (difficulty={args.difficulty})..."
    )

    episodes: List[EpisodeResult] = []
    for i in range(args.episodes):
        episode_seed = args.seed + i
        result = run_one_episode(
            env=env,
            agent=agent,
            scenario=args.scenario,
            seed=episode_seed,
            difficulty=args.difficulty,
            episode_idx=i,
            max_steps=args.max_steps,
        )
        episodes.append(result)
        if (i + 1) % max(1, args.episodes // 10) == 0 or i + 1 == args.episodes:
            print(
                f"  [{i + 1:>4}/{args.episodes}] "
                f"reward={result.total_reward:+7.3f}  "
                f"optimal={result.optimal_action_taken!s:5}  "
                f"action={result.key_action.get('action_type')}"
                f"({result.key_action.get('node')})"
            )

    summary = summarise(episodes)

    output_path = Path(args.output).resolve()
    payload = {
        "config": {
            "agent": args.agent,
            "scenario": args.scenario,
            "scenario_optimal_description": SCENARIO_OPTIMAL[args.scenario].description,
            "scenario_briefing": SCENARIO_BRIEFINGS[args.scenario],
            "episodes": args.episodes,
            "seed": args.seed,
            "difficulty": args.difficulty,
            "max_steps": args.max_steps,
            "no_server": True,
        },
        "summary": summary,
        "episodes": [e.to_dict() for e in episodes],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print_summary(args, summary, output_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
