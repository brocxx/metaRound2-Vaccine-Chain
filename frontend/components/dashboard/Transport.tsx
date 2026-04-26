"use client";

/**
 * Bottom transport bar — task selector, play/pause/restart, speed.
 * Pure controlled component; the parent drives state via useEpisode.
 */

import { cn } from "@/lib/cn";
import type { Task } from "@/lib/types";

interface TransportProps {
  task: Task;
  setTask: (t: Task) => void;
  playing: boolean;
  togglePlay: () => void;
  restart: () => void;
  speed: number;
  setSpeed: (n: number) => void;
}

const TASKS: { id: Task; label: string; tag: string }[] = [
  { id: "easy", label: "EASY", tag: "warmup" },
  { id: "medium", label: "MEDIUM", tag: "generator + flood" },
  { id: "hard", label: "HARD", tag: "lie + flood + truck" },
];

const SPEEDS = [1, 2, 4, 8] as const;

export function Transport({
  task,
  setTask,
  playing,
  togglePlay,
  restart,
  speed,
  setSpeed,
}: TransportProps) {
  return (
    <div className="panel flex flex-wrap items-center justify-between gap-4 p-3 px-4">
      <div className="flex items-center gap-1 rounded-full bg-[var(--bg-elev)] p-1">
        {TASKS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTask(t.id)}
            className={cn(
              "rounded-full px-3 py-1.5 font-mono text-xs uppercase tracking-[0.15em] transition-colors",
              task === t.id
                ? "bg-[var(--cold-cyan)] text-[var(--bg-base)]"
                : "text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
            )}
            title={t.tag}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={restart}
          className="rounded-md border border-[var(--line-strong)] px-3 py-1.5 font-mono text-xs text-[var(--ink-secondary)] transition-colors hover:border-[var(--cold-cyan)] hover:text-[var(--cold-cyan)]"
          aria-label="Restart"
        >
          ⟲ restart
        </button>
        <button
          onClick={togglePlay}
          className={cn(
            "rounded-md px-4 py-1.5 font-mono text-xs uppercase tracking-[0.2em] transition-opacity hover:opacity-90",
            playing
              ? "bg-[var(--ink-primary)] text-[var(--bg-base)]"
              : "bg-[var(--cold-cyan)] text-[var(--bg-base)]"
          )}
          style={!playing ? { boxShadow: "var(--glow-cyan)" } : undefined}
        >
          {playing ? "❚❚ pause" : "▶ play"}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
          Speed
        </span>
        <div className="flex items-center gap-1 rounded-md border border-[var(--line-strong)] p-0.5">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={cn(
                "rounded px-2 py-1 font-mono text-[10px] transition-colors",
                speed === s
                  ? "bg-[var(--ink-primary)] text-[var(--bg-base)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
              )}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
