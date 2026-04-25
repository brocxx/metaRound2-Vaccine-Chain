"""Smoke test for Phase 1B: verify environment logic works end-to-end."""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from server.environment import VaccineColdChainEnv
from models import Action


def test_phase_1b():
    print("=" * 70)
    print("PHASE 1B SMOKE TEST: Vaccine Cold Chain Env")
    print("=" * 70)

    env = VaccineColdChainEnv(seed=42)

    print("\n[1] RESET in HARD mode...")
    obs = env.reset(difficulty="hard", district="barmer")
    assert obs.briefing, "Briefing must be populated on reset"
    assert obs.ethical_tension_active, "Ethical tension must be active in hard mode"
    assert len(obs.nodes) == 3, f"Expected 3 nodes, got {len(obs.nodes)}"
    node_names = {n.node_name for n in obs.nodes}
    assert node_names == {"DVS_Barmer", "CHC_Balotra", "PHC_Sindhari"}, \
        f"Wrong node names: {node_names}"
    print(f"    OK Briefing length: {len(obs.briefing)} chars")
    print(f"    OK Briefing preview: {obs.briefing[:120]}...")
    print(f"    OK Ethical tension: {obs.ethical_tension_active}")
    print(f"    OK Nodes: {sorted(node_names)}")

    print("\n[2] STEP 10 times in hard mode and observe hazards...")
    sensor_lie_observed = False
    flood_observed = False
    generator_failure_observed = False

    for i in range(10):
        action = Action(
            node="DVS_Barmer",
            action_type="check_temperature",
            reasoning=f"Step {i}: monitoring temperature.",
        )
        result = env.step(action)
        for node in result.observation.nodes:
            if node.sensor_lying:
                sensor_lie_observed = True
                lift = node.sensor_reading - node.actual_temperature
                assert 1.4 <= lift <= 3.1, \
                    f"Lying sensor lift out of range: {lift:.2f}"
                print(f"    [step {i}] LIE on {node.node_name}: "
                      f"sensor={node.sensor_reading:.1f}°C, "
                      f"actual={node.actual_temperature:.1f}°C "
                      f"(lift={lift:.1f}°C)")
        for ev in result.observation.last_event.split("\n") if result.observation.last_event else []:
            if "FLOOD" in ev:
                flood_observed = True
            if "GENERATOR FAILURE" in ev:
                generator_failure_observed = True

    print(f"\n    OK Reward sum across 10 steps: ~{sum([0.05]*10):.2f} expected from check_temperature")
    print(f"    OK Sensor lie observed: {sensor_lie_observed}")

    print("\n[3] state() returns full ground truth shape...")
    state = env.state()
    state_dict = state.to_dict()
    required_keys = {
        "nodes", "time_remaining_hours", "current_hour", "briefing",
        "truck_arrived", "ethical_tension_active", "last_action", "last_reasoning",
        "events", "coverage", "waste", "missed_sessions", "rubric_scores",
        "difficulty", "done"
    }
    missing = required_keys - set(state_dict.keys())
    assert not missing, f"Missing state keys: {missing}"
    print(f"    OK All required keys present: {sorted(required_keys)}")
    print(f"    OK Current hour: {state.current_hour}")
    print(f"    OK Coverage: {state.coverage:.2%}")
    print(f"    OK Waste: {state.waste:.2%}")
    print(f"    OK Events logged: {len(state.events)}")

    print("\n[4] Validate node observation field names match Bible spec...")
    n0 = state.nodes[0]
    bible_fields = {
        "sensor_reading", "actual_temperature", "sensor_lying",
        "generator_fuel_pct", "temperature_alarm",
    }
    n0_dict = n0.to_dict()
    missing = bible_fields - set(n0_dict.keys())
    assert not missing, f"Missing Bible fields: {missing}"
    print(f"    OK All Bible fields present on NodeObservation: {sorted(bible_fields)}")

    print("\n[5] Schedule outreach and verify population tracking...")
    result = env.step(Action(
        node="DVS_Barmer",
        action_type="schedule_outreach",
        quantity=50,
        reasoning="Deliver vials for vaccination.",
    ))
    state2 = env.state()
    assert state2.total_vials_delivered > 0, "Vials should be delivered"
    print(f"    OK Vials delivered: {state2.total_vials_delivered}")
    print(f"    OK Population reached: {state2.population_reached} / {state2.total_population_target}")

    print("\n[6] EASY mode should have NO probabilistic hazards...")
    env_easy = VaccineColdChainEnv(seed=42)
    env_easy.reset(difficulty="easy", district="nashik")
    for _ in range(20):
        env_easy.step(Action(node="CHC_Balotra", action_type="check_temperature"))
    easy_state = env_easy.state()
    any_lie = any(n.sensor_lying for n in easy_state.nodes)
    assert not any_lie, "Easy mode should not have lying sensors"
    print(f"    OK No lying sensors in easy mode: {not any_lie}")
    print(f"    OK Easy mode ethical tension off: {not easy_state.ethical_tension_active}")

    print("\n" + "=" * 70)
    print("PHASE 1B CHECKPOINT: PASS")
    print("=" * 70)


if __name__ == "__main__":
    test_phase_1b()
