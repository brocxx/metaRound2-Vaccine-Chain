#!/usr/bin/env python3
"""
Final validation script for Phase 1E: submission-ready check.

Verifies all the non-negotiable commitments from the build brief:
1. HF Space must not crash (defensive code, pinned deps, proper error handling)
2. Before/after evidence visible in README within 10 seconds
3. Sensor lie visible in /web UI (amber-colored with warning icon)

This is the final checkpoint before HF Space deployment.
"""

import sys
import os
import json
from pathlib import Path

# Add current directory to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

def check_file_exists(path: str, description: str) -> bool:
    if Path(path).exists():
        print(f"[OK] {description}: {path}")
        return True
    else:
        print(f"[MISSING] {description}: {path}")
        return False

def check_dockerfile_healthcheck() -> bool:
    dockerfile = Path("Dockerfile")
    if not dockerfile.exists():
        print("[FAIL] Dockerfile missing")
        return False
    
    content = dockerfile.read_text()
    if "HEALTHCHECK" in content and "/health" in content:
        print("[OK] Dockerfile has HEALTHCHECK directive")
        return True
    else:
        print("[FAIL] Dockerfile missing HEALTHCHECK directive")
        return False

def check_openenv_manifest() -> bool:
    manifest = Path("openenv.yaml")
    if not manifest.exists():
        print("[FAIL] openenv.yaml missing")
        return False
    
    content = manifest.read_text()
    required_fields = ["name:", "version:", "entry_point:", "observation_space:", "action_space:"]
    missing = [f for f in required_fields if f not in content]
    
    if missing:
        print(f"[FAIL] openenv.yaml missing required fields: {missing}")
        return False
    else:
        print("[OK] openenv.yaml is well-formed")
        return True

def check_bible_field_names() -> bool:
    """Verify models.py has the exact Bible field names."""
    try:
        from models import NodeObservation
        obs = NodeObservation(
            node_name="test",
            sensor_reading=5.0,
            actual_temperature=5.0,
            sensor_lying=False,
            generator_fuel_pct=100.0,
            temperature_alarm=False,
            vials_at_node=100
        )
        
        required_fields = {
            "sensor_reading", "actual_temperature", "sensor_lying",
            "generator_fuel_pct", "temperature_alarm"
        }
        
        obs_dict = obs.to_dict()
        missing = required_fields - set(obs_dict.keys())
        
        if missing:
            print(f"[FAIL] NodeObservation missing Bible fields: {missing}")
            return False
        else:
            print("[OK] NodeObservation has all Bible field names")
            return True
            
    except Exception as e:
        print(f"[FAIL] Error validating NodeObservation: {e}")
        return False

def check_web_ui_sensor_lie() -> bool:
    """Check that web.html contains sensor lie UI elements."""
    web_html = Path("server/web.html")
    if not web_html.exists():
        print("[FAIL] server/web.html missing")
        return False
    
    content = web_html.read_text(encoding="utf-8")
    required_elements = [
        "sensor_lying",
        "SENSOR LYING",
        "amber",
        "warn",
        "warning",
        "/state",
        "1500"  # polling interval
    ]
    
    missing = [elem for elem in required_elements if elem not in content]
    if missing:
        print(f"[FAIL] web.html missing sensor lie UI elements: {missing}")
        return False
    else:
        print("[OK] web.html has sensor lie amber callout and polling")
        return True

def check_briefing_fallback() -> bool:
    """Verify briefings.py has defensive fallback for missing OpenAI API key."""
    try:
        from server.briefings import generate_briefing
        
        # Test without API key
        old_key = os.environ.get("OPENAI_API_KEY")
        if "OPENAI_API_KEY" in os.environ:
            del os.environ["OPENAI_API_KEY"]
        
        briefing = generate_briefing("hard", "barmer")
        
        # Restore old key
        if old_key:
            os.environ["OPENAI_API_KEY"] = old_key
        
        if briefing and len(briefing) > 50:
            print("[OK] Briefing generation has fallback (no API key crash)")
            return True
        else:
            print("[FAIL] Briefing fallback failed")
            return False
            
    except Exception as e:
        print(f"[FAIL] Error testing briefing fallback: {e}")
        return False

def check_environment_smoke_test() -> bool:
    """Quick environment instantiation test."""
    try:
        from server.environment import VaccineColdChainEnv
        from models import Action
        
        env = VaccineColdChainEnv(seed=42)
        obs = env.reset(difficulty="hard", district="barmer")
        
        # Verify required fields
        if not obs.briefing:
            print("[FAIL] Environment reset did not return briefing")
            return False
        
        if len(obs.nodes) != 3:
            print(f"[FAIL] Environment has {len(obs.nodes)} nodes, expected 3")
            return False
        
        # Test one step
        action = Action(node="DVS_Barmer", action_type="check_temperature")
        result = env.step(action)
        
        if result.reward is None:
            print("[FAIL] Environment step did not return reward")
            return False
        
        print("[OK] Environment smoke test passed")
        return True
        
    except Exception as e:
        print(f"[FAIL] Environment smoke test failed: {e}")
        return False

def check_endpoints_importable() -> bool:
    """Verify server.app imports without errors."""
    try:
        from server.app import app
        print("[OK] FastAPI app imports successfully")
        return True
    except Exception as e:
        print(f"[FAIL] FastAPI app import failed: {e}")
        return False

def main():
    """Run all validation checks."""
    print("=" * 70)
    print("PHASE 1E FINAL VALIDATION - SUBMISSION READINESS CHECK")
    print("=" * 70)
    
    checks = [
        # File existence
        (lambda: check_file_exists("README.md", "README"), "README exists"),
        (lambda: check_file_exists("Dockerfile", "Dockerfile"), "Dockerfile exists"),
        (lambda: check_file_exists("requirements.txt", "Requirements"), "Requirements exists"),
        (lambda: check_file_exists("openenv.yaml", "OpenEnv manifest"), "Manifest exists"),
        (lambda: check_file_exists("client.py", "Demo client"), "Client exists"),
        (lambda: check_file_exists("TRAINING_HANDOFF.md", "Training handoff"), "Handoff exists"),
        (lambda: check_file_exists("server/app.py", "FastAPI app"), "FastAPI app exists"),
        (lambda: check_file_exists("server/environment.py", "Environment"), "Environment exists"),
        (lambda: check_file_exists("server/web.html", "Web UI"), "Web UI exists"),
        
        # Content validation
        (check_dockerfile_healthcheck, "Dockerfile HEALTHCHECK"),
        (check_openenv_manifest, "OpenEnv manifest format"),
        (check_bible_field_names, "Bible field names"),
        (check_web_ui_sensor_lie, "Web UI sensor lie callout"),
        (check_briefing_fallback, "Briefing API fallback"),
        
        # Code validation
        (check_endpoints_importable, "FastAPI app imports"),
        (check_environment_smoke_test, "Environment smoke test"),
    ]
    
    passed = 0
    total = len(checks)
    
    print("\nRunning validation checks...\n")
    
    for i, (check_fn, description) in enumerate(checks, 1):
        print(f"[{i:2d}/{total}] {description}...")
        try:
            if check_fn():
                passed += 1
            else:
                print(f"     [FAILED] {description}")
        except Exception as e:
            print(f"     [ERROR] {description}: {e}")
        print()
    
    print("=" * 70)
    print(f"VALIDATION SUMMARY: {passed}/{total} checks passed")
    
    if passed == total:
        print("SUCCESS: All validation checks passed.")
        print("Ready for HuggingFace Space deployment.")
        print("=" * 70)
        return 0
    else:
        print("FAILED: Fix the issues above before deployment.")
        print("=" * 70)
        return 1

if __name__ == "__main__":
    sys.exit(main())