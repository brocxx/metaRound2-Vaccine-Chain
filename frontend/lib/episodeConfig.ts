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

/** Hook variant: returns null on first SSR paint, then hydrates. */
export function useEpisodeConfig(): EpisodeConfig | null {
  const [cfg, setCfg] = useState<EpisodeConfig | null>(null);
  useEffect(() => {
    setCfg(loadEpisodeConfig());
  }, []);
  return cfg;
}
