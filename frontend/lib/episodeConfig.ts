/**
 * sessionStorage-backed handoff between /start and /dashboard.
 *
 * /start writes the chosen difficulty + briefing mode (and optional custom
 * briefing text). /dashboard reads it on mount via useEpisodeConfig. We use
 * sessionStorage (not query params) because briefings can be long-form.
 */

import { useEffect, useState } from "react";

import type { BriefingSource, Task } from "./types";

const STORAGE_KEY = "vaccine.episodeConfig";

export interface EpisodeConfig {
  task: Task;
  briefingSource: BriefingSource;
  /** Only present when briefingSource === "user". */
  customBriefing?: string;
}

export function saveEpisodeConfig(cfg: EpisodeConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadEpisodeConfig(): EpisodeConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as EpisodeConfig;
  } catch {
    return null;
  }
}

export function clearEpisodeConfig(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Hook variant: returns the persisted config plus a `loaded` flag.
 *
 * Why the flag: on first render `cfg` is null because we can't read
 * sessionStorage during SSR. Without the flag the dashboard would
 * eagerly mount `useLiveEpisode` with the fallback task ("hard") and
 * then re-fire `/reset` a moment later when the real cfg arrived,
 * which raced two parallel resets and tore down the autopilot
 * interval before its first tick. Callers should wait for
 * `loaded === true` before kicking off any episode-bound effects.
 */
export function useEpisodeConfig(): {
  cfg: EpisodeConfig | null;
  loaded: boolean;
} {
  const [cfg, setCfg] = useState<EpisodeConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setCfg(loadEpisodeConfig());
    setLoaded(true);
  }, []);
  return { cfg, loaded };
}
