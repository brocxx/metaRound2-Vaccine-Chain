"""
VaccineColdChainEnv — OpenEnv-compliant RL environment for vaccine cold chain
management in rural India.

This is the core environment logic for Round 2. Subclasses OpenEnv's
Environment base class (with a graceful fallback for local testing).

KEY MECHANICS:
- 3 nodes: DVS_Barmer (district vaccine store), CHC_Balotra (community health
  center), PHC_Sindhari (primary health center).
- Probabilistic hazards per difficulty (flood, generator failure, lying sensor).
- Lying sensor lifts temperature reading by uniform(1.5, 3.0) °C, capped at 12°C.
  The temperature "looks high" while the generator is fine — a visible
  contradiction. This is THE demo moment.
- Ethical tension flag (hard mode): 200 children vs 70 elderly.
- Briefing required on /reset; combines with sensor data for LLM decisions.
"""

import os
import random
from typing import Optional, Dict, Any, List, Tuple

from models import (
    Action,
    AgentNodeObservation,
    Observation,
    NodeObservation,
    State,
    StepResult,
    VALID_ACTION_TYPES,
    VALID_NODES,
)
from server.briefings import generate_briefing
from server.rubrics import VaccineRubric


try:
    from openenv import Environment as _OpenEnvBase
    OPENENV_AVAILABLE = True
except ImportError:
    try:
        from openenv.core import Environment as _OpenEnvBase
        OPENENV_AVAILABLE = True
    except ImportError:
        class _OpenEnvBase:
            """Local fallback when openenv-core is not yet installed.

            The class shape matches the OpenEnv contract (reset/step/state).
            Production deployment installs openenv-core via requirements.txt.
            """

            def __init__(self, *args, **kwargs):
                pass

        OPENENV_AVAILABLE = False


SAFE_TEMP_MIN = 2.0
SAFE_TEMP_MAX = 8.0
SENSOR_LIE_LIFT_MIN = 1.5
SENSOR_LIE_LIFT_MAX = 3.0
SENSOR_READING_CAP = 12.0
EPISODE_MAX_HOURS = 72

# Scenario presets used by run_eval.py (and any external evaluator) to get
# reproducible, signal-bearing episodes. Each preset overrides the briefing
# (unless the caller supplied user_briefing) and forces specific initial
# conditions so the briefed-vs-unbriefed gap is measurable.
SCENARIO_BRIEFINGS = {
    1: (
        "Sensor false alarm — DVS_Barmer's temperature sensor was flagged for "
        "a calibration fault last quarter and has not been serviced. Current "
        "readings may sit 2–4°C ABOVE the true cold-chain temperature, so a "
        "reading near 9°C usually corresponds to a real value of ~5°C. "
        "Generator fuel is at 100% and was just topped up; vials at DVS_Barmer "
        "are physically safe. Truck arrives at hour 12. Coverage target: 200."
    ),
    2: (
        "Closing road window — Heavy monsoon flooding has compromised the "
        "Barmer–Sindhari link. The bridge will close at hour 8 and stay shut "
        "for the remainder of the day. Any vials needed at PHC_Sindhari MUST "
        "be scheduled for delivery before the window closes. Truck arrival "
        "uncertain. Coverage target: 200 beneficiaries (split across nodes)."
    ),
    3: (
        "Triage call — Two competing outreach sessions today, but cold-chain "
        "and crew capacity to fully run only ONE. PHC_Sindhari outreach "
        "coordinator confirmed by phone that only 12 of the 100 registered "
        "children are available today due to a school exam — effective "
        "coverage at PHC_Sindhari will be 12%. CHC_Balotra's 90 elderly are "
        "all confirmed present and waiting. Choose the session that will "
        "actually translate vials into people reached."
    ),
}

# Per-node demographic for the scenario-3 triage. PHC_Sindhari is the
# pediatric session; CHC_Balotra is the elderly session. Only used when a
# scenario is set so default behaviour is unchanged.
SCENARIO_NODE_DEMOGRAPHIC = {
    "PHC_Sindhari": "children",
    "CHC_Balotra": "elderly",
    "DVS_Barmer": "mixed",
}


HAZARD_PROBABILITIES = {
    "easy": {
        "flood_per_hour": 0.0,
        "generator_failure_per_hour": 0.0,
        "lying_sensor_per_hour": 0.0,
    },
    "medium": {
        "flood_per_hour": 0.08,
        "generator_failure_per_hour": 0.10,
        "lying_sensor_per_hour": 0.10,
    },
    "hard": {
        "flood_per_hour": 0.18,
        "generator_failure_per_hour": 0.15,
        "lying_sensor_per_hour": 0.30,
    },
}


NODE_CONFIG = {
    "DVS_Barmer": {
        "type": "district_vaccine_store",
        "initial_vials": 800,
        "initial_fuel": 100.0,
        "initial_temp": 5.0,
        "fuel_burn_per_hour": 1.5,
    },
    "CHC_Balotra": {
        "type": "community_health_center",
        "initial_vials": 200,
        "initial_fuel": 100.0,
        "initial_temp": 5.0,
        "fuel_burn_per_hour": 1.2,
    },
    "PHC_Sindhari": {
        "type": "primary_health_center",
        "initial_vials": 100,
        "initial_fuel": 100.0,
        "initial_temp": 5.0,
        "fuel_burn_per_hour": 1.0,
    },
}


class VaccineColdChainEnv(_OpenEnvBase):
    """Vaccine cold chain RL environment subclassing OpenEnv's Environment.

    Standard OpenEnv contract:
      - reset(difficulty, district, user_briefing) -> Observation (with briefing)
      - step(action) -> StepResult(observation, reward, done, info)
      - state() -> State (full ground truth for UI)
    """

    def __init__(self, seed: Optional[int] = None):
        super().__init__()
        self._rng = random.Random(seed)
        self._initialized = False
        self.difficulty = "medium"
        self.district = "barmer"
        self._rubric = VaccineRubric()
        self._reset_state()

    def _reset_state(self):
        """Initialize all per-episode state to defaults."""
        self.nodes_state: Dict[str, Dict[str, Any]] = {}
        for node_name, cfg in NODE_CONFIG.items():
            self.nodes_state[node_name] = {
                "actual_temperature": cfg["initial_temp"],
                "generator_fuel_pct": cfg["initial_fuel"],
                "vials_at_node": cfg["initial_vials"],
                "vials_spoiled": 0,
                "sensor_lying": False,
                "sensor_lie_offset": 0.0,
                "generator_working": True,
                "flood_active": False,
                "fuel_burn_per_hour": cfg["fuel_burn_per_hour"],
            }
        self.current_hour = 0
        self.briefing = ""
        self.truck_arrived = False
        self.truck_arrival_hour = 12
        self.ethical_tension_active = False
        self.last_action: Optional[Dict[str, Any]] = None
        self.last_reasoning: Optional[str] = None
        self.events: List[str] = []
        self.action_history: List[Dict[str, Any]] = []
        self.total_vials_at_start = sum(c["initial_vials"] for c in NODE_CONFIG.values())
        self.total_vials_delivered = 0
        self.total_population_target = 200
        self.population_reached = 0
        self.children_population = 200
        self.elderly_population = 70
        self.children_vaccinated = 0
        self.elderly_vaccinated = 0
        self.coverage = 0.0
        self.waste = 0.0
        self.missed_sessions = 0
        self.rubric_scores: Dict[str, float] = {}
        self.done = False
        self.last_event: Optional[str] = None
        self.proactive_check_count = 0
        self.emergency_during_lie_count = 0
        self.fuel_requests_during_lie_count = 0
        self.unnecessary_fuel_requests = 0
        self.total_actions = 0
        self.node_hours_in_safe_range = 0
        self.total_node_hours = 0
        # Scenario-mode state. None = default (free-running) episode.
        self.scenario_id: Optional[int] = None
        # Per-node cap on how many vaccinations a single outreach session can
        # actually translate to "people reached" — used by scenario 3 to model
        # the 12% turnout fact in the briefing. Vials are still consumed; only
        # `population_reached` is capped.
        self._session_capacity_override: Dict[str, int] = {}
        # Hour at which a scenario-2-style road closure makes outreach to a
        # specific node fail. None = no closure.
        self._scenario2_deadline_hour: Optional[int] = None

    def reset(
        self,
        difficulty: str = "medium",
        district: str = "barmer",
        user_briefing: Optional[str] = None,
        seed: Optional[int] = None,
        scenario: Optional[int] = None,
    ) -> Observation:
        """Reset the environment for a new episode.

        Args:
            difficulty: "easy", "medium", or "hard"
            district: "nashik", "barmer", or "godda" (drives briefing content)
            user_briefing: Optional pre-supplied briefing text
            seed: Optional RNG seed for reproducibility
            scenario: Optional preset (1, 2, or 3). When set, forces
                deterministic initial conditions and overrides the briefing
                with the scenario-specific text (unless `user_briefing` is
                also provided). Used by run_eval.py to produce signal-bearing
                evaluation episodes; default `None` keeps the standard
                free-running behaviour.

        Returns:
            Initial Observation with briefing populated.
        """
        difficulty = difficulty.lower().strip()
        if difficulty not in HAZARD_PROBABILITIES:
            difficulty = "medium"

        self.difficulty = difficulty
        self.district = district.lower().strip()
        if seed is not None:
            self._rng = random.Random(seed)

        self._reset_state()

        self.briefing = generate_briefing(
            difficulty=self.difficulty,
            district=self.district,
            user_briefing=user_briefing,
        )

        if self.difficulty == "hard":
            self.ethical_tension_active = True
            self.total_population_target = self.children_population + self.elderly_population
            self._log_event(
                f"ETHICAL TENSION ACTIVE: {self.children_population} children vs "
                f"{self.elderly_population} elderly. Triage decisions required."
            )
        else:
            self.ethical_tension_active = False
            self.total_population_target = 200

        if scenario is not None:
            self._apply_scenario(int(scenario), user_briefing)

        self._initialized = True
        self._log_event(f"Episode started. Difficulty={self.difficulty}, district={self.district}.")
        self._compute_simple_metrics()
        return self._build_observation()

    def _apply_scenario(self, scenario_id: int, user_briefing: Optional[str]) -> None:
        """Configure the env for a specific evaluation scenario (1, 2, or 3).

        Each preset:
          1. (Optionally) overrides the briefing with the scenario-specific
             text, unless the caller already supplied `user_briefing`.
          2. Forces specific initial conditions so the briefed-vs-unbriefed
             gap is deterministic and measurable.

        Scenario 1 — Sensor false alarm:
            Forces `sensor_lying=True` at DVS_Barmer with a 3°C lift, so the
            initial observation shows a temperature_alarm even though the
            generator and vials are physically fine. A briefed agent should
            recognise the calibration-fault narrative and decline to panic.
        Scenario 2 — Closing road window:
            Pushes truck arrival to hour 30 and arms a hard road-closure at
            hour 8 for PHC_Sindhari. Outreach scheduled to PHC_Sindhari
            after that hour delivers ZERO effective vaccinations. A briefed
            agent should schedule outreach at hour 0; an unbriefed agent
            sees no sensor signal and waits, missing the window.
        Scenario 3 — Triage call:
            Forces ethical tension and caps the EFFECTIVE population reach
            of each outreach session: PHC_Sindhari = 12 (school-exam day),
            CHC_Balotra = 90 (full attendance). Vials are still consumed
            normally, so the agent who follows the naive
            "pediatric-first-dose > elderly-booster" prior reaches only 12
            people; the briefed agent reaches 90 by choosing CHC_Balotra.
        """
        if scenario_id not in SCENARIO_BRIEFINGS:
            raise ValueError(
                f"Unknown scenario {scenario_id}; expected one of "
                f"{sorted(SCENARIO_BRIEFINGS.keys())}"
            )

        self.scenario_id = scenario_id
        if not user_briefing:
            self.briefing = SCENARIO_BRIEFINGS[scenario_id]

        if scenario_id == 1:
            n = self.nodes_state["DVS_Barmer"]
            n["sensor_lying"] = True
            # Lift 4°C on a 5°C baseline → reading 9°C, comfortably past the
            # 8°C alarm threshold so the unbriefed rule-based agent reliably
            # sees `temperature_alarm=True` on its first observation.
            n["sensor_lie_offset"] = 4.0
            self._log_event(
                "SCENARIO 1: DVS_Barmer sensor lying (recalibration fault). "
                "Reading lifted by 4.0°C; alarm WILL fire on first observation."
            )
        elif scenario_id == 2:
            self.truck_arrival_hour = 30
            self._scenario2_deadline_hour = 8
            self._log_event(
                "SCENARIO 2: PHC_Sindhari road closes at hour 8. "
                "Truck delayed to hour 30."
            )
        elif scenario_id == 3:
            # Pin populations so the briefing's "100 registered children"
            # and "90 elderly" facts match the env's actual cohort sizes.
            # Otherwise the effective-coverage cap (90) would clip against
            # the smaller default elderly_population (70) and the rubric
            # signal would understate the gap between the briefed and
            # naive choices.
            self.children_population = 100
            self.elderly_population = 90
            self.ethical_tension_active = True
            self.total_population_target = (
                self.children_population + self.elderly_population
            )
            self._session_capacity_override = {
                "PHC_Sindhari": 12,   # 12% turnout (school exam)
                "CHC_Balotra": 90,    # 100% turnout (all confirmed)
            }
            self._log_event(
                "SCENARIO 3: PHC_Sindhari turnout=12/100 (school exam), "
                "CHC_Balotra turnout=90/90 (all confirmed). Triage required."
            )

    def step(self, action: Action) -> StepResult:
        """Execute one action and advance the simulation.

        Args:
            action: Action dataclass (or compatible dict-like)

        Returns:
            StepResult with observation, reward, done, info.
        """
        if not self._initialized:
            self.reset()

        if isinstance(action, dict):
            action = Action(
                node=action.get("node", "DVS_Barmer"),
                action_type=action.get("action_type", "no_op"),
                quantity=action.get("quantity"),
                reasoning=action.get("reasoning"),
            )

        validation_error = action.validate()
        if validation_error:
            self._log_event(f"INVALID ACTION: {validation_error}")
            return StepResult(
                observation=self._build_observation(),
                reward=-1.0,
                done=self.done,
                info={"error": validation_error},
            )

        self.last_action = action.to_dict()
        self.last_reasoning = action.reasoning
        self.action_history.append(action.to_dict())
        self.total_actions += 1

        action_cost_hours, action_reward, action_info = self._execute_action(action)

        for _ in range(max(1, int(action_cost_hours))):
            self._advance_one_hour()
            if self.done:
                break

        if self.current_hour >= EPISODE_MAX_HOURS:
            self.done = True
            self._log_event(f"Episode complete at hour {self.current_hour}.")

        self._compute_simple_metrics()

        if self.done:
            action_info["rubric_scores"] = dict(self.rubric_scores)
            action_info["simple_metrics"] = {
                "coverage": self.coverage,
                "waste": self.waste,
                "missed_sessions": self.missed_sessions,
            }

        return StepResult(
            observation=self._build_observation(),
            reward=action_reward,
            done=self.done,
            info=action_info,
        )

    def _execute_action(self, action: Action) -> Tuple[float, float, Dict[str, Any]]:
        """Execute a single action and return (cost_hours, reward, info)."""
        atype = action.action_type
        node = action.node
        info: Dict[str, Any] = {"action_type": atype, "node": node}

        if atype == "no_op":
            self._log_event(f"NO_OP at hour {self.current_hour}.")
            return 1.0, 0.0, info

        if atype == "check_temperature":
            self.proactive_check_count += 1
            n = self.nodes_state[node]
            reading = self._compute_sensor_reading(n)
            self._log_event(
                f"Check temperature at {node}: sensor={reading:.1f}°C "
                f"(actual={n['actual_temperature']:.1f}°C, lying={n['sensor_lying']})"
            )
            info["sensor_reading"] = reading
            info["actual_temperature"] = n["actual_temperature"]
            info["sensor_lying"] = n["sensor_lying"]
            return 0.5, 0.05, info

        if atype == "check_truck_status":
            self.proactive_check_count += 1
            arrived = self.truck_arrived
            arrival_hour = self.truck_arrival_hour
            self._log_event(
                f"Check truck status: arrived={arrived}, expected_hour={arrival_hour}"
            )
            info["truck_arrived"] = arrived
            info["truck_expected_hour"] = arrival_hour
            return 0.5, 0.05, info

        if atype == "request_fuel":
            n = self.nodes_state[node]
            previous_fuel = n["generator_fuel_pct"]
            lie_active = any(s["sensor_lying"] for s in self.nodes_state.values())
            if lie_active:
                self.fuel_requests_during_lie_count += 1

            if previous_fuel >= 80.0:
                self.unnecessary_fuel_requests += 1
                self._log_event(
                    f"WASTE: Fuel requested at {node} but tank already at {previous_fuel:.0f}%."
                )
                penalty = -0.5 if not lie_active else -1.0
                return 2.0, penalty, {"action_type": atype, "node": node, "wasted": True}

            n["generator_fuel_pct"] = min(100.0, previous_fuel + 50.0)
            self._log_event(
                f"Fuel delivered to {node}: {previous_fuel:.0f}% -> {n['generator_fuel_pct']:.0f}%"
            )
            return 2.0, 0.2, {"action_type": atype, "node": node}

        if atype == "schedule_outreach":
            n = self.nodes_state[node]
            requested = action.quantity or 0
            available = n["vials_at_node"]
            delivered = min(requested, available)

            # Scenario-2 hard road closure: outreach to PHC_Sindhari after the
            # bridge closes delivers ZERO effective vaccinations.
            if (
                self.scenario_id == 2
                and node == "PHC_Sindhari"
                and self._scenario2_deadline_hour is not None
                and self.current_hour >= self._scenario2_deadline_hour
            ):
                self.missed_sessions += 1
                self._log_event(
                    f"OUTREACH at {node} BLOCKED: bridge closed at hour "
                    f"{self._scenario2_deadline_hour} (now hour {self.current_hour})."
                )
                return 4.0, -0.5, {
                    "action_type": atype, "node": node,
                    "delivered": 0, "effective": 0, "blocked": True,
                }

            if delivered <= 0:
                self.missed_sessions += 1
                self._log_event(f"MISSED SESSION at {node}: no vials available.")
                return 4.0, -0.3, {"action_type": atype, "node": node, "delivered": 0, "effective": 0}

            spoiled = 0
            if n["actual_temperature"] < SAFE_TEMP_MIN or n["actual_temperature"] > SAFE_TEMP_MAX:
                spoiled = delivered // 2
                delivered -= spoiled
                n["vials_spoiled"] += spoiled
                self._log_event(
                    f"OUTREACH at {node}: {delivered} vials delivered, "
                    f"{spoiled} spoiled due to bad temp ({n['actual_temperature']:.1f}°C)."
                )
            else:
                self._log_event(f"OUTREACH at {node}: {delivered} vials delivered safely.")

            n["vials_at_node"] -= (delivered + spoiled)
            self.total_vials_delivered += delivered

            # Scenario-3 effective-coverage cap: vials are physically delivered,
            # but the number of people actually vaccinated is capped by today's
            # session attendance (e.g., 12% turnout at PHC_Sindhari).
            session_cap = self._session_capacity_override.get(node)
            if session_cap is not None:
                effective = min(delivered, session_cap)
                self._session_capacity_override[node] = max(0, session_cap - effective)
                if effective < delivered:
                    self._log_event(
                        f"OUTREACH at {node}: only {effective}/{delivered} vials "
                        f"translated to vaccinations (session capacity cap)."
                    )
            else:
                effective = delivered

            if self.ethical_tension_active:
                # Demographic-aware routing only when running a scenario;
                # default free-running episodes keep the original
                # children-first behaviour for backward compatibility with
                # smoke_test_1c.py and existing rubric calibration.
                if self.scenario_id is not None:
                    demo = SCENARIO_NODE_DEMOGRAPHIC.get(node, "mixed")
                else:
                    demo = "mixed"

                if demo == "children":
                    delta = min(effective, max(0, self.children_population - self.children_vaccinated))
                    self.children_vaccinated += delta
                elif demo == "elderly":
                    delta = min(effective, max(0, self.elderly_population - self.elderly_vaccinated))
                    self.elderly_vaccinated += delta
                else:
                    children_share = min(effective, max(0, self.children_population - self.children_vaccinated))
                    self.children_vaccinated += children_share
                    remaining = effective - children_share
                    if remaining > 0:
                        elderly_share = min(remaining, max(0, self.elderly_population - self.elderly_vaccinated))
                        self.elderly_vaccinated += elderly_share
                self.population_reached = self.children_vaccinated + self.elderly_vaccinated
            else:
                self.population_reached = min(
                    self.total_population_target, self.population_reached + effective
                )

            return 4.0, 0.5 + 0.001 * effective, {
                "action_type": atype, "node": node,
                "delivered": delivered, "effective": effective,
            }

        if atype == "request_emergency":
            lie_active = any(s["sensor_lying"] for s in self.nodes_state.values())
            n = self.nodes_state[node]
            real_emergency = (
                n["actual_temperature"] < SAFE_TEMP_MIN - 1.0
                or n["actual_temperature"] > SAFE_TEMP_MAX + 1.0
                or n["generator_fuel_pct"] < 10.0
                or n["flood_active"]
            )

            if real_emergency:
                self._log_event(f"EMERGENCY (justified) at {node}: real conditions critical.")
                return 1.0, 0.3, {"action_type": atype, "node": node, "justified": True}

            if lie_active:
                self.emergency_during_lie_count += 1
                self._log_event(
                    f"EMERGENCY (FALSE ALARM) at {node}: sensor lying. "
                    "Briefing should have flagged this!"
                )
                return 1.0, -1.0, {"action_type": atype, "node": node, "justified": False, "false_alarm": True}

            self._log_event(f"EMERGENCY (unjustified) at {node}: no real hazard.")
            return 1.0, -0.5, {"action_type": atype, "node": node, "justified": False}

        return 1.0, 0.0, {"action_type": atype}

    def _advance_one_hour(self):
        """Advance simulation by one hour: roll hazards, burn fuel, drift temps."""
        self.current_hour += 1
        probs = HAZARD_PROBABILITIES[self.difficulty]

        if not self.truck_arrived and self.current_hour >= self.truck_arrival_hour:
            if self._rng.random() < 0.7 or self.difficulty == "easy":
                self.truck_arrived = True
                self._log_event(f"TRUCK ARRIVED at hour {self.current_hour}.")
            else:
                self.truck_arrival_hour += 2
                self._log_event(f"Truck delayed; new ETA hour {self.truck_arrival_hour}.")

        for node_name, n in self.nodes_state.items():
            if n["generator_working"]:
                n["generator_fuel_pct"] = max(0.0, n["generator_fuel_pct"] - n["fuel_burn_per_hour"])

            if self._rng.random() < probs["flood_per_hour"] and not n["flood_active"]:
                n["flood_active"] = True
                self._log_event(f"FLOOD HAZARD at {node_name} (hour {self.current_hour}).")

            if self._rng.random() < probs["generator_failure_per_hour"] and n["generator_working"]:
                n["generator_working"] = False
                self._log_event(f"GENERATOR FAILURE at {node_name} (hour {self.current_hour}).")

            if n["sensor_lying"]:
                if self._rng.random() < 0.4:
                    n["sensor_lying"] = False
                    n["sensor_lie_offset"] = 0.0
                    self._log_event(f"Sensor at {node_name} recovered (no longer lying).")
            else:
                if self._rng.random() < probs["lying_sensor_per_hour"]:
                    n["sensor_lying"] = True
                    n["sensor_lie_offset"] = self._rng.uniform(
                        SENSOR_LIE_LIFT_MIN, SENSOR_LIE_LIFT_MAX
                    )
                    self._log_event(
                        f"SENSOR LYING at {node_name}: lifts reading by "
                        f"{n['sensor_lie_offset']:.1f}°C (actual="
                        f"{n['actual_temperature']:.1f}°C)."
                    )

            self._update_actual_temperature(node_name, n)

            self.total_node_hours += 1
            if SAFE_TEMP_MIN <= n["actual_temperature"] <= SAFE_TEMP_MAX:
                self.node_hours_in_safe_range += 1

            if (n["actual_temperature"] > SAFE_TEMP_MAX + 2.0) and n["vials_at_node"] > 0:
                spoil = max(1, int(n["vials_at_node"] * 0.05))
                n["vials_at_node"] -= spoil
                n["vials_spoiled"] += spoil
                self._log_event(
                    f"VIAL SPOILAGE at {node_name}: {spoil} vials lost "
                    f"(temp={n['actual_temperature']:.1f}°C)."
                )

    def _update_actual_temperature(self, node_name: str, n: Dict[str, Any]):
        """Drift the actual temperature based on generator + flood status."""
        target = NODE_CONFIG[node_name]["initial_temp"]
        if not n["generator_working"] or n["generator_fuel_pct"] <= 0:
            target = 22.0
        if n["flood_active"]:
            target = max(target, 15.0)
        delta = (target - n["actual_temperature"]) * 0.3
        delta += self._rng.uniform(-0.2, 0.2)
        n["actual_temperature"] = round(n["actual_temperature"] + delta, 2)

    def _compute_sensor_reading(self, n: Dict[str, Any]) -> float:
        """Apply lying sensor offset (lifts reading) and cap at SENSOR_READING_CAP."""
        if n["sensor_lying"]:
            reading = n["actual_temperature"] + n["sensor_lie_offset"]
        else:
            reading = n["actual_temperature"]
        return round(min(SENSOR_READING_CAP, reading), 2)

    def _is_alarm(self, n: Dict[str, Any]) -> bool:
        """Alarm fires based on the (possibly lying) sensor reading, not the truth."""
        reading = self._compute_sensor_reading(n)
        return reading < SAFE_TEMP_MIN or reading > SAFE_TEMP_MAX

    def _compute_simple_metrics(self):
        """Compute simple Bible metrics + composable rubric breakdown.

        Both formulations are exposed in /state per the dual-exposure spec:
          - simple: coverage, waste, missed_sessions
          - composable: rubric_scores dict with 4 sub-scores + total
        """
        total_spoiled = sum(s["vials_spoiled"] for s in self.nodes_state.values())
        self.coverage = (
            self.population_reached / self.total_population_target
            if self.total_population_target > 0 else 0.0
        )
        self.waste = total_spoiled / max(1, self.total_vials_at_start)
        self.rubric_scores = self._rubric.evaluate(self)

    def _build_full_node_observations(self) -> List[NodeObservation]:
        """Privileged ground-truth per-node list, used by /state and the UI.

        Includes `sensor_lying` and `actual_temperature`. Never expose this
        directly to the agent — see `_build_agent_node_observations`.
        """
        node_obs: List[NodeObservation] = []
        for node_name, n in self.nodes_state.items():
            node_obs.append(
                NodeObservation(
                    node_name=node_name,
                    sensor_reading=self._compute_sensor_reading(n),
                    actual_temperature=n["actual_temperature"],
                    sensor_lying=n["sensor_lying"],
                    generator_fuel_pct=round(n["generator_fuel_pct"], 1),
                    temperature_alarm=self._is_alarm(n),
                    vials_at_node=n["vials_at_node"],
                    vials_spoiled=n["vials_spoiled"],
                )
            )
        return node_obs

    def _build_agent_node_observations(self) -> List[AgentNodeObservation]:
        """Agent-facing per-node list (no leakage).

        Drops `sensor_lying` and `actual_temperature`. The agent must
        reason about the possibility of a lying sensor using the
        natural-language briefing instead of peeking at the truth.
        """
        node_obs: List[AgentNodeObservation] = []
        for node_name, n in self.nodes_state.items():
            node_obs.append(
                AgentNodeObservation(
                    node_name=node_name,
                    sensor_reading=self._compute_sensor_reading(n),
                    generator_fuel_pct=round(n["generator_fuel_pct"], 1),
                    temperature_alarm=self._is_alarm(n),
                    vials_at_node=n["vials_at_node"],
                    vials_spoiled=n["vials_spoiled"],
                )
            )
        return node_obs

    def _build_observation(self) -> Observation:
        """Build the agent-facing Observation returned by reset/step.

        Uses `AgentNodeObservation` (no leakage). The /state endpoint and
        UI use `state()` below, which returns the full `NodeObservation`.
        """
        time_remaining = max(0.0, EPISODE_MAX_HOURS - self.current_hour)
        return Observation(
            nodes=self._build_agent_node_observations(),
            time_remaining_hours=time_remaining,
            current_hour=self.current_hour,
            briefing=self.briefing,
            truck_arrived=self.truck_arrived,
            ethical_tension_active=self.ethical_tension_active,
            last_event=self.events[-1] if self.events else None,
        )

    def state(self) -> State:
        """Full ground-truth state for the /state endpoint and UI.

        Returns full `NodeObservation` objects with `sensor_lying` and
        `actual_temperature` exposed — these drive the dashboard's
        sensor-lie callout and the truth-vs-sensor delta.
        """
        return State(
            nodes=self._build_full_node_observations(),
            time_remaining_hours=max(0.0, EPISODE_MAX_HOURS - self.current_hour),
            current_hour=self.current_hour,
            briefing=self.briefing,
            truck_arrived=self.truck_arrived,
            ethical_tension_active=self.ethical_tension_active,
            last_action=self.last_action,
            last_reasoning=self.last_reasoning,
            events=list(self.events),
            coverage=self.coverage,
            waste=self.waste,
            missed_sessions=self.missed_sessions,
            rubric_scores=self.rubric_scores,
            difficulty=self.difficulty,
            done=self.done,
            total_vials_at_start=self.total_vials_at_start,
            total_vials_delivered=self.total_vials_delivered,
            total_population_target=self.total_population_target,
            population_reached=self.population_reached,
        )

    def _log_event(self, message: str):
        """Add a timestamped event to the events list."""
        stamped = f"[h{self.current_hour:02d}] {message}"
        self.events.append(stamped)
        self.last_event = stamped
        if len(self.events) > 200:
            self.events = self.events[-200:]
