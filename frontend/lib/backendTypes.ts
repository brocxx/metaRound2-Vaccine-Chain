/**
 * Exact mirror of the FastAPI backend's response shapes
 * (server/environment.py + models.py in metaRound2-Vaccine-Chain).
 *
 * Kept separate from `lib/types.ts` (which is the frontend-facing shape)
 * so the adapter in `lib/adapters.ts` is the only place we have to touch
 * if Person 1 changes the schema.
 */

export type BackendNodeName = "DVS_Barmer" | "CHC_Balotra" | "PHC_Sindhari";

export type BackendActionType =
  | "check_temperature"
  | "check_truck_status"
  | "request_fuel"
  | "schedule_outreach"
  | "request_emergency"
  | "no_op";

export interface BackendAction {
  node: BackendNodeName | string;
  action_type: BackendActionType;
  quantity?: number | null;
  reasoning?: string | null;
}

export interface BackendNodeObservation {
  node_name: BackendNodeName;
  sensor_reading: number;
  /**
   * Present on `/state` (UI ground truth), omitted on `/reset` and `/step`
   * agent-facing observations by design.
   */
  actual_temperature?: number;
  sensor_lying?: boolean;
  generator_fuel_pct: number; // 0..100
  temperature_alarm: boolean;
  vials_at_node: number;
  vials_spoiled: number;
}

export interface BackendObservation {
  nodes: BackendNodeObservation[];
  time_remaining_hours: number;
  current_hour: number;
  briefing: string;
  truck_arrived: boolean;
  ethical_tension_active: boolean;
  last_event: string | null;
}

export interface BackendRubricScores {
  coverage?: number;
  temperature_maintenance?: number;
  proactive_info_seeking?: number;
  resource_efficiency?: number;
  total?: number;
}

export interface BackendState {
  nodes: BackendNodeObservation[];
  time_remaining_hours: number;
  current_hour: number;
  briefing: string;
  truck_arrived: boolean;
  ethical_tension_active: boolean;
  last_action: BackendAction | null;
  last_reasoning: string | null;
  events: string[];
  coverage: number;
  waste: number;
  missed_sessions: number;
  rubric_scores: BackendRubricScores;
  difficulty: string;
  done: boolean;
  total_vials_at_start: number;
  total_vials_delivered: number;
  total_population_target: number;
  population_reached: number;
  /**
   * Static OSM-derived geo data, sourced from `geo_config.json` at the repo
   * root and exposed via `/state`. Both fields are optional: when the file is
   * missing or malformed, the backend returns `{}` (or omits the keys on
   * older deploys). Front-end consumers must treat these as `?? {}`.
   */
  nodes_geo?: Record<string, { lat: number; lon: number; type: string }>;
  routes?: Record<
    string,
    { distance_km: number; eta_min: number; road_type: string }
  >;
}

export interface BackendStepResult {
  observation: BackendObservation;
  reward: number;
  done: boolean;
  info: Record<string, unknown>;
}

export interface BackendResetRequest {
  difficulty: string;
  district?: string;
  user_briefing?: string | null;
  seed?: number | null;
}

export interface BackendStepRequest {
  action: BackendAction;
  reasoning?: string | null;
}

export interface BackendHealth {
  status: string;
  service?: string;
  version?: string;
}
