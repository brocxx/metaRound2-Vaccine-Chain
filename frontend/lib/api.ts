/**
 * Thin HTTP client around the FastAPI backend
 * (server/app.py in metaRound2-Vaccine-Chain).
 *
 * Returns the BACKEND payload shapes verbatim — translation to the
 * frontend's `VaccineStateV2` happens in `lib/adapters.ts`. This keeps
 * the boundary explicit and easy to retune when Person 1 evolves the
 * schema.
 *
 * Base URL resolution:
 *   - In production (HF Space) the frontend is served from the same
 *     origin as FastAPI, so we default to "" (relative paths).
 *   - In local dev, set NEXT_PUBLIC_ENV_BASE_URL=http://localhost:7860
 *     in a .env.local so `npm run dev` (port 3000) can reach the
 *     uvicorn process (port 7860).
 */

import type {
  BackendAction,
  BackendHealth,
  BackendObservation,
  BackendResetRequest,
  BackendState,
  BackendStepRequest,
  BackendStepResult,
} from "./backendTypes";

const RAW_BASE = process.env.NEXT_PUBLIC_ENV_BASE_URL ?? "";
const BASE_URL = RAW_BASE.replace(/\/$/, "");

class ApiError extends Error {
  status: number;
  body?: string;
  constructor(message: string, status: number, body?: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { signal?: AbortSignal }
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    let body: string | undefined;
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    throw new ApiError(
      `${init?.method ?? "GET"} ${path} → ${res.status}`,
      res.status,
      body
    );
  }

  return (await res.json()) as T;
}

export const api = {
  baseUrl: BASE_URL,

  health(): Promise<BackendHealth> {
    return request<BackendHealth>("/health");
  },

  /**
   * Start a new episode. Returns the slim Observation; the full /state
   * (including events + rubric_scores) should be polled separately.
   */
  reset(body: BackendResetRequest): Promise<BackendObservation> {
    return request<BackendObservation>("/reset", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /**
   * Execute one action. Reasoning is folded into the Action object on
   * the backend; we keep the standard {action, reasoning} envelope so
   * the field is also surfaced for the rubric.
   */
  step(req: BackendStepRequest): Promise<BackendStepResult> {
    return request<BackendStepResult>("/step", {
      method: "POST",
      body: JSON.stringify(req),
    });
  },

  state(): Promise<BackendState> {
    return request<BackendState>("/state");
  },
};

export { ApiError };
export type { BackendAction };
