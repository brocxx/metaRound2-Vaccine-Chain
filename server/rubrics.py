"""
Composable Rubric system for the Vaccine Cold Chain environment.

Per the OpenEnv judging guide: "composable rubrics > monolithic scoring."
We expose 4 weighted sub-scores in addition to the simple
`coverage − waste − missed_sessions` formula. Both are surfaced in `/state`.

Weights (per build brief Phase 1C):
    coverage:                1.0
    temperature_maintenance: 0.3
    proactive_info_seeking:  0.2
    resource_efficiency:     0.1
"""

from abc import ABC, abstractmethod
from typing import Dict, Any


class BaseRubric(ABC):
    """Abstract rubric primitive. All sub-rubrics implement `score(env)`.

    Each rubric:
      - has a stable `name` (used as key in the breakdown dict)
      - has a numeric `weight` (combined by the composer)
      - returns a normalized score in [0.0, 1.0]
    """

    def __init__(self, name: str, weight: float):
        self.name = name
        self.weight = float(weight)

    @abstractmethod
    def score(self, env: Any) -> float:
        """Return a normalized score in [0.0, 1.0]."""
        raise NotImplementedError

    def _clamp01(self, x: float) -> float:
        if x < 0.0:
            return 0.0
        if x > 1.0:
            return 1.0
        return float(x)


class CoverageRubric(BaseRubric):
    """Vaccination coverage. Ethical-tension-aware in hard mode.

    In hard mode, vaccinating a child counts more than vaccinating an elderly
    person (more life-years saved, larger at-risk cohort). This makes the
    triage decision a real choice with measurable consequences.
    """

    def __init__(self, weight: float = 1.0):
        super().__init__("coverage", weight)

    def score(self, env: Any) -> float:
        if env.ethical_tension_active:
            child_weight = 0.7
            elderly_weight = 0.3
            weighted_reached = (
                env.children_vaccinated * child_weight
                + env.elderly_vaccinated * elderly_weight
            )
            weighted_target = (
                env.children_population * child_weight
                + env.elderly_population * elderly_weight
            )
            if weighted_target == 0:
                return 0.0
            return self._clamp01(weighted_reached / weighted_target)

        if env.total_population_target == 0:
            return 0.0
        return self._clamp01(env.population_reached / env.total_population_target)


class TemperatureRubric(BaseRubric):
    """Fraction of node-hours during which actual temp was in safe range [2°C, 8°C].

    Uses ground-truth temperature, not the (possibly lying) sensor reading.
    A sensor-lie that fooled the agent into spurious action does not protect
    actual vials — only real cold-chain integrity does.
    """

    def __init__(self, weight: float = 0.3):
        super().__init__("temperature_maintenance", weight)

    def score(self, env: Any) -> float:
        if env.total_node_hours == 0:
            return 1.0
        return self._clamp01(env.node_hours_in_safe_range / env.total_node_hours)


class ProactiveRubric(BaseRubric):
    """Rewards proactive information gathering; penalizes panic responses to lying sensors.

    Components:
      + base: proactive checks vs an expected baseline (~1 per 6 hours elapsed)
      − penalty: emergencies fired during a sensor lie
      − penalty: fuel requested during a sensor lie (the classic wrong response
        to the lying-sensor demo moment — agent panics and burns the budget)
    """

    EXPECTED_CHECK_INTERVAL_HOURS = 6.0
    PENALTY_PER_FALSE_EMERGENCY = 0.25
    PENALTY_PER_FUEL_REQUEST_DURING_LIE = 0.20

    def __init__(self, weight: float = 0.2):
        super().__init__("proactive_info_seeking", weight)

    def score(self, env: Any) -> float:
        elapsed = max(1, env.current_hour)
        expected_checks = elapsed / self.EXPECTED_CHECK_INTERVAL_HOURS
        base = self._clamp01(env.proactive_check_count / max(1.0, expected_checks))

        penalty = (
            env.emergency_during_lie_count * self.PENALTY_PER_FALSE_EMERGENCY
            + env.fuel_requests_during_lie_count * self.PENALTY_PER_FUEL_REQUEST_DURING_LIE
        )
        return self._clamp01(base - penalty)


class EfficiencyRubric(BaseRubric):
    """Penalizes wasted actions (excess fuel requests, no-ops, churn).

    Ideal action budget is roughly 1 action per 4 hours of episode time.
    Going over hurts efficiency; staying under does not bonus.
    """

    IDEAL_HOURS_PER_ACTION = 4.0
    PENALTY_PER_UNNECESSARY_FUEL = 0.10

    def __init__(self, weight: float = 0.1):
        super().__init__("resource_efficiency", weight)

    def score(self, env: Any) -> float:
        elapsed = max(1, env.current_hour)
        ideal_actions = max(1, int(elapsed / self.IDEAL_HOURS_PER_ACTION) + 1)
        if env.total_actions <= ideal_actions:
            base = 1.0
        else:
            excess = env.total_actions - ideal_actions
            base = max(0.0, 1.0 - excess * 0.05)

        penalty = env.unnecessary_fuel_requests * self.PENALTY_PER_UNNECESSARY_FUEL
        return self._clamp01(base - penalty)


class VaccineRubric:
    """Composable rubric: weights {1.0, 0.3, 0.2, 0.1}.

    Returns both the per-component breakdown and a single weighted total
    normalized to [0, 1]. The total is the sum-of-weighted-scores divided
    by the sum-of-weights — so it's a true weighted average, comparable
    across difficulty levels.
    """

    def __init__(self):
        self.rubrics = [
            CoverageRubric(weight=1.0),
            TemperatureRubric(weight=0.3),
            ProactiveRubric(weight=0.2),
            EfficiencyRubric(weight=0.1),
        ]
        self._total_weight = sum(r.weight for r in self.rubrics)

    def evaluate(self, env: Any) -> Dict[str, float]:
        """Compute all sub-scores and the weighted total.

        Returns:
            Dict mapping rubric name -> score, plus 'total' key with the
            weighted average. All values are in [0.0, 1.0].
        """
        breakdown: Dict[str, float] = {}
        weighted_sum = 0.0
        for rubric in self.rubrics:
            try:
                value = rubric.score(env)
            except Exception as e:
                print(f"[WARNING] Rubric {rubric.name} failed: {e}. Defaulting to 0.0.")
                value = 0.0
            breakdown[rubric.name] = round(value, 4)
            weighted_sum += value * rubric.weight

        total = weighted_sum / self._total_weight if self._total_weight > 0 else 0.0
        breakdown["total"] = round(total, 4)
        return breakdown

    def describe(self) -> Dict[str, Any]:
        """Return rubric metadata (names, weights) for documentation/UI."""
        return {
            "rubrics": [
                {"name": r.name, "weight": r.weight, "class": r.__class__.__name__}
                for r in self.rubrics
            ],
            "total_weight": self._total_weight,
        }
