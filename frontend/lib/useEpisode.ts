"use client";

/**
 * Drives episode playback over the mock V2 traces.
 *
 * Exposes:
 *   - observation (current /state)
 *   - briefing
 *   - lastAction / lastReasoning
 *   - events (sliding tail of typed events)
 *   - rewardBreakdown
 *   - playback controls (play/pause/seek/restart, speed)
 *
 * In Phase 8 we'll add a `dataSource: 'mock' | 'live'` flag and start
 * polling /state instead of walking a baked trace.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AUTO_BRIEFINGS, getMockTrace } from "./mockEpisode";
import type {
  BriefingSource,
  EventV2,
  RewardBreakdown,
  Task,
  VaccineStateV2,
} from "./types";

interface UseEpisodeOptions {
  /** When set, overrides the trace's briefing text (e.g. a custom one
   *  authored on /start). Use briefingSourceOverride alongside. */
  briefingOverride?: string;
  briefingSourceOverride?: BriefingSource;
}

interface UseEpisodeReturn {
  task: Task;
  setTask: (task: Task) => void;

  trace: VaccineStateV2[];
  observation: VaccineStateV2;
  briefing: string;
  briefingSource: "auto" | "user";
  lastAction: string | null;
  lastReasoning: string | null;
  events: EventV2[];
  reward: RewardBreakdown;

  hour: number;
  setHour: (hour: number) => void;

  playing: boolean;
  setPlaying: (b: boolean) => void;
  togglePlay: () => void;
  restart: () => void;

  speed: number;
  setSpeed: (s: number) => void;
}

const SPEED_TICK_MS: Record<number, number> = {
  1: 600,
  2: 300,
  4: 150,
  8: 75,
};

export function useEpisode(
  initialTask: Task = "hard",
  opts: UseEpisodeOptions = {}
): UseEpisodeReturn {
  const [task, setTaskState] = useState<Task>(initialTask);
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(2);

  const trace = useMemo(() => getMockTrace(task), [task]);
  const observation = trace[Math.min(hour, trace.length - 1)];

  // Sync to externally-changed initialTask (e.g. dashboard reads sessionStorage on mount).
  useEffect(() => {
    setTaskState(initialTask);
  }, [initialTask]);

  // Keep playhead in bounds when task changes.
  useEffect(() => {
    setHour((h) => Math.min(h, trace.length - 1));
  }, [trace.length]);

  // Auto-pause at the end.
  useEffect(() => {
    if (hour >= trace.length - 1 && playing) setPlaying(false);
  }, [hour, trace.length, playing]);

  // Tick.
  const tickRef = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) {
      if (tickRef.current) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    const ms = SPEED_TICK_MS[speed] ?? 300;
    tickRef.current = window.setInterval(() => {
      setHour((h) => Math.min(h + 1, trace.length - 1));
    }, ms);
    return () => {
      if (tickRef.current) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [playing, speed, trace.length]);

  const setTask = useCallback((t: Task) => {
    setTaskState(t);
    setHour(0);
    setPlaying(false);
  }, []);

  const togglePlay = useCallback(() => setPlaying((p) => !p), []);

  const restart = useCallback(() => {
    setHour(0);
    setPlaying(true);
  }, []);

  return {
    task,
    setTask,

    trace,
    observation,
    briefing:
      opts.briefingOverride ?? observation?.briefing ?? AUTO_BRIEFINGS[task],
    briefingSource:
      opts.briefingSourceOverride ?? observation?.briefing_source ?? "auto",
    lastAction: observation?.last_action ?? null,
    lastReasoning: observation?.last_reasoning ?? null,
    events: observation?.events ?? [],
    reward: observation?.reward_breakdown ?? {
      coverage: 0,
      waste: 0,
      missed_sessions: 0,
      total: 0,
    },

    hour,
    setHour,

    playing,
    setPlaying,
    togglePlay,
    restart,

    speed,
    setSpeed,
  };
}
