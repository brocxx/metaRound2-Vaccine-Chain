"use client";

/**
 * Horizontal timeline + scrubber. Markers are derived from the V2
 * /state.events stream so the rail always reflects what actually happened
 * in this episode (rather than hard-coded difficulty hints).
 */

import { motion } from "framer-motion";
import { memo, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import {
  EventType,
  EventV2,
  Task,
  VaccineStateV2,
} from "@/lib/types";

interface Marker {
  hour: number;
  label: string;
  color: string;
}

interface HourTimelineProps {
  task: Task;
  hour: number;
  state: VaccineStateV2;
  /** Full trace, used to derive markers across the whole episode (not just last 5). */
  fullEvents?: EventV2[];
  onSeek: (hour: number) => void;
}

const EVENT_COLORS: Record<EventType, string> = {
  flood: "var(--danger-red)",
  generator: "var(--warn-amber)",
  outreach: "var(--signal-violet)",
  spoilage: "var(--danger-red)",
  transfer: "var(--cold-cyan)",
  truck: "var(--cold-cyan)",
  sensor_lie: "var(--warn-amber)",
  ethical_tension: "var(--signal-violet)",
  info: "var(--ink-muted)",
};

const EVENT_LABELS: Record<EventType, string> = {
  flood: "Flood",
  generator: "Gen",
  outreach: "Outreach",
  spoilage: "Spoil",
  transfer: "Transfer",
  truck: "Truck",
  sensor_lie: "Sensor lie",
  ethical_tension: "Ethics",
  info: "Info",
};

function dedupeMarkers(markers: Marker[]): Marker[] {
  const seen = new Set<string>();
  return markers.filter((m) => {
    const k = `${m.hour}-${m.label}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const HourTimeline = memo(function HourTimeline({
  task,
  hour,
  state,
  fullEvents,
  onSeek,
}: HourTimelineProps) {
  const max = state.max_hours;
  const events = fullEvents ?? state.events;

  const markers = useMemo<Marker[]>(() => {
    const out: Marker[] = events.map((e) => ({
      hour: e.hour,
      label: EVENT_LABELS[e.type],
      color: EVENT_COLORS[e.type],
    }));
    // Add scheduled outreaches that haven't fired yet
    state.outreach_schedule.forEach((o) => {
      if (!o.fired) {
        out.push({
          hour: o.hour,
          label: "Outreach",
          color: "var(--signal-violet)",
        });
      }
    });
    return dedupeMarkers(out);
  }, [events, state.outreach_schedule]);

  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverHour, setHoverHour] = useState<number | null>(null);

  function handleMove(clientX: number): number | undefined {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const h = Math.round((x / rect.width) * max);
    setHoverHour(h);
    return h;
  }

  return (
    <div className="panel flex flex-col gap-4 p-5">
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Hour
          </span>
          <span className="font-mono text-3xl font-medium tabular-nums text-[var(--ink-primary)]">
            {String(hour).padStart(2, "0")}
          </span>
          <span className="font-mono text-sm text-[var(--ink-muted)]">/ {max}</span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em]",
              task === "hard"
                ? "border-[var(--danger-red)] text-[var(--danger-red)]"
                : task === "medium"
                ? "border-[var(--warn-amber)] text-[var(--warn-amber)]"
                : "border-[var(--good-green)] text-[var(--good-green)]"
            )}
          >
            {task}
          </span>
        </div>
      </div>

      <div
        ref={trackRef}
        className="group relative h-16 w-full cursor-crosshair select-none"
        onMouseMove={(e) => handleMove(e.clientX)}
        onMouseLeave={() => setHoverHour(null)}
        onClick={(e) => {
          const h = handleMove(e.clientX);
          if (h != null) onSeek(h);
        }}
      >
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-[var(--line-strong)]" />

        {/* Hour ticks every 6h */}
        <div className="absolute inset-0">
          {Array.from({ length: Math.floor(max / 6) + 1 }, (_, i) => i * 6).map(
            (i) => (
              <div
                key={i}
                className="flex flex-col items-center gap-1"
                style={{
                  position: "absolute",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  left: `${(i / max) * 100}%`,
                }}
              >
                <div className="h-2 w-px bg-[var(--line-strong)]" />
                <span className="absolute top-3 font-mono text-[10px] text-[var(--ink-muted)]">
                  {i}h
                </span>
              </div>
            )
          )}
        </div>

        <motion.div
          className="absolute left-0 top-1/2 h-px -translate-y-1/2 bg-[var(--cold-cyan)]"
          initial={false}
          animate={{ width: `${(hour / max) * 100}%` }}
          transition={{ duration: 0.3 }}
          style={{ boxShadow: "var(--glow-cyan)" }}
        />

        {markers.map((m, i) => (
          <div
            key={`${m.label}-${m.hour}-${i}`}
            className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
            style={{ left: `${(m.hour / max) * 100}%` }}
          >
            <div
              className="h-2.5 w-2.5 rotate-45"
              style={{ background: m.color, boxShadow: `0 0 10px ${m.color}` }}
            />
            <span
              className="absolute top-5 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.15em]"
              style={{ color: m.color }}
            >
              {m.label}
            </span>
          </div>
        ))}

        <motion.div
          className="absolute top-0 bottom-0 w-0.5 bg-[var(--ink-primary)]"
          initial={false}
          animate={{ left: `${(hour / max) * 100}%` }}
          transition={{ duration: 0.3 }}
          style={{ transform: "translateX(-50%)" }}
        >
          <div className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-[var(--ink-primary)] bg-[var(--bg-base)]" />
        </motion.div>

        {hoverHour != null && hoverHour !== hour ? (
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--ink-muted)]"
            style={{
              left: `${(hoverHour / max) * 100}%`,
              transform: "translateX(-50%)",
            }}
          >
            <span className="absolute -top-5 left-1 font-mono text-[10px] text-[var(--ink-muted)]">
              {hoverHour}h
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
});
