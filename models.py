"""
OpenEnv-compliant data models for the Vaccine Cold Chain environment.

Field names match the "Bible" specification exactly so the frontend dev's UI
contract is preserved. Do not rename `sensor_reading`, `actual_temperature`,
`sensor_lying`, `generator_fuel_pct`, or `temperature_alarm`.
"""

from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any


VALID_ACTION_TYPES = {
    "check_temperature",
    "check_truck_status",
    "request_fuel",
    "schedule_outreach",
    "request_emergency",
    "no_op",
}

VALID_NODES = {"DVS_Barmer", "CHC_Balotra", "PHC_Sindhari"}


@dataclass
class Action:
    """An action the agent can take in the environment.

    Args:
        node: One of "DVS_Barmer", "CHC_Balotra", "PHC_Sindhari"
        action_type: One of VALID_ACTION_TYPES
        quantity: Optional integer for outreach scheduling (vials to deliver)
        reasoning: Optional natural-language reasoning trace from the agent
    """

    node: str
    action_type: str
    quantity: Optional[int] = None
    reasoning: Optional[str] = None

    def validate(self) -> Optional[str]:
        """Return None if valid, or a human-readable error string."""
        if self.action_type not in VALID_ACTION_TYPES:
            return f"Invalid action_type '{self.action_type}'. Must be one of {sorted(VALID_ACTION_TYPES)}"
        if self.action_type != "no_op" and self.node not in VALID_NODES:
            return f"Invalid node '{self.node}'. Must be one of {sorted(VALID_NODES)}"
        if self.action_type == "schedule_outreach":
            if self.quantity is None or self.quantity <= 0:
                return "schedule_outreach requires a positive 'quantity'"
        return None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class NodeObservation:
    """Per-node observation with FULL ground truth.

    Used by the `/state` endpoint and the live Mission Control UI. Includes
    `sensor_lying` and `actual_temperature` so the dashboard can render the
    calibration-fault callout and the truth-vs-sensor delta.

    Agents are given `AgentNodeObservation` instead — they MUST NOT see
    these privileged fields, otherwise the "briefing vs no-briefing"
    ablation collapses into `if sensor_lying: ignore_alarm` and the
    natural-language briefing stops doing the work.

    Field names match the Bible spec exactly. Do not rename.
    """

    node_name: str
    sensor_reading: float
    actual_temperature: float       # PRIVILEGED — UI / /state only
    sensor_lying: bool              # PRIVILEGED — UI / /state only
    generator_fuel_pct: float
    temperature_alarm: bool
    vials_at_node: int
    vials_spoiled: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class AgentNodeObservation:
    """Per-node observation EXPOSED TO THE AGENT (no leakage).

    Identical to `NodeObservation` MINUS the two privileged ground-truth
    fields (`sensor_lying`, `actual_temperature`). The agent must reason
    about a possibly-lying sensor using the briefing — peeking at the
    truth would invalidate the central scientific question of the env
    ("does the natural-language briefing carry decision-relevant info?").

    Field names match the Bible/UI contract for the fields that ARE
    exposed (`sensor_reading`, `generator_fuel_pct`, `temperature_alarm`,
    `vials_at_node`, `vials_spoiled`); never rename them.
    """

    node_name: str
    sensor_reading: float
    generator_fuel_pct: float
    temperature_alarm: bool
    vials_at_node: int
    vials_spoiled: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Observation:
    """Observation returned to the AGENT at each step (/reset and /step).

    Uses `AgentNodeObservation` — no `sensor_lying`, no `actual_temperature`.
    The full ground-truth shape lives on `State` (served by /state for the
    Mission Control UI). These are intentionally different objects.
    """

    nodes: List[AgentNodeObservation]
    time_remaining_hours: float
    current_hour: int
    briefing: str
    truck_arrived: bool
    ethical_tension_active: bool = False
    last_event: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "nodes": [n.to_dict() for n in self.nodes],
            "time_remaining_hours": self.time_remaining_hours,
            "current_hour": self.current_hour,
            "briefing": self.briefing,
            "truck_arrived": self.truck_arrived,
            "ethical_tension_active": self.ethical_tension_active,
            "last_event": self.last_event,
        }


@dataclass
class State:
    """Full ground-truth state exposed via `/state` for the UI.

    Includes both the simple reward formulation (per Bible) AND the
    rubric breakdown (per judging criteria). Both are exposed.
    """

    nodes: List[NodeObservation]
    time_remaining_hours: float
    current_hour: int
    briefing: str
    truck_arrived: bool
    ethical_tension_active: bool
    last_action: Optional[Dict[str, Any]] = None
    last_reasoning: Optional[str] = None
    events: List[str] = field(default_factory=list)
    coverage: float = 0.0
    waste: float = 0.0
    missed_sessions: int = 0
    rubric_scores: Dict[str, float] = field(default_factory=dict)
    difficulty: str = "medium"
    done: bool = False
    total_vials_at_start: int = 0
    total_vials_delivered: int = 0
    total_population_target: int = 0
    population_reached: int = 0
    # Static OSM-derived geo data — additive, optional. Empty dicts when
    # geo_config.json is missing/invalid so legacy callers see no change.
    # `nodes_geo`: { node_name: { lat, lon, type } }
    # `routes`:    { route_key: { distance_km, eta_min, road_type } }
    nodes_geo: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    routes: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "nodes": [n.to_dict() for n in self.nodes],
            "time_remaining_hours": self.time_remaining_hours,
            "current_hour": self.current_hour,
            "briefing": self.briefing,
            "truck_arrived": self.truck_arrived,
            "ethical_tension_active": self.ethical_tension_active,
            "last_action": self.last_action,
            "last_reasoning": self.last_reasoning,
            "events": self.events[-20:],
            "coverage": self.coverage,
            "waste": self.waste,
            "missed_sessions": self.missed_sessions,
            "rubric_scores": self.rubric_scores,
            "difficulty": self.difficulty,
            "done": self.done,
            "total_vials_at_start": self.total_vials_at_start,
            "total_vials_delivered": self.total_vials_delivered,
            "total_population_target": self.total_population_target,
            "population_reached": self.population_reached,
            "nodes_geo": self.nodes_geo,
            "routes": self.routes,
        }


@dataclass
class StepResult:
    """Standard OpenEnv step return value."""

    observation: Observation
    reward: float
    done: bool
    info: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "observation": self.observation.to_dict(),
            "reward": self.reward,
            "done": self.done,
            "info": self.info,
        }
