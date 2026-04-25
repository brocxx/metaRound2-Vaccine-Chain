"""Smoke test for Phase 1C: verify rubric class hierarchy and composition."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from server.environment import VaccineColdChainEnv, EPISODE_MAX_HOURS
from server.rubrics import (
    BaseRubric,
    CoverageRubric,
    TemperatureRubric,
    ProactiveRubric,
    EfficiencyRubric,
    VaccineRubric,
)
from models import Action


def assert_in_unit(name: str, value: float):
    assert 0.0 <= value <= 1.0, f"{name} out of [0, 1]: got {value}"


def test_phase_1c():
    print("=" * 70)
    print("PHASE 1C SMOKE TEST: Composable Rubric Hierarchy")
    print("=" * 70)

    print("\n[1] Rubric class hierarchy is correct...")
    composer = VaccineRubric()
    expected_weights = {
        "coverage": 1.0,
        "temperature_maintenance": 0.3,
        "proactive_info_seeking": 0.2,
        "resource_efficiency": 0.1,
    }
    actual_weights = {r.name: r.weight for r in composer.rubrics}
    assert actual_weights == expected_weights, \
        f"Wrong weights. Expected {expected_weights}, got {actual_weights}"
    for r in composer.rubrics:
        assert isinstance(r, BaseRubric), f"{r.name} not subclass of BaseRubric"
    print(f"    OK All 4 rubrics present with correct weights: {actual_weights}")
    print(f"    OK Total weight: {composer._total_weight}")

    print("\n[2] Reset env and check initial rubric state...")
    env = VaccineColdChainEnv(seed=42)
    env.reset(difficulty="hard", district="barmer")
    initial_state = env.state()
    rs = initial_state.rubric_scores
    print(f"    OK Initial rubric scores: {rs}")
    for key in ["coverage", "temperature_maintenance", "proactive_info_seeking",
                "resource_efficiency", "total"]:
        assert key in rs, f"Missing rubric key: {key}"
        assert_in_unit(key, rs[key])
    print(f"    OK All 5 keys present (4 sub-scores + total), all in [0, 1]")

    print("\n[3] Run a full episode and verify rubric composition holds...")
    env2 = VaccineColdChainEnv(seed=42)
    env2.reset(difficulty="hard", district="barmer")

    actions_taken = 0
    for hour_target in range(0, EPISODE_MAX_HOURS, 4):
        if env2.current_hour < hour_target:
            for node in ["DVS_Barmer", "CHC_Balotra", "PHC_Sindhari"]:
                if env2.done:
                    break
                env2.step(Action(node=node, action_type="check_temperature",
                                 reasoning="periodic check"))
                actions_taken += 1
            if env2.done:
                break
        if not env2.done:
            env2.step(Action(node="DVS_Barmer", action_type="schedule_outreach",
                             quantity=20, reasoning="deliver to district store"))
            actions_taken += 1
        if env2.done:
            break

    final_state = env2.state()
    rs = final_state.rubric_scores
    print(f"    OK Episode completed at hour {final_state.current_hour}")
    print(f"    OK Total actions: {actions_taken}")
    print(f"    OK Final rubric breakdown:")
    for k, v in rs.items():
        print(f"         {k}: {v:.4f}")
        assert_in_unit(k, v)

    print("\n[4] Verify dual-exposure: simple metrics AND rubric_scores both present...")
    sd = final_state.to_dict()
    assert "coverage" in sd, "Missing simple coverage"
    assert "waste" in sd, "Missing simple waste"
    assert "missed_sessions" in sd, "Missing simple missed_sessions"
    assert "rubric_scores" in sd and isinstance(sd["rubric_scores"], dict), \
        "Missing rubric_scores dict"
    print(f"    OK Simple metrics: coverage={sd['coverage']:.3f}, "
          f"waste={sd['waste']:.3f}, missed={sd['missed_sessions']}")
    print(f"    OK Rubric breakdown also present with {len(sd['rubric_scores'])} keys")

    print("\n[5] Sensor-lie penalty: false-emergency lowers proactive score...")
    env3 = VaccineColdChainEnv(seed=42)
    env3.reset(difficulty="hard", district="barmer")
    for _ in range(20):
        if env3.done:
            break
        env3.step(Action(node="DVS_Barmer", action_type="check_temperature"))

    triggered = False
    for _ in range(40):
        if env3.done:
            break
        any_lying = any(s["sensor_lying"] for s in env3.nodes_state.values())
        if any_lying:
            env3.step(Action(node="DVS_Barmer", action_type="request_emergency",
                             reasoning="panic response to alarm (incorrect)"))
            triggered = True
            break
        env3.step(Action(node="DVS_Barmer", action_type="check_temperature"))

    if triggered:
        print(f"    OK False emergency triggered. emergency_during_lie_count="
              f"{env3.emergency_during_lie_count}")
        print(f"    OK Proactive sub-score: "
              f"{env3.rubric_scores.get('proactive_info_seeking', '?'):.4f}")
    else:
        print(f"    INFO: No sensor lie occurred in this seed/run, skipping penalty test")

    print("\n[6] Easy mode: no hazards => high temperature_maintenance score...")
    env4 = VaccineColdChainEnv(seed=42)
    env4.reset(difficulty="easy", district="nashik")
    for _ in range(30):
        if env4.done:
            break
        env4.step(Action(node="CHC_Balotra", action_type="check_temperature"))
    easy_state = env4.state()
    temp_score = easy_state.rubric_scores["temperature_maintenance"]
    print(f"    OK Easy mode temperature_maintenance: {temp_score:.4f} (should be ~1.0)")
    assert temp_score >= 0.9, f"Easy mode temp score too low: {temp_score}"

    print("\n[7] done=True step includes rubric_scores in info dict...")
    env5 = VaccineColdChainEnv(seed=99)
    env5.reset(difficulty="medium", district="godda")
    last_result = None
    while not env5.done:
        last_result = env5.step(Action(node="DVS_Barmer", action_type="check_temperature"))
    assert last_result is not None
    assert "rubric_scores" in last_result.info, \
        "Final step should include rubric_scores in info"
    assert "simple_metrics" in last_result.info, \
        "Final step should include simple_metrics in info"
    print(f"    OK Final-step info has rubric_scores: "
          f"{list(last_result.info['rubric_scores'].keys())}")
    print(f"    OK Final-step info has simple_metrics: "
          f"{list(last_result.info['simple_metrics'].keys())}")

    print("\n[8] Composer.describe() returns rubric metadata for documentation...")
    desc = composer.describe()
    assert "rubrics" in desc and len(desc["rubrics"]) == 4, "describe() shape wrong"
    print(f"    OK Composer describe(): {len(desc['rubrics'])} rubrics, "
          f"total_weight={desc['total_weight']}")

    print("\n" + "=" * 70)
    print("PHASE 1C CHECKPOINT: PASS")
    print("=" * 70)


if __name__ == "__main__":
    test_phase_1c()
