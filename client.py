#!/usr/bin/env python3
"""
Vaccine Cold Chain — Demo Client Script

Demonstrates the core innovation: an LLM agent that combines natural-language
district briefings with live sensor data to make decisions that a numerical
algorithm cannot.

The demo moment:
  Without briefing: "Temperature reads 7.8°C. Alarm active. Emergency!" → wrong
  With briefing:    "Temperature reads 7.8°C but generator shows 100% fuel.
                     Briefing noted sensor calibration fault. Do nothing." → correct

Run this script after starting the server:
  python -m uvicorn server.app:app --host 0.0.0.0 --port 7860 &
  python client.py
"""

import sys
import time
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, Exception):
    pass

try:
    import httpx
except ImportError:
    print("[ERROR] httpx not installed. Run: pip install httpx")
    sys.exit(1)

# Configuration
SERVER_URL = "http://localhost:7860"
DEMO_DIFFICULTY = "hard"  # sensor lies most frequent, ethical tension active
DEMO_DISTRICT = "barmer"


class VaccineColdChainClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.client = httpx.Client(timeout=30.0)

    def health_check(self) -> bool:
        """Warm up the server and verify it's reachable."""
        try:
            r = self.client.get(f"{self.base_url}/health")
            if r.status_code == 200:
                data = r.json()
                print(f"✅ Server healthy: {data['service']} v{data['version']}")
                return True
        except Exception as e:
            print(f"❌ Server unreachable: {e}")
        return False

    def reset(self, difficulty: str = "medium", district: str = "barmer") -> dict:
        """Start a new episode."""
        payload = {"difficulty": difficulty, "district": district}
        r = self.client.post(f"{self.base_url}/reset", json=payload)
        r.raise_for_status()
        return r.json()

    def step(self, action: dict, reasoning: str = None) -> dict:
        """Execute one action."""
        payload = {"action": action}
        if reasoning:
            payload["reasoning"] = reasoning
        r = self.client.post(f"{self.base_url}/step", json=payload)
        r.raise_for_status()
        return r.json()

    def state(self) -> dict:
        """Get full ground truth state."""
        r = self.client.get(f"{self.base_url}/state")
        r.raise_for_status()
        return r.json()


def format_briefing(briefing: str, width: int = 80) -> str:
    """Format briefing with word wrapping and bullet points."""
    import textwrap
    
    # Add visual emphasis
    wrapped = textwrap.fill(briefing, width=width - 4)
    lines = wrapped.split('\n')
    formatted = []
    for line in lines:
        formatted.append(f"  📋 {line}")
    return '\n'.join(formatted)


def print_separator(char: str = "=", length: int = 80):
    print(char * length)


def print_node_status(nodes: list):
    """Print a compact node status table."""
    print("\n📊 NODE STATUS:")
    print(f"{'Node':<15} {'Sensor':<8} {'Actual':<8} {'Lying':<6} {'Fuel':<6} {'Vials':<6} {'Alarm':<5}")
    print("-" * 70)
    
    for node in nodes:
        name = node['node_name'].replace('_', ' ')
        sensor = f"{node['sensor_reading']:.1f}°C"
        actual = f"{node['actual_temperature']:.1f}°C"
        lying = "YES" if node['sensor_lying'] else "NO"
        fuel = f"{node['generator_fuel_pct']:.0f}%"
        vials = str(node['vials_at_node'])
        alarm = "🚨" if node['temperature_alarm'] else "✅"
        
        print(f"{name:<15} {sensor:<8} {actual:<8} {lying:<6} {fuel:<6} {vials:<6} {alarm:<5}")


def print_rubric_breakdown(rubric_scores: dict):
    """Print the composable rubric scores."""
    print("\n🎯 RUBRIC BREAKDOWN:")
    rubric_names = {
        'coverage': 'Coverage (1.0x)',
        'temperature_maintenance': 'Temperature Maintenance (0.3x)',
        'proactive_info_seeking': 'Proactive Info Seeking (0.2x)',
        'resource_efficiency': 'Resource Efficiency (0.1x)',
    }
    
    for key, label in rubric_names.items():
        if key in rubric_scores:
            score = rubric_scores[key] * 100
            bar_length = int(score / 5)  # 20 chars = 100%
            bar = "█" * bar_length + "░" * (20 - bar_length)
            print(f"  {label:<35} {bar} {score:5.1f}%")
    
    if 'total' in rubric_scores:
        total = rubric_scores['total'] * 100
        print(f"\n  {'WEIGHTED TOTAL':<35} {'█' * int(total/5):<20} {total:5.1f}%")


def main():
    """Run the vaccine cold chain demonstration."""
    print_separator("=")
    print("🦠 VACCINE COLD CHAIN — DEMO CLIENT")
    print("   OpenEnv Hackathon India 2026 • Round 2")
    print_separator("=")
    
    client = VaccineColdChainClient(SERVER_URL)
    
    # Health check + warm-up
    print("🔄 Connecting to environment...")
    if not client.health_check():
        print(f"\n💡 Start the server first:")
        print(f"   uvicorn server.app:app --host 0.0.0.0 --port 7860")
        return 1
    
    print_separator("-")
    
    # Reset episode in hard mode
    print(f"🎯 Starting episode: difficulty={DEMO_DIFFICULTY}, district={DEMO_DISTRICT}")
    obs = client.reset(difficulty=DEMO_DIFFICULTY, district=DEMO_DISTRICT)
    
    print_separator("-")
    
    # Display briefing prominently (per brief requirement)
    briefing = obs.get('briefing', 'No briefing available')
    print("📢 DISTRICT BRIEFING:")
    print(format_briefing(briefing))
    
    if obs.get('ethical_tension_active'):
        print("\n⚖️  ETHICAL TENSION ACTIVE: Agent must choose between 200 children vs 70 elderly")
    
    print_separator("-")
    
    # Show initial state
    print_node_status(obs['nodes'])
    
    # Execute a few demonstrative actions
    print("\n🤖 AGENT ACTIONS:")
    
    # Action 1: Check temperature to gather info
    print("\n[1] Checking temperature at district vaccine store...")
    result1 = client.step(
        action={"node": "DVS_Barmer", "action_type": "check_temperature"},
        reasoning="Gathering baseline temperature data before making decisions."
    )
    print(f"    💰 Reward: {result1['reward']:.3f}")

    # NOTE: We previously peeked at `result1['observation']['nodes'][i]['sensor_lying']`
    # here to print "SENSOR LIE DETECTED". That field has been removed from the
    # agent-facing Observation (see models.AgentNodeObservation) — agents must now
    # reason about a possibly-lying sensor from the briefing, not from a leaked
    # boolean. The privileged truth still lives on /state for the UI; if you want
    # to verify lies in this demo, call `client.state()['nodes'][i]['sensor_lying']`.

    # Action 2: Check truck status  
    print("\n[2] Checking vaccine truck status...")
    result2 = client.step(
        action={"node": "DVS_Barmer", "action_type": "check_truck_status"},
        reasoning="Verifying truck arrival before scheduling outreach sessions."
    )
    print(f"    💰 Reward: {result2['reward']:.3f}")
    print(f"    🚛 Truck arrived: {result2['observation']['truck_arrived']}")
    
    # Action 3: Schedule outreach (main goal)
    print("\n[3] Scheduling vaccination outreach...")
    result3 = client.step(
        action={"node": "DVS_Barmer", "action_type": "schedule_outreach", "quantity": 150},
        reasoning="Delivering vaccines to reach target population while supply is safe."
    )
    print(f"    💰 Reward: {result3['reward']:.3f}")
    
    # Final state summary
    print_separator("-")
    final_state = client.state()
    
    print("📈 EPISODE SUMMARY:")
    print(f"   Hour: {final_state['current_hour']}/72")
    print(f"   Coverage: {final_state['coverage']*100:.1f}%")
    print(f"   Waste: {final_state['waste']*100:.1f}%")
    print(f"   Population reached: {final_state['population_reached']}/{final_state['total_population_target']}")
    
    if final_state.get('rubric_scores'):
        print_rubric_breakdown(final_state['rubric_scores'])
    
    print_separator("-")
    
    # Show recent events
    events = final_state.get('events', [])
    if events:
        print("📝 RECENT EVENTS:")
        for event in events[-5:]:  # Last 5 events
            print(f"   • {event}")
    
    print_separator("=")
    print("🎉 Demo complete! Key findings:")
    print("   • Natural language briefings provide context that raw sensors cannot")
    print("   • LLM agents can detect sensor lies when briefed about calibration faults")  
    print("   • Ethical tension creates measurable triage choices (children vs elderly)")
    print(f"   • Live UI available at: {SERVER_URL}/web")
    print_separator("=")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())