/**
 * Deterministic mock episode generator emitting V2-shaped /state per hour.
 *
 * Each difficulty has:
 *   - A hand-written Barmer-flavoured briefing (the "auto-generated" demo path)
 *   - A baked-in narrative trace (events, transfers, reasoning)
 *   - Realistic numbers: vials, fuel, sensor reads, ground-truth temps
 *
 * The narrative is intentionally script-like so the demo always tells the
 * same story when judges scrub the timeline.
 *
 * When Person 1's V2 backend is up, useEpisode swaps this for live polling.
 */

import {
  EventV2,
  MAX_HOURS,
  NodeKey,
  NodeStateV2,
  OutreachScheduleEntry,
  RewardBreakdown,
  RoadKey,
  Task,
  VaccineStateV2,
} from "./types";

// ─── Briefings ────────────────────────────────────────────────────────────

export const AUTO_BRIEFINGS: Record<Task, string> = {
  easy: `Barmer district health bulletin, post-monsoon week 2. All three corridor roads — DVS Barmer to CHC Balotra, CHC Balotra to PHC Sindhari, and the direct DVS to PHC link — were inspected last Tuesday and are passable. Generators across the network are within their 6-month NHM service interval. eVIN reports no overdue calibration on any temperature sensor in the cluster. One outreach session scheduled at CHC Balotra at hour 24, expecting eighty children for measles first-dose. No supply chain disruptions anticipated this period.`,

  medium: `Barmer pre-monsoon advisory. The bridge on the CHC Balotra to PHC Sindhari corridor at km 14 has historic flood-closure within twelve hours of heavy rain — IMD shows a depression forming over the Arabian Sea. The generator at CHC Balotra is eight months past its last service; NHM interval is six. Treat any generator alarm there as elevated-probability real failure. Stock at CHC Balotra has roughly four days of useful shelf life left after a delayed shipment last week. Outreach at PHC Sindhari at hour 24 needs eighty vials. Plan transfers early in the window before any road risk materialises.`,

  hard: `Barmer district peak-monsoon emergency briefing. Two consecutive days of heavy rainfall recorded at Sindhari tehsil; the road from CHC Balotra to PHC Sindhari is at high risk of waterlogging within the next four to eight hours. PHC Sindhari's temperature sensor was flagged for calibration drift in last quarter's eVIN audit — cross-check every alarm there against the generator fuel reading and power state before acting; a sensor spike with full fuel and the generator running is almost certainly a false alarm. Both DVS Barmer and CHC Balotra generators are overdue for service. A supply truck is en route to DVS Barmer; arrival window is hour twenty to hour forty-five, exact ETA unavailable until check_truck_status is called. Two outreach sessions scheduled simultaneously at hour 18 — both need 100 vials — and only one batch is currently in cold-storage at DVS. Prioritise; do not over-commit.`,
};

// ─── Outreach schedules ───────────────────────────────────────────────────

const OUTREACH: Record<Task, OutreachScheduleEntry[]> = {
  easy: [
    {
      hour: 24,
      node: "CHC_Balotra",
      vials_needed: 80,
      cohort: "80 children — measles first dose",
    },
  ],
  medium: [
    {
      hour: 24,
      node: "PHC_Sindhari",
      vials_needed: 80,
      cohort: "80 children — DPT booster",
    },
  ],
  hard: [
    {
      hour: 18,
      node: "CHC_Balotra",
      vials_needed: 100,
      cohort: "100 children — MR campaign",
    },
    {
      hour: 18,
      node: "PHC_Sindhari",
      vials_needed: 100,
      cohort: "100 children — MR campaign",
    },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Seeded LCG so traces are deterministic across SSR/CSR (no hydration drift)
 * and identical between demo runs. Reset per trace via the closure below.
 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function copyNodes(
  src: Record<NodeKey, NodeStateV2>
): Record<NodeKey, NodeStateV2> {
  return {
    DVS_Barmer: { ...src.DVS_Barmer },
    CHC_Balotra: { ...src.CHC_Balotra },
    PHC_Sindhari: { ...src.PHC_Sindhari },
  };
}

function freshNode(initial: Partial<NodeStateV2>): NodeStateV2 {
  return {
    vials: 0,
    sensor_reading: 5.0,
    actual_temperature: 5.0,
    sensor_lying: false,
    generator_on: true,
    generator_fuel_pct: 1.0,
    temperature_alarm: false,
    hours_until_expiry: 96,
    ...initial,
  };
}

function recomputeAlarmAndLie(node: NodeStateV2): void {
  node.temperature_alarm = node.sensor_reading > 8.0;
  node.sensor_lying = Math.abs(node.sensor_reading - node.actual_temperature) > 1.0;
}

function evolveTemp(node: NodeStateV2, rng: () => number): void {
  // Temperature drifts toward the generator's setpoint when on (~5°C),
  // toward ambient (~28°C) otherwise, with a small jitter to feel alive.
  const target = node.generator_on ? 5.0 : 28.0;
  const drift = node.generator_on ? 0.4 : 1.5;
  node.actual_temperature += (target - node.actual_temperature) * drift * 0.3;
  node.actual_temperature += (rng() - 0.5) * 0.2;
  if (!node.sensor_lying) {
    node.sensor_reading = node.actual_temperature + (rng() - 0.5) * 0.3;
  }
  if (node.generator_on) {
    node.generator_fuel_pct = clamp(node.generator_fuel_pct - 0.012, 0, 1);
  }
  if (node.generator_fuel_pct <= 0.0) {
    node.generator_on = false;
  }
  recomputeAlarmAndLie(node);
}

function makeRewardBreakdown(
  delivered: number,
  required: number,
  wasted: number,
  missed: number
): RewardBreakdown {
  const coverage = required === 0 ? 1 : clamp(delivered / required, 0, 1);
  const waste = clamp(wasted / Math.max(required, 1), 0, 1);
  const total = Math.max(0, coverage - 0.3 * waste - 0.5 * missed);
  return {
    coverage,
    waste,
    missed_sessions: missed,
    total,
  };
}

// ─── Trace builders ───────────────────────────────────────────────────────

function buildEasyTrace(): VaccineStateV2[] {
  const max = MAX_HOURS.easy;
  const trace: VaccineStateV2[] = [];
  const rng = makeRng(0xea51);
  let nodes: Record<NodeKey, NodeStateV2> = {
    DVS_Barmer: freshNode({ vials: 220 }),
    CHC_Balotra: freshNode({ vials: 60 }),
    PHC_Sindhari: freshNode({ vials: 40 }),
  };
  let lastAction: string | null = null;
  let lastReasoning: string | null = null;
  const events: EventV2[] = [];
  let delivered = 0;
  const wasted = 0;

  for (let h = 0; h <= max; h++) {
    nodes = copyNodes(nodes);
    Object.values(nodes).forEach((n) => evolveTemp(n, rng));

    if (h === 8) {
      lastAction = "transfer_stock(DVS_Barmer→CHC_Balotra, 80)";
      lastReasoning =
        "Outreach at CHC_Balotra in 16 hours needs 80 vials. Network is stable per the briefing — moving stock now while the road is clear is the lowest-risk window.";
      nodes.DVS_Barmer.vials -= 80;
      nodes.CHC_Balotra.vials += 80;
      events.push({
        hour: h,
        type: "transfer",
        text: "80 vials moved DVS Barmer → CHC Balotra",
        nodes: ["DVS_Barmer", "CHC_Balotra"],
        road: "DVS_Barmer_to_CHC_Balotra",
      });
    } else if (h === 24) {
      lastAction = "do_nothing";
      lastReasoning =
        "Outreach session firing at CHC_Balotra. Stock is staged, all temperatures nominal — no intervention needed.";
      nodes.CHC_Balotra.vials -= 80;
      delivered += 80;
      events.push({
        hour: h,
        type: "outreach",
        text: "Outreach delivered: 80 / 80 at CHC Balotra",
        nodes: ["CHC_Balotra"],
      });
    } else if (h % 6 === 0 && h !== 0) {
      lastAction = "do_nothing";
      lastReasoning =
        "All sensors green, fuel above 70 percent, no events in queue. Holding.";
    }

    const required = 80;
    const missed = h < 24 ? 0 : delivered < required ? 1 : 0;
    const reward = makeRewardBreakdown(delivered, required, wasted, missed);

    trace.push({
      hour: h,
      max_hours: max,
      difficulty: "easy",
      briefing: AUTO_BRIEFINGS.easy,
      briefing_source: "auto",
      done: h >= max,
      nodes,
      roads: {
        DVS_Barmer_to_CHC_Balotra: "open",
        CHC_Balotra_to_PHC_Sindhari: "open",
        DVS_Barmer_to_PHC_Sindhari: "open",
      },
      outreach_schedule: OUTREACH.easy.map((o) => ({
        ...o,
        fired: h >= o.hour,
        delivered: h >= o.hour ? Math.min(80, o.vials_needed) : undefined,
      })),
      last_action: lastAction,
      last_reasoning: lastReasoning,
      events: events.slice(-5),
      reward_breakdown: reward,
    });
  }
  return trace;
}

function buildMediumTrace(): VaccineStateV2[] {
  const max = MAX_HOURS.medium;
  const trace: VaccineStateV2[] = [];
  const rng = makeRng(0x3ed1);
  let nodes: Record<NodeKey, NodeStateV2> = {
    DVS_Barmer: freshNode({ vials: 200 }),
    CHC_Balotra: freshNode({ vials: 50, generator_fuel_pct: 0.55 }),
    PHC_Sindhari: freshNode({ vials: 30 }),
  };
  let lastAction: string | null = null;
  let lastReasoning: string | null = null;
  const events: EventV2[] = [];
  let delivered = 0;
  const wasted = 0;
  const required = 80;

  for (let h = 0; h <= max; h++) {
    nodes = copyNodes(nodes);
    Object.values(nodes).forEach((n) => evolveTemp(n, rng));

    if (h === 4) {
      lastAction = "request_fuel(CHC_Balotra)";
      lastReasoning =
        "Briefing flagged the CHC_Balotra generator as 8 months past service — that's elevated failure risk. Fuel is at 53%. Pre-emptively requesting refuel before any rain hits.";
      nodes.CHC_Balotra.generator_fuel_pct = 1.0;
      events.push({
        hour: h,
        type: "generator",
        text: "Refuel requested at CHC Balotra (preemptive, briefing-cited)",
        nodes: ["CHC_Balotra"],
      });
    } else if (h === 10) {
      lastAction = "transfer_stock(DVS_Barmer→PHC_Sindhari, 80)";
      lastReasoning =
        "Outreach at PHC_Sindhari needs 80 vials in 14 hours. Briefing says the CHC→PHC bridge can flood within 12h of heavy rain — moving via the direct DVS→PHC corridor while it's open.";
      nodes.DVS_Barmer.vials -= 80;
      nodes.PHC_Sindhari.vials += 80;
      events.push({
        hour: h,
        type: "transfer",
        text: "80 vials DVS Barmer → PHC Sindhari (direct route, pre-flood)",
        nodes: ["DVS_Barmer", "PHC_Sindhari"],
        road: "DVS_Barmer_to_PHC_Sindhari",
      });
    } else if (h === 16) {
      // Real flood materialises, justifying the early move.
      events.push({
        hour: h,
        type: "flood",
        text: "Heavy rain — CHC Balotra to PHC Sindhari road CLOSED",
        road: "CHC_Balotra_to_PHC_Sindhari",
      });
      lastAction = "do_nothing";
      lastReasoning =
        "The CHC→PHC road has now closed as the briefing predicted. Stock is already pre-positioned at PHC_Sindhari — no further action required.";
    } else if (h === 24) {
      lastAction = "do_nothing";
      lastReasoning =
        "Outreach session firing at PHC_Sindhari. 80 vials staged, generator stable. Holding.";
      nodes.PHC_Sindhari.vials -= 80;
      delivered += 80;
      events.push({
        hour: h,
        type: "outreach",
        text: "Outreach delivered: 80 / 80 at PHC Sindhari",
        nodes: ["PHC_Sindhari"],
      });
    } else if (h % 8 === 0 && h !== 0) {
      lastAction = "do_nothing";
      lastReasoning =
        "Roads closed but no stock movement needed. All sensors green. Holding.";
    }

    const missed = h < 24 ? 0 : delivered < required ? 1 : 0;
    const reward = makeRewardBreakdown(delivered, required, wasted, missed);

    trace.push({
      hour: h,
      max_hours: max,
      difficulty: "medium",
      briefing: AUTO_BRIEFINGS.medium,
      briefing_source: "auto",
      done: h >= max,
      nodes,
      roads: {
        DVS_Barmer_to_CHC_Balotra: "open",
        CHC_Balotra_to_PHC_Sindhari: h >= 16 ? "closed" : "open",
        DVS_Barmer_to_PHC_Sindhari: "open",
      },
      outreach_schedule: OUTREACH.medium.map((o) => ({
        ...o,
        fired: h >= o.hour,
        delivered: h >= o.hour ? Math.min(80, o.vials_needed) : undefined,
      })),
      last_action: lastAction,
      last_reasoning: lastReasoning,
      events: events.slice(-5),
      reward_breakdown: reward,
    });
  }
  return trace;
}

function buildHardTrace(): VaccineStateV2[] {
  const max = MAX_HOURS.hard;
  const trace: VaccineStateV2[] = [];
  const rng = makeRng(0xb007);
  let nodes: Record<NodeKey, NodeStateV2> = {
    DVS_Barmer: freshNode({ vials: 240, generator_fuel_pct: 0.7 }),
    CHC_Balotra: freshNode({ vials: 60, generator_fuel_pct: 0.5 }),
    PHC_Sindhari: freshNode({ vials: 40, generator_fuel_pct: 0.45 }),
  };
  let lastAction: string | null = null;
  let lastReasoning: string | null = null;
  const events: EventV2[] = [];
  let delivered = 0;
  const wasted = 0;
  const required = 200;
  let truckArrived = false;
  let ethicalActive = false;
  let truckEtaKnown = false;
  let truckArrivingIn: number | null = null;

  for (let h = 0; h <= max; h++) {
    nodes = copyNodes(nodes);
    Object.values(nodes).forEach((n) => evolveTemp(n, rng));

    // ─── Scripted star moments ─────────────────────────────────────────
    if (h === 3) {
      lastAction = "check_truck_status";
      lastReasoning =
        "Briefing says supply truck arrives between hours 20 and 45. Polling for ETA early so we can plan transfers around it.";
      truckEtaKnown = true;
      truckArrivingIn = 30;
      events.push({
        hour: h,
        type: "truck",
        text: "Supply truck ETA confirmed: hour 33 (DVS Barmer)",
        nodes: ["DVS_Barmer"],
      });
    } else if (h === 6) {
      // The sensor-lie star moment.
      nodes.PHC_Sindhari.sensor_reading = 9.4;
      nodes.PHC_Sindhari.actual_temperature = 4.8;
      recomputeAlarmAndLie(nodes.PHC_Sindhari);
      events.push({
        hour: h,
        type: "sensor_lie",
        text: "PHC Sindhari sensor reads 9.4°C — but generator on, fuel 100%",
        nodes: ["PHC_Sindhari"],
      });
      lastAction = "do_nothing";
      lastReasoning =
        "PHC_Sindhari sensor jumped to 9.4°C — alarm tripped. BUT: generator is ON, fuel is at full, ambient is 28°C. Briefing flagged this exact sensor for calibration drift in last quarter's eVIN audit. Conclusion: this is the false alarm the briefing warned about. Holding. A no-briefing agent would burn a request_fuel here.";
    } else if (h === 7) {
      // Sensor self-corrects — the lie was transient.
      nodes.PHC_Sindhari.sensor_reading = 5.1;
      nodes.PHC_Sindhari.actual_temperature = 5.0;
      recomputeAlarmAndLie(nodes.PHC_Sindhari);
      lastAction = "do_nothing";
      lastReasoning =
        "Sensor settled back to 5.1°C as expected. Decision validated — briefing-augmented reasoning saved a wasted action.";
    } else if (h === 12) {
      lastAction = "transfer_stock(DVS_Barmer→PHC_Sindhari, 100)";
      lastReasoning =
        "Outreach at PHC_Sindhari at hour 18 needs 100. Direct DVS→PHC road still open; CHC→PHC will likely close in the next 4–8h per the briefing. Move now.";
      nodes.DVS_Barmer.vials -= 100;
      nodes.PHC_Sindhari.vials += 100;
      events.push({
        hour: h,
        type: "transfer",
        text: "100 vials DVS Barmer → PHC Sindhari",
        nodes: ["DVS_Barmer", "PHC_Sindhari"],
        road: "DVS_Barmer_to_PHC_Sindhari",
      });
    } else if (h === 14) {
      lastAction = "transfer_stock(DVS_Barmer→CHC_Balotra, 60)";
      lastReasoning =
        "CHC_Balotra needs 100 for the simultaneous outreach but only has 60 onhand. Sending 60 more — that's all we can spare from DVS without risking the truck-arrival buffer.";
      nodes.DVS_Barmer.vials -= 60;
      nodes.CHC_Balotra.vials += 60;
      events.push({
        hour: h,
        type: "transfer",
        text: "60 vials DVS Barmer → CHC Balotra",
        nodes: ["DVS_Barmer", "CHC_Balotra"],
        road: "DVS_Barmer_to_CHC_Balotra",
      });
    } else if (h === 16) {
      events.push({
        hour: h,
        type: "flood",
        text: "Heavy rain — CHC Balotra ↔ PHC Sindhari road CLOSED",
        road: "CHC_Balotra_to_PHC_Sindhari",
      });
      lastAction = "do_nothing";
      lastReasoning =
        "Predicted flood materialised. PHC_Sindhari is fully stocked via the direct route; CHC_Balotra has 120 vials — short of the 100-target by 20 once outreach fires. Ethical tension incoming.";
      ethicalActive = true;
      events.push({
        hour: h,
        type: "ethical_tension",
        text: "Coverage gap: CHC Balotra outreach will fall ~20 vials short",
        nodes: ["CHC_Balotra"],
      });
    } else if (h === 18) {
      // Both outreaches fire.
      lastAction = "do_nothing";
      lastReasoning =
        "Outreach window. PHC_Sindhari fully delivered (100/100). CHC_Balotra delivers 100/100 — partial vials drawn from buffer. Both sessions covered.";
      nodes.PHC_Sindhari.vials -= 100;
      nodes.CHC_Balotra.vials -= 100;
      delivered += 200;
      events.push({
        hour: h,
        type: "outreach",
        text: "Outreach delivered: 100/100 at PHC Sindhari",
        nodes: ["PHC_Sindhari"],
      });
      events.push({
        hour: h,
        type: "outreach",
        text: "Outreach delivered: 100/100 at CHC Balotra",
        nodes: ["CHC_Balotra"],
      });
      ethicalActive = false;
    } else if (h === 33) {
      truckArrived = true;
      nodes.DVS_Barmer.vials += 200;
      events.push({
        hour: h,
        type: "truck",
        text: "Supply truck arrived at DVS Barmer (+200 vials)",
        nodes: ["DVS_Barmer"],
      });
      lastAction = "do_nothing";
      lastReasoning =
        "Truck arrived on schedule per the early ETA poll. DVS restocked. System back to safe inventory.";
    } else if (h === 26) {
      // Generator wobble at CHC during the dead window.
      nodes.CHC_Balotra.generator_fuel_pct = 0.18;
      lastAction = "request_fuel(CHC_Balotra)";
      lastReasoning =
        "CHC_Balotra fuel at 18% — refuel now while the road is open and we still have lead time.";
      nodes.CHC_Balotra.generator_fuel_pct = 1.0;
      events.push({
        hour: h,
        type: "generator",
        text: "CHC Balotra refuelled at 18%",
        nodes: ["CHC_Balotra"],
      });
    } else if (h === 48) {
      events.push({
        hour: h,
        type: "flood",
        text: "Rain easing — CHC Balotra ↔ PHC Sindhari road REOPENED",
        road: "CHC_Balotra_to_PHC_Sindhari",
      });
      lastAction = "do_nothing";
      lastReasoning =
        "Road reopened. Network back to nominal. No transfers pending.";
    } else if (h % 8 === 0 && h !== 0) {
      lastAction = "do_nothing";
      lastReasoning =
        "Network stable. Sensors cross-checked against fuel / generator state — all green.";
    }

    if (truckArrived && truckArrivingIn !== null) {
      truckArrivingIn = Math.max(0, truckArrivingIn - 1);
    } else if (truckEtaKnown && truckArrivingIn !== null) {
      truckArrivingIn = Math.max(0, 33 - h);
    }

    const missed = h < 18 ? 0 : delivered < required ? 1 : 0;
    const reward = makeRewardBreakdown(delivered, required, wasted, missed);

    const roads: Partial<Record<RoadKey, "open" | "closed">> = {
      DVS_Barmer_to_CHC_Balotra: "open",
      CHC_Balotra_to_PHC_Sindhari:
        h >= 16 && h < 48 ? "closed" : "open",
      DVS_Barmer_to_PHC_Sindhari: "open",
    };

    trace.push({
      hour: h,
      max_hours: max,
      difficulty: "hard",
      briefing: AUTO_BRIEFINGS.hard,
      briefing_source: "auto",
      done: h >= max,
      nodes,
      roads,
      outreach_schedule: OUTREACH.hard.map((o) => ({
        ...o,
        fired: h >= o.hour,
        delivered: h >= o.hour ? 100 : undefined,
      })),
      last_action: lastAction,
      last_reasoning: lastReasoning,
      events: events.slice(-5),
      reward_breakdown: reward,
      ethical_tension_active: ethicalActive,
      truck_eta_known: truckEtaKnown,
      truck_arriving_in_hours: truckArrivingIn,
    });
  }

  return trace;
}

// ─── Public API ──────────────────────────────────────────────────────────

const TRACES: Record<Task, VaccineStateV2[]> = {
  easy: buildEasyTrace(),
  medium: buildMediumTrace(),
  hard: buildHardTrace(),
};

export function getMockTrace(task: Task): VaccineStateV2[] {
  return TRACES[task];
}

export function getMockBriefing(task: Task): string {
  return AUTO_BRIEFINGS[task];
}
