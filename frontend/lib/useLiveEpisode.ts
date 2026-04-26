"use client";

/**
 * Live-backend variant of useEpisode.
 *
 * Flow:
 *   1. POST /reset on mount with the chosen task + optional briefing.
 *   2. Adapt the slim Observation into a placeholder VaccineStateV2.
 *   3. Poll GET /state every POLL_INTERVAL_MS until done; each tick
 *      re-runs the adapter but only calls setObservation() when values
 *      have actually changed (avoids re-render storms).
 *   4. Optional autopilot: sends a no_op /step every AUTOPILOT_INTERVAL_MS.
 *      The poll timer is temporarily paused while a step is in flight so
 *      the two loops never collide, preventing the 1.5s flicker.
 *   5. `step()` is exposed for one-off manual actions.
 *
 * Returns the same VaccineStateV2 the mock adapter returns, so dashboard
 * rendering code is identical.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { adaptBackendState, adaptResetObservation } from "./adapters";
import { api } from "./api";
import type { BackendAction } from "./backendTypes";
import type { BriefingSource, Task, VaccineStateV2 } from "./types";

const POLL_INTERVAL_MS = 3000;
// Autopilot ticks once every AUTOPILOT_INTERVAL_MS. 1.5s is fast enough
// that a 72-hour episode finishes in ~108s (good for live demos) but
// slow enough that a human can read the event log between ticks.
const AUTOPILOT_INTERVAL_MS = 1500;

/** How long to wait after a step before polling (backend needs a tick to update) */
const POST_STEP_DELAY_MS = 350;

interface UseLiveEpisodeArgs {
  task: Task;
  customBriefing?: string;
  briefingSourceOverride?: BriefingSource;
  enabled: boolean;
  autopilot?: boolean;
  seed?: number;
}

interface UseLiveEpisodeReturn {
  ready: boolean;
  error: string | null;
  observation: VaccineStateV2 | null;
  lastReward: number | null;
  step: (action: BackendAction, reasoning?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Cheap fingerprint to detect meaningful state changes.
 * Avoids full deep-equal; covers the fields that drive visible updates.
 */
function stateFingerprint(s: VaccineStateV2): string {
  const ns = Object.entries(s.nodes)
    .map(
      ([k, n]) =>
        `${k}:${n.sensor_reading}:${n.actual_temperature}:${n.sensor_lying}:${n.generator_fuel_pct.toFixed(3)}:${n.vials}:${n.temperature_alarm}`
    )
    .join("|");
  return `h${s.hour}|done${s.done}|cov${s.reward_breakdown.coverage.toFixed(4)}|wa${s.reward_breakdown.waste.toFixed(4)}|ms${s.reward_breakdown.missed_sessions}|la${s.last_action ?? ""}|${ns}|ev${s.events.length}`;
}

export function useLiveEpisode({
  task,
  customBriefing,
  briefingSourceOverride,
  enabled,
  autopilot = false,
  seed,
}: UseLiveEpisodeArgs): UseLiveEpisodeReturn {
  const [observation, setObservation] = useState<VaccineStateV2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [lastReward, setLastReward] = useState<number | null>(null);

  const stepInFlightRef = useRef(false);            // pause poll while stepping
  const lastFingerprintRef = useRef<string>("");
  const briefingSourceRef = useRef<BriefingSource>(
    briefingSourceOverride ?? (customBriefing ? "user" : "auto")
  );
  const maxHoursRef = useRef<number>(72);

  // ── /reset on (re)mount ─────────────────────────────────────────────
  // We use a per-effect `cancelled` closure (not a shared ref) so a late
  // reply from a stale `/reset` cannot resurrect itself once a newer
  // reset has started. The previous shared-ref approach would briefly
  // flip back to `false` when the next effect ran, letting the old
  // response win the race.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    stepInFlightRef.current = false;
    lastFingerprintRef.current = "";
    setReady(false);
    setError(null);

    (async () => {
      try {
        await api.health();
        const obs = await api.reset({
          difficulty: task,
          district: "barmer",
          user_briefing: customBriefing ?? null,
          seed: seed ?? null,
        });
        if (cancelled) return;
        const source: BriefingSource =
          briefingSourceOverride ?? (customBriefing ? "user" : "auto");
        briefingSourceRef.current = source;
        maxHoursRef.current =
          obs.current_hour + (obs.time_remaining_hours ?? 0) || 72;
        const adapted = adaptResetObservation(obs, task, {
          briefingSource: source,
          maxHours: maxHoursRef.current,
        });
        lastFingerprintRef.current = stateFingerprint(adapted);
        setObservation(adapted);
        setReady(true);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? `backend unreachable: ${e.message}`
              : "backend unreachable"
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, task, customBriefing, seed, briefingSourceOverride]);

  // ── /state polling ──────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (stepInFlightRef.current) return;     // don't collide with step
    try {
      const s = await api.state();
      const adapted = adaptBackendState(s, {
        briefingSource: briefingSourceRef.current,
        maxHours: maxHoursRef.current,
      });
      // Only re-render when something meaningful changed.
      const fp = stateFingerprint(adapted);
      if (fp === lastFingerprintRef.current) return;
      lastFingerprintRef.current = fp;
      setObservation(adapted);
    } catch (e) {
      setError(e instanceof Error ? e.message : "state fetch failed");
    }
  }, []);

  useEffect(() => {
    if (!enabled || !ready) return;
    if (observation?.done) return;
    // When autopilot is on, step() already polls after every tick — running a
    // second poll loop would just double the re-render rate and cause the
    // dashboard to "blink". Skip it.
    if (autopilot) return;
    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled, ready, observation?.done, refresh, autopilot]);

  // ── manual / autopilot step ─────────────────────────────────────────
  const step = useCallback(
    async (action: BackendAction, reasoning?: string) => {
      stepInFlightRef.current = true;
      try {
        const r = await api.step({ action, reasoning });
        setLastReward(r.reward);
        // Give backend a moment to commit before we poll
        await new Promise((res) => setTimeout(res, POST_STEP_DELAY_MS));
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "step failed");
      } finally {
        stepInFlightRef.current = false;
      }
    },
    [refresh]
  );

  // ── autopilot loop ──────────────────────────────────────────────────
  // The interval reads `step` and `done` through refs so the effect
  // can depend ONLY on [enabled, ready, autopilot]. Previously we
  // listed `observation?.done` and `step` in the deps, which caused
  // the interval to be torn down and recreated on every state mutation
  // — its 1.5s clock kept restarting and the user saw "no ticks".
  const stepRef = useRef(step);
  const doneRef = useRef(false);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  useEffect(() => {
    doneRef.current = !!observation?.done;
  }, [observation?.done]);

  useEffect(() => {
    if (!enabled || !ready || !autopilot) return;
    const id = window.setInterval(() => {
      if (doneRef.current) return;
      if (stepInFlightRef.current) return;
      stepRef
        .current({ node: "DVS_Barmer", action_type: "no_op" }, "auto-tick")
        .catch(() => {});
    }, AUTOPILOT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled, ready, autopilot]);

  return { ready, error, observation, lastReward, step, refresh };
}
