# Makefile — Vaccine Cold Chain
#
# This Makefile is a thin convenience wrapper around `run_eval.py`.
# Everything here works WITHOUT a running FastAPI server, Docker, or the
# Next.js Mission Control UI — it imports the env class in-process.
#
# Usage:
#     make eval-scenario1          # the headline ablation (sensor false alarm)
#     make eval-scenario2          # closing road window
#     make eval-scenario3          # triage call
#     make eval-all                # all three scenarios, both rule-based agents
#     make eval-llm-scenario1      # gpt-4o + gpt-3.5 ablation (needs OPENAI_API_KEY)
#     make clean-eval              # remove generated eval JSONs
#
# Note for Windows users: run with `make.exe` from MSYS2 / Git Bash, or just
# copy/paste the underlying `python run_eval.py ...` command into PowerShell.

PYTHON      ?= python
EPISODES    ?= 50
DIFFICULTY  ?= hard
SEED        ?= 42

EVAL_DIR    := eval_outputs

NO_BRIEF    := $(EVAL_DIR)/scenario%_no_briefing.json
WITH_BRIEF  := $(EVAL_DIR)/scenario%_with_briefing.json

.PHONY: eval-scenario1 eval-scenario2 eval-scenario3 \
        eval-all eval-llm-scenario1 clean-eval _eval_dir

_eval_dir:
	@mkdir -p $(EVAL_DIR)

# -----------------------------------------------------------------------------
# Scenario 1 — Sensor false alarm (the headline ablation)
#
# Runs the same rule-based decision rule twice — once IGNORING the briefing,
# once with the briefing prepended to its reasoning. Then diffs the two JSONs.
# Because the rule cannot read text, the actions and rewards must be IDENTICAL
# (only the `reasoning` strings differ). This is the control that proves any
# uplift you see from a real LLM agent comes from understanding the briefing,
# not from the briefing being in the prompt.
# -----------------------------------------------------------------------------
eval-scenario1: _eval_dir
	@echo ""
	@echo "==> Scenario 1, RULE-BASED NO BRIEFING ($(EPISODES) episodes)"
	$(PYTHON) run_eval.py --agent rule_based_no_briefing --scenario 1 \
		--episodes $(EPISODES) --seed $(SEED) --difficulty $(DIFFICULTY) \
		--output $(EVAL_DIR)/scenario1_no_briefing.json
	@echo ""
	@echo "==> Scenario 1, RULE-BASED WITH BRIEFING ($(EPISODES) episodes)"
	$(PYTHON) run_eval.py --agent rule_based_with_briefing --scenario 1 \
		--episodes $(EPISODES) --seed $(SEED) --difficulty $(DIFFICULTY) \
		--output $(EVAL_DIR)/scenario1_with_briefing.json
	@echo ""
	@echo "==> diff (key_action lines only — should be identical):"
	-@diff \
		<(grep -E '"action_type"|"node"|"optimal_action_taken"' $(EVAL_DIR)/scenario1_no_briefing.json) \
		<(grep -E '"action_type"|"node"|"optimal_action_taken"' $(EVAL_DIR)/scenario1_with_briefing.json) \
		|| echo "(rule-based control diff above; reasoning strings will differ — that's expected)"

# -----------------------------------------------------------------------------
# Scenario 2 — Closing road window. Same ablation pattern.
# -----------------------------------------------------------------------------
eval-scenario2: _eval_dir
	@echo "==> Scenario 2, RULE-BASED NO BRIEFING ($(EPISODES) episodes)"
	$(PYTHON) run_eval.py --agent rule_based_no_briefing --scenario 2 \
		--episodes $(EPISODES) --seed $(SEED) --difficulty $(DIFFICULTY) \
		--output $(EVAL_DIR)/scenario2_no_briefing.json
	@echo "==> Scenario 2, RULE-BASED WITH BRIEFING ($(EPISODES) episodes)"
	$(PYTHON) run_eval.py --agent rule_based_with_briefing --scenario 2 \
		--episodes $(EPISODES) --seed $(SEED) --difficulty $(DIFFICULTY) \
		--output $(EVAL_DIR)/scenario2_with_briefing.json

# -----------------------------------------------------------------------------
# Scenario 3 — Triage (PHC_Sindhari 12% turnout vs CHC_Balotra 100%).
# -----------------------------------------------------------------------------
eval-scenario3: _eval_dir
	@echo "==> Scenario 3, RULE-BASED NO BRIEFING ($(EPISODES) episodes)"
	$(PYTHON) run_eval.py --agent rule_based_no_briefing --scenario 3 \
		--episodes $(EPISODES) --seed $(SEED) --difficulty $(DIFFICULTY) \
		--output $(EVAL_DIR)/scenario3_no_briefing.json
	@echo "==> Scenario 3, RULE-BASED WITH BRIEFING ($(EPISODES) episodes)"
	$(PYTHON) run_eval.py --agent rule_based_with_briefing --scenario 3 \
		--episodes $(EPISODES) --seed $(SEED) --difficulty $(DIFFICULTY) \
		--output $(EVAL_DIR)/scenario3_with_briefing.json

# -----------------------------------------------------------------------------
# All three scenarios, both rule-based agents.
# -----------------------------------------------------------------------------
eval-all: eval-scenario1 eval-scenario2 eval-scenario3
	@echo ""
	@echo "==> All rule-based ablations done. JSONs in $(EVAL_DIR)/"

# -----------------------------------------------------------------------------
# LLM ablation. Requires OPENAI_API_KEY. Defaults to a small episode count
# because GPT-4 costs money — bump with `make EPISODES=20 eval-llm-scenario1`.
# -----------------------------------------------------------------------------
LLM_EPISODES ?= 5

eval-llm-scenario1: _eval_dir
	@if [ -z "$$OPENAI_API_KEY" ]; then \
		echo "ERROR: OPENAI_API_KEY not set. Export it and re-run."; \
		exit 1; \
	fi
	@echo "==> Scenario 1, GPT-3.5 ($(LLM_EPISODES) episodes)"
	$(PYTHON) run_eval.py --agent gpt35 --scenario 1 \
		--episodes $(LLM_EPISODES) --seed $(SEED) --difficulty $(DIFFICULTY) \
		--output $(EVAL_DIR)/scenario1_gpt35.json
	@echo "==> Scenario 1, GPT-4 ($(LLM_EPISODES) episodes)"
	$(PYTHON) run_eval.py --agent gpt4 --scenario 1 \
		--episodes $(LLM_EPISODES) --seed $(SEED) --difficulty $(DIFFICULTY) \
		--output $(EVAL_DIR)/scenario1_gpt4.json

# -----------------------------------------------------------------------------
# Cleanup.
# -----------------------------------------------------------------------------
clean-eval:
	@rm -rf $(EVAL_DIR) eval_results.json eval_results_*.json
	@echo "Removed eval JSONs."
