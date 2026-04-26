/**
 * TypeScript port of the V2 backend schema (ROUND2_BIBLE_V2).
 *
 * The V2 /state endpoint returns:
 *   { hour, difficulty, briefing, done, nodes: dict, roads: dict,
 *     outreach_schedule, last_action, last_reasoning, events[-5:],
 *     reward_breakdown }
 *
 * Keep these types in lockstep with the FastAPI server. If the backend
 * schema drifts, edit here first; everywhere else recompiles.
 */

// ─── Identity ─────────────────────────────────────────────────────────────

export type Task = "easy" | "medium" | "hard";

export const NODE_KEYS = [
  "DVS_Barmer",
  "CHC_Balotra",
  "PHC_Sindhari",
] as const;
export type NodeKey = (typeof NODE_KEYS)[number];

export const NODE_LABELS: Record<NodeKey, string> = {
  DVS_Barmer: "DVS Barmer",
  CHC_Balotra: "CHC Balotra",
  PHC_Sindhari: "PHC Sindhari",
};

export const NODE_TYPE_LABELS: Record<NodeKey, string> = {
  DVS_Barmer: "District Vaccine Store",
  CHC_Balotra: "Community Health Centre",
  PHC_Sindhari: "Primary Health Centre",
};

export const ROAD_KEYS = [
  "DVS_Barmer_to_CHC_Balotra",
  "CHC_Balotra_to_PHC_Sindhari",
  "DVS_Barmer_to_PHC_Sindhari",
] as const;
export type RoadKey = (typeof ROAD_KEYS)[number];

export type RoadStatus = "open" | "closed";

export interface RoadEdge {
  key: RoadKey;
  from: NodeKey;
  to: NodeKey;
}

export const ROADS: RoadEdge[] = [
  { key: "DVS_Barmer_to_CHC_Balotra", from: "DVS_Barmer", to: "CHC_Balotra" },
  {
    key: "CHC_Balotra_to_PHC_Sindhari",
    from: "CHC_Balotra",
    to: "PHC_Sindhari",
  },
  { key: "DVS_Barmer_to_PHC_Sindhari", from: "DVS_Barmer", to: "PHC_Sindhari" },
];

// ─── Actions ──────────────────────────────────────────────────────────────

export type ActionType =
  | "check_temperature"
  | "check_truck_status"
  | "no_op"
  | "request_fuel"
  | "request_emergency"
  | "schedule_outreach";

export interface VaccineAction {
  action_type: ActionType;
  source_node?: NodeKey | null;
  target_node?: NodeKey | null;
  node?: NodeKey | null;
  vial_count?: number | null;
}

// ─── Per-node state ───────────────────────────────────────────────────────

export interface NodeStateV2 {
  /** Vials currently held. */
  vials: number;
  /** What the agent sees on the temperature gauge. May be a lie. */
  sensor_reading: number;
  /** Ground truth — judges only. */
  actual_temperature: number;
  /** Convenience flag computed by backend: |sensor − actual| > 1°C. */
  sensor_lying: boolean;
  /** Generator power state. */
  generator_on: boolean;
  /** 0.0–1.0, ALWAYS truthful. */
  generator_fuel_pct: number;
  /** True when sensor_reading > 8.0°C. */
  temperature_alarm: boolean;
  /** Optional UI hint: hours until soonest batch expires (999 = never). */
  hours_until_expiry?: number;
}

// ─── Events / outreach / reward ───────────────────────────────────────────

export type EventType =
  | "flood"
  | "generator"
  | "outreach"
  | "spoilage"
  | "transfer"
  | "truck"
  | "sensor_lie"
  | "ethical_tension"
  | "info";

export interface EventV2 {
  hour: number;
  type: EventType;
  text: string;
  /** Optional: which nodes this event concerns. */
  nodes?: NodeKey[];
  /** Optional: which road this event concerns. */
  road?: RoadKey;
}

export interface OutreachScheduleEntry {
  hour: number;
  node: NodeKey;
  vials_needed: number;
  /** Optional human label, e.g. "180 children — first dose". */
  cohort?: string;
  /** Whether the session has already fired. */
  fired?: boolean;
  /** Vials actually delivered when fired. */
  delivered?: number;
}

export interface RewardBreakdown {
  coverage: number;
  waste: number;
  missed_sessions: number;
  /** Computed terminal reward, max(0, coverage − 0.3·waste − 0.5·missed). */
  total?: number;
}

// ─── /state response ──────────────────────────────────────────────────────

export type BriefingSource = "auto" | "user";

export interface VaccineStateV2 {
  hour: number;
  max_hours: number;
  difficulty: Task;
  briefing: string;
  briefing_source?: BriefingSource;
  done: boolean;
  nodes: Record<NodeKey, NodeStateV2>;
  roads: Partial<Record<RoadKey, RoadStatus>>;
  outreach_schedule: OutreachScheduleEntry[];
  last_action: string | null;
  last_reasoning: string | null;
  events: EventV2[];
  reward_breakdown: RewardBreakdown;
  /** Hard mode only: an ethical-tension flag exposed for the UI to dramatise. */
  ethical_tension_active?: boolean;
  /** Truck arrival window, present only on hard. */
  truck_eta_known?: boolean;
  truck_arriving_in_hours?: number | null;
}

// ─── /reset + /step request/response wrappers ─────────────────────────────

export interface ResetRequest {
  difficulty: Task;
  user_briefing?: string | null;
}

export interface ResetResponse {
  observation: VaccineStateV2;
  briefing: string;
  briefing_source: BriefingSource;
  difficulty: Task;
  info?: string;
}

export interface StepRequest {
  action: VaccineAction;
  reasoning?: string | null;
}

export interface StepResponse {
  observation: VaccineStateV2;
  reward: number;
  done: boolean;
  info?: Record<string, unknown>;
}

// ─── Helpers / constants ──────────────────────────────────────────────────

export const MAX_HOURS: Record<Task, number> = {
  easy: 48,
  medium: 48,
  hard: 72,
};

export const TEMP_SAFE_MIN = 2;
export const TEMP_SAFE_MAX = 8;
export const TEMP_DANGER = 10;

export function tempColor(celsius: number): string {
  if (celsius <= TEMP_SAFE_MAX) return "var(--good-green)";
  if (celsius <= TEMP_DANGER) return "var(--warn-amber)";
  return "var(--danger-red)";
}

export function roadKeyBetween(a: NodeKey, b: NodeKey): RoadKey | null {
  for (const r of ROADS) {
    if ((r.from === a && r.to === b) || (r.from === b && r.to === a)) {
      return r.key;
    }
  }
  return null;
}
