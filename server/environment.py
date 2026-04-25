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

    def reset(
        self,
        difficulty: str = "medium",
        district: str = "barmer",
        user_briefing: Optional[str] = None,
        seed: Optional[int] = None,
    ) -> Observation:
        """Reset the environment for a new episode.

        Args:
            difficulty: "easy", "medium", or "hard"
            district: "nashik", "barmer", or "godda" (drives briefing content)
            user_briefing: Optional pre-supplied briefing text
            seed: Optional RNG seed for reproducibility

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

        self._initialized = True
        self._log_event(f"Episode started. Difficulty={self.difficulty}, district={self.district}.")
        self._compute_simple_metrics()
        return self._build_observation()

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

            if delivered <= 0:
                self.missed_sessions += 1
                self._log_event(f"MISSED SESSION at {node}: no vials available.")
                return 4.0, -0.3, {"action_type": atype, "node": node, "delivered": 0}

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

            if self.ethical_tension_active:
                children_share = min(delivered, max(0, self.children_population - self.children_vaccinated))
                self.children_vaccinated += children_share
                remaining = delivered - children_share
                if remaining > 0:
                    elderly_share = min(remaining, max(0, self.elderly_population - self.elderly_vaccinated))
                    self.elderly_vaccinated += elderly_share
                self.population_reached = self.children_vaccinated + self.elderly_vaccinated
            else:
                self.population_reached = min(
                    self.total_population_target, self.population_reached + delivered
                )

            return 4.0, 0.5 + 0.001 * delivered, {"action_type": atype, "node": node, "delivered": delivered}

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

    def _build_observation(self) -> Observation:
        node_obs = []
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
        time_remaining = max(0.0, EPISODE_MAX_HOURS - self.current_hour)
        return Observation(
            nodes=node_obs,
            time_remaining_hours=time_remaining,
            current_hour=self.current_hour,
            briefing=self.briefing,
            truck_arrived=self.truck_arrived,
            ethical_tension_active=self.ethical_tension_active,
            last_event=self.events[-1] if self.events else None,
        )

    def state(self) -> State:
        """Full ground-truth state for the /state endpoint and UI."""
        node_obs = self._build_observation().nodes
        return State(
            nodes=node_obs,
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
