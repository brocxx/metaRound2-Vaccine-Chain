"""
Smoke test for Phase 1D: validates all FastAPI endpoint shapes.

Runs the FastAPI app in-process using httpx's ASGI client — no server needed.
Checks /health, /reset, /step, /state, /web, /openenv.yaml.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import httpx
from fastapi.testclient import TestClient
from server.app import app

client = TestClient(app)


def ok(label: str):
    print(f"    OK {label}")


def test_phase_1d():
    print("=" * 70)
    print("PHASE 1D SMOKE TEST: Endpoints & Web UI")
    print("=" * 70)

    # ------------------------------------------------------------------
    # /health
    # ------------------------------------------------------------------
    print("\n[1] GET /health")
    r = client.get("/health")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    body = r.json()
    assert body["status"] == "healthy"
    assert body["service"] == "vaccine-cold-chain-env"
    assert body["version"] == "2.0"
    ok(f"status=healthy, service=vaccine-cold-chain-env, version=2.0")

    # ------------------------------------------------------------------
    # /reset (default — no user_briefing)
    # ------------------------------------------------------------------
    print("\n[2] POST /reset (hard mode, barmer)")
    r = client.post("/reset", json={"difficulty": "hard", "district": "barmer"})
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    obs = r.json()
    assert "briefing" in obs and obs["briefing"], "briefing field missing or empty"
    assert "nodes" in obs and len(obs["nodes"]) == 3
    assert obs["ethical_tension_active"] is True
    assert "time_remaining_hours" in obs
    assert "current_hour" in obs
    assert "truck_arrived" in obs
    ok(f"briefing length: {len(obs['briefing'])} chars")
    ok(f"3 nodes present: {[n['node_name'] for n in obs['nodes']]}")
    ok(f"ethical_tension_active=True in hard mode")

    # ------------------------------------------------------------------
    # /reset with user_briefing
    # ------------------------------------------------------------------
    print("\n[3] POST /reset with user_briefing override")
    custom = "TEST BRIEFING: generator faulty, sensor lying at DVS."
    r = client.post("/reset", json={
        "difficulty": "hard",
        "district": "barmer",
        "user_briefing": custom,
    })
    assert r.status_code == 200
    assert r.json()["briefing"] == custom
    ok(f"user_briefing passed through verbatim")

    # ------------------------------------------------------------------
    # Node field names — leakage fix (v2.0):
    #   /reset and /step return AgentNodeObservation (no sensor_lying / no
    #   actual_temperature). The full Bible-shape NodeObservation lives on
    #   /state for the Mission Control UI. Verify both sides of that contract.
    # ------------------------------------------------------------------
    print("\n[4a] /reset payload: agent-facing slim shape (no leakage)")
    obs = r.json()
    agent_fields = {"sensor_reading", "generator_fuel_pct", "temperature_alarm",
                    "vials_at_node", "vials_spoiled"}
    for node in obs["nodes"]:
        missing = agent_fields - set(node.keys())
        assert not missing, f"Missing agent-facing fields on {node['node_name']}: {missing}"
        assert "sensor_lying" not in node, \
            f"LEAKAGE: sensor_lying present in /reset payload for {node['node_name']}"
        assert "actual_temperature" not in node, \
            f"LEAKAGE: actual_temperature present in /reset payload for {node['node_name']}"
    ok("Agent-facing fields present; sensor_lying & actual_temperature correctly absent")

    print("\n[4b] /state payload: full Bible-shape NodeObservation (UI contract)")
    state_r = client.get("/state")
    assert state_r.status_code == 200
    state_payload = state_r.json()
    bible_fields = {"sensor_reading", "actual_temperature", "sensor_lying",
                    "generator_fuel_pct", "temperature_alarm", "vials_at_node"}
    for node in state_payload["nodes"]:
        missing = bible_fields - set(node.keys())
        assert not missing, f"Missing Bible fields on /state node {node['node_name']}: {missing}"
    ok("All Bible fields (incl. sensor_lying, actual_temperature) present on every /state node")

    # ------------------------------------------------------------------
    # /step
    # ------------------------------------------------------------------
    print("\n[5] POST /step — check_temperature action")
    r = client.post("/reset", json={"difficulty": "medium", "district": "godda"})
    assert r.status_code == 200

    r = client.post("/step", json={
        "action": {
            "node": "DVS_Barmer",
            "action_type": "check_temperature",
        },
        "reasoning": "Verifying temperature before outreach.",
    })
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    step = r.json()
    assert "observation" in step
    assert "reward" in step
    assert "done" in step
    assert "info" in step
    assert isinstance(step["reward"], (int, float))
    ok(f"Step returned observation/reward/done/info")
    ok(f"Reward: {step['reward']}")

    print("\n[6] POST /step — invalid action returns error info not 500")
    r = client.post("/step", json={
        "action": {"node": "INVALID_NODE", "action_type": "check_temperature"},
    })
    assert r.status_code == 200, f"Invalid actions should return 200 with error info, got {r.status_code}"
    step = r.json()
    assert step["reward"] == -1.0
    assert "error" in step["info"]
    ok(f"Invalid action: reward=-1.0, error info: {step['info']['error'][:50]}...")

    # ------------------------------------------------------------------
    # /state — full ground truth shape
    # ------------------------------------------------------------------
    print("\n[7] GET /state — full ground truth shape")
    r = client.post("/reset", json={"difficulty": "easy", "district": "nashik"})
    client.post("/step", json={"action": {"node": "CHC_Balotra", "action_type": "check_temperature"}})
    r = client.get("/state")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    state = r.json()
    required = {
        "nodes", "time_remaining_hours", "current_hour", "briefing",
        "truck_arrived", "ethical_tension_active", "last_action",
        "last_reasoning", "events", "coverage", "waste", "missed_sessions",
        "rubric_scores", "difficulty", "done",
    }
    missing = required - set(state.keys())
    assert not missing, f"Missing state keys: {missing}"
    assert isinstance(state["rubric_scores"], dict)
    rubric_keys = {"coverage", "temperature_maintenance",
                   "proactive_info_seeking", "resource_efficiency", "total"}
    missing_rs = rubric_keys - set(state["rubric_scores"].keys())
    assert not missing_rs, f"Missing rubric_scores keys: {missing_rs}"
    ok(f"All {len(required)} required keys present")
    ok(f"rubric_scores has all 5 keys: {sorted(rubric_keys)}")
    ok(f"last_action node: {state.get('last_action', {}).get('node', '—')}")
    ok(f"last_reasoning: {state.get('last_reasoning', '—')}")

    # ------------------------------------------------------------------
    # /web
    # ------------------------------------------------------------------
    print("\n[8] GET /web — HTML UI response")
    r = client.get("/web")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    html = r.text
    assert "<!DOCTYPE html>" in html or "<!doctype html>" in html.lower()
    assert "sensor_lying" in html or "SENSOR LYING" in html, "Sensor lie callout not found in HTML"
    assert "Briefing" in html
    assert "/state" in html, "/state polling not found in JS"
    assert "1500" in html, "Poll interval 1500ms not found in HTML"
    ok("HTML page returned with DOCTYPE")
    ok("Sensor lie callout present in HTML")
    ok("Briefing element present")
    ok("/state polling with 1500ms interval confirmed")

    # ------------------------------------------------------------------
    # /openenv.yaml
    # ------------------------------------------------------------------
    print("\n[9] GET /openenv.yaml")
    r = client.get("/openenv.yaml")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    yaml_text = r.text
    assert "vaccine-cold-chain" in yaml_text
    assert "VaccineColdChainEnv" in yaml_text
    assert "sensor_reading" in yaml_text
    ok("openenv.yaml served as plain text")
    ok("Contains name, entry_point, sensor_reading field")

    print("\n" + "=" * 70)
    print("PHASE 1D CHECKPOINT: PASS")
    print("=" * 70)


if __name__ == "__main__":
    test_phase_1d()
