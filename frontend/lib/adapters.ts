/**
 * Translates the FastAPI backend's payload shapes into the frontend's
 * VaccineStateV2 shape. This is the *only* file that has to change if
 * Person 1's schema drifts.
 *
 * Key impedance mismatches handled here:
 *   - Backend nodes are an array; frontend wants a Record keyed by NodeKey.
 *   - Backend generator_fuel_pct is 0..100; frontend uses 0..1.
 *   - Backend hour field is `current_hour`; frontend uses `hour`.
 *   - Backend events are flat strings; frontend wants typed EventV2 objects
 *     with hour + type for colour-coded rendering.
 *   - Backend last_action is a dict; frontend wants a display string
 *     (e.g. "schedule_outreach(CHC_Balotra, 30)").
 */

import type {
  BackendAction,
  BackendNodeObservation,
  BackendState,
} from "./backendTypes";
import type {
  BriefingSource,
  EventV2,
  NodeKey,
  NodeStateV2,
  RewardBreakdown,
  Task,
  VaccineStateV2,
} from "./types";

const NODE_KEYS: NodeKey[] = ["DVS_Barmer", "CHC_Balotra", "PHC_Sindhari"];

// Conservative fallbacks if the backend is missing fields entirely.
const EMPTY_NODE: NodeStateV2 = {
  vials: 0,
  sensor_reading: 5,
  actual_temperature: 5,
  sensor_lying: false,
  generator_on: true,
  generator_fuel_pct: 1,
  temperature_alarm: false,
};

const EMPTY_REWARD: RewardBreakdown = {
  coverage: 0,
  waste: 0,
  missed_sessions: 0,
  total: 0,
};

const KNOWN_DIFFICULTIES: ReadonlySet<Task> = new Set([
  "easy",
  "medium",
  "hard",
] as const);

function asTask(d: string | undefined): Task {
  const lower = (d ?? "").toLowerCase();
  return KNOWN_DIFFICULTIES.has(lower as Task) ? (lower as Task) : "medium";
}

function adaptNode(n: BackendNodeObservation): NodeStateV2 {
  const fuel01 = Math.max(0, Math.min(1, n.generator_fuel_pct / 100));
  return {
    vials: n.vials_at_node,
    sensor_reading: n.sensor_reading,
    actual_temperature: n.actual_temperature,
    sensor_lying: n.sensor_lying,
    // Backend doesn't expose `generator_working` to the agent — but if
    // fuel is at 0 the simulation drives temperature toward 22°C, which
    // is what `generator_on=false` is meant to surface in the UI. So
    // approximate: generator is "on" while there's any fuel left.
    generator_on: n.generator_fuel_pct > 0,
    generator_fuel_pct: fuel01,
    temperature_alarm: n.temperature_alarm,
  };
}

function adaptNodes(
  raw: BackendNodeObservation[]
): Record<NodeKey, NodeStateV2> {
  const out: Record<NodeKey, NodeStateV2> = {
    DVS_Barmer: { ...EMPTY_NODE },
    CHC_Balotra: { ...EMPTY_NODE },
    PHC_Sindhari: { ...EMPTY_NODE },
  };
  for (const n of raw) {
    if ((NODE_KEYS as string[]).includes(n.node_name)) {
      out[n.node_name as NodeKey] = adaptNode(n);
    }
  }
  return out;
}

const HOUR_RE = /\[h(\d+)\]\s*(.*)$/;

function eventTypeFromText(text: string): EventV2["type"] {
  const u = text.toUpperCase();
  if (u.includes("SENSOR LYING") || u.includes("SENSOR LIE"))
    return "sensor_lie";
  if (u.includes("ETHICAL")) return "ethical_tension";
  if (u.includes("FLOOD")) return "flood";
  if (u.includes("SPOIL")) return "spoilage";
  if (u.includes("GENERATOR")) return "generator";
  if (u.includes("TRUCK")) return "truck";
  if (u.includes("OUTREACH") || u.includes("VACCINAT")) return "outreach";
  if (u.includes("FUEL")) return "generator";
  if (u.includes("EMERGENCY")) return "info";
  return "info";
}

/**
 * Backend events look like `[h05] FLOOD HAZARD at PHC_Sindhari (hour 5).`.
 * Pull the hour out and tag a type so the EventLog can colour them.
 */
export function parseEvent(raw: string, fallbackHour = 0): EventV2 {
  const m = raw.match(HOUR_RE);
  const hour = m ? Number.parseInt(m[1], 10) : fallbackHour;
  const text = (m?.[2] ?? raw).trim();
  const node = detectNode(text);
  return {
    hour,
    type: eventTypeFromText(text),
    text,
    nodes: node ? [node] : undefined,
  };
}

function detectNode(text: string): NodeKey | undefined {
  for (const k of NODE_KEYS) {
    if (text.includes(k)) return k;
  }
  return undefined;
}

/**
 * Render the backend's last_action dict as the chip string the
 * AgentFeed.LastActionPanel renders. Quantity is appended for outreach.
 */
export function formatAction(a: BackendAction | null | undefined): string | null {
  if (!a) return null;
  if (a.action_type === "no_op") return "no_op";
  const q = a.quantity != null ? `, ${a.quantity}` : "";
  return `${a.action_type}(${a.node}${q})`;
}

interface AdaptOptions {
  /** Tracks whether the user supplied a custom briefing on /reset. */
  briefingSource?: BriefingSource;
  /** Locked at episode start; backend doesn't expose it directly. */
  maxHours?: number;
}

export function adaptBackendState(
  b: BackendState,
  opts: AdaptOptions = {}
): VaccineStateV2 {
  const events: EventV2[] = (b.events ?? []).map((e) => parseEvent(e, b.current_hour));

  const reward: RewardBreakdown = {
    coverage: b.coverage ?? 0,
    waste: b.waste ?? 0,
    missed_sessions: b.missed_sessions ?? 0,
    total:
      b.rubric_scores?.total ??
      Math.max(0, (b.coverage ?? 0) - (b.waste ?? 0)),
  };

  const computedMax =
    (b.current_hour ?? 0) + (b.time_remaining_hours ?? 0) || 72;
  const maxHours = opts.maxHours ?? computedMax;

  return {
    hour: b.current_hour ?? 0,
    max_hours: maxHours,
    difficulty: asTask(b.difficulty),
    briefing: b.briefing ?? "",
    briefing_source: opts.briefingSource ?? "auto",
    done: !!b.done,
    nodes: adaptNodes(b.nodes ?? []),
    roads: {},
    routes: (b.routes ?? {}) as VaccineStateV2["routes"],
    nodes_geo: (b.nodes_geo ?? {}) as VaccineStateV2["nodes_geo"],
    outreach_schedule: [],
    last_action: formatAction(b.last_action),
    last_reasoning: b.last_reasoning ?? null,
    events,
    reward_breakdown: reward,
    ethical_tension_active: !!b.ethical_tension_active,
    truck_eta_known: !!b.truck_arrived,
    truck_arriving_in_hours: b.truck_arrived ? 0 : null,
  };
}

/**
 * Adapt the slim Observation returned by /reset. We don't have access
 * to `events`, `rubric_scores`, etc. on reset, so we fill them with
 * defaults. The first /state poll afterwards will overwrite this.
 */
export function adaptResetObservation(
  obs: {
    nodes: BackendNodeObservation[];
    time_remaining_hours: number;
    current_hour: number;
    briefing: string;
    truck_arrived: boolean;
    ethical_tension_active: boolean;
    last_event?: string | null;
  },
  difficulty: Task,
  opts: AdaptOptions = {}
): VaccineStateV2 {
  const events: EventV2[] = obs.last_event
    ? [parseEvent(obs.last_event, obs.current_hour)]
    : [];
  const computedMax =
    (obs.current_hour ?? 0) + (obs.time_remaining_hours ?? 0) || 72;
  const maxHours = opts.maxHours ?? computedMax;
  return {
    hour: obs.current_hour ?? 0,
    max_hours: maxHours,
    difficulty,
    briefing: obs.briefing ?? "",
    briefing_source: opts.briefingSource ?? "auto",
    done: false,
    nodes: adaptNodes(obs.nodes ?? []),
    roads: {},
    outreach_schedule: [],
    last_action: null,
    last_reasoning: null,
    events,
    reward_breakdown: { ...EMPTY_REWARD },
    ethical_tension_active: !!obs.ethical_tension_active,
    truck_eta_known: !!obs.truck_arrived,
    truck_arriving_in_hours: obs.truck_arrived ? 0 : null,
  };
}
