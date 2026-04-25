// Node-side smoke test of the live adapter pipeline.
// Hits the FastAPI env at NEXT_PUBLIC_ENV_BASE_URL (or :7860 default),
// runs /reset → /step → /state through the same adapter code the dashboard uses,
// and prints the adapted VaccineStateV2 shape so we can eyeball field correctness.
//
// Run:   npx tsx scripts/smoke-live.ts

import { api } from "../lib/api";
import {
  adaptBackendState,
  adaptResetObservation,
  formatAction,
  parseEvent,
} from "../lib/adapters";
import type { BackendActionType } from "../lib/backendTypes";

async function main() {
  console.log("base url:", api.baseUrl || "(same-origin)");

  const health = await api.health();
  console.log("health:", health);

  const reset = await api.reset({
    difficulty: "hard",
    district: "barmer",
    user_briefing: null,
    seed: 42,
  });
  const adaptedReset = adaptResetObservation(reset, "hard", {
    briefingSource: "auto",
  });
  console.log("\nadapted /reset:");
  console.log({
    hour: adaptedReset.hour,
    max_hours: adaptedReset.max_hours,
    difficulty: adaptedReset.difficulty,
    briefing_source: adaptedReset.briefing_source,
    briefing_len: adaptedReset.briefing.length,
    ethical_tension_active: adaptedReset.ethical_tension_active,
    nodes: Object.fromEntries(
      Object.entries(adaptedReset.nodes).map(([k, v]) => [
        k,
        {
          vials: v.vials,
          sensor_reading: v.sensor_reading,
          sensor_lying: v.sensor_lying,
          generator_fuel_pct: v.generator_fuel_pct,
          temperature_alarm: v.temperature_alarm,
        },
      ])
    ),
  });

  const actions: BackendActionType[] = [
    "check_temperature",
    "check_truck_status",
    "no_op",
    "schedule_outreach",
  ];
  for (const at of actions) {
    const stepRes = await api.step({
      action: {
        node: "DVS_Barmer",
        action_type: at,
        ...(at === "schedule_outreach" ? { quantity: 30 } : {}),
      },
      reasoning: `smoke-test ${at}`,
    });
    console.log(
      `step(${at}): reward=${stepRes.reward.toFixed(3)} done=${stepRes.done}`
    );
  }

  const state = await api.state();
  const adapted = adaptBackendState(state, {
    briefingSource: "auto",
    maxHours: adaptedReset.max_hours,
  });
  console.log("\nadapted /state:");
  console.log({
    hour: adapted.hour,
    done: adapted.done,
    last_action: adapted.last_action,
    last_reasoning: adapted.last_reasoning?.slice(0, 60),
    events_count: adapted.events.length,
    events_sample: adapted.events.slice(0, 3),
    reward_breakdown: adapted.reward_breakdown,
    nodes_keys: Object.keys(adapted.nodes),
  });

  console.log("\nformatAction sanity:");
  console.log(
    formatAction({
      node: "CHC_Balotra",
      action_type: "schedule_outreach",
      quantity: 30,
    })
  );
  console.log(formatAction({ node: "DVS_Barmer", action_type: "no_op" }));

  console.log("\nparseEvent sanity:");
  console.log(parseEvent("[h05] FLOOD HAZARD at PHC_Sindhari (hour 5)."));
  console.log(
    parseEvent(
      "[h12] SENSOR LYING at CHC_Balotra: lifts reading by 2.4°C (actual=4.9°C)."
    )
  );

  console.log("\nOK");
}

main().catch((e) => {
  console.error("SMOKE_FAILED:", e);
  process.exit(1);
});
