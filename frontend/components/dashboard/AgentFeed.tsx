"use client";

/**
 * Right column of the dashboard. Three stacked subpanels:
 *
 *   1. LastAction      — chip + reward delta
 *   2. ReasoningStream — typewriter for the current `last_reasoning`,
 *                        with previous reasonings collapsed above
 *   3. EventLog        — last 5 typed events from /state.events
 *
 * Designed to feel like a live console — judges should scroll with their
 * eyes and watch the agent "think" in real time.
 */

import { AnimatePresence, motion } from "framer-motion";
import { memo, useEffect, useMemo, useRef } from "react";

import { Typewriter } from "@/components/common/Typewriter";
import { cn } from "@/lib/cn";
import type { EventType, EventV2, RewardBreakdown } from "@/lib/types";

interface AgentFeedProps {
  hour: number;
  lastAction: string | null;
  lastReasoning: string | null;
  events: EventV2[];
  reward: RewardBreakdown;
}

// ─── Action helpers ──────────────────────────────────────────────────────

function actionGlyph(action: string | null): { glyph: string; color: string } {
  if (!action) return { glyph: "—", color: "var(--ink-muted)" };
  if (action.startsWith("transfer"))
    return { glyph: "→", color: "var(--cold-cyan)" };
  if (action.startsWith("request_fuel"))
    return { glyph: "⛽", color: "var(--warn-amber)" };
  if (action.startsWith("cancel"))
    return { glyph: "✕", color: "var(--danger-red)" };
  if (action.startsWith("check_truck"))
    return { glyph: "🛻", color: "var(--cold-cyan)" };
  if (action.startsWith("do_nothing"))
    return { glyph: "○", color: "var(--ink-muted)" };
  return { glyph: "·", color: "var(--ink-secondary)" };
}

function eventChip(type: EventType): { color: string; bg: string; label: string } {
  switch (type) {
    case "flood":
      return {
        color: "var(--danger-red)",
        bg: "rgba(255,77,109,0.10)",
        label: "FLOOD",
      };
    case "generator":
      return {
        color: "var(--warn-amber)",
        bg: "rgba(255,181,71,0.10)",
        label: "GEN",
      };
    case "outreach":
      return {
        color: "var(--signal-violet)",
        bg: "rgba(178,134,255,0.12)",
        label: "OUTREACH",
      };
    case "spoilage":
      return {
        color: "var(--danger-red)",
        bg: "rgba(255,77,109,0.10)",
        label: "SPOIL",
      };
    case "transfer":
      return {
        color: "var(--cold-cyan)",
        bg: "rgba(108,217,255,0.10)",
        label: "TRANSFER",
      };
    case "truck":
      return {
        color: "var(--cold-cyan)",
        bg: "rgba(108,217,255,0.10)",
        label: "TRUCK",
      };
    case "sensor_lie":
      return {
        color: "var(--warn-amber)",
        bg: "rgba(255,181,71,0.12)",
        label: "SENSOR LIE",
      };
    case "ethical_tension":
      return {
        color: "var(--signal-violet)",
        bg: "rgba(178,134,255,0.10)",
        label: "ETHICS",
      };
    default:
      return {
        color: "var(--ink-muted)",
        bg: "rgba(255,255,255,0.04)",
        label: type.toUpperCase(),
      };
  }
}

// ─── Subpanel: LastAction ────────────────────────────────────────────────

function LastActionPanel({
  hour,
  action,
  rewardTotal,
}: {
  hour: number;
  action: string | null;
  rewardTotal: number;
}) {
  const { glyph, color } = actionGlyph(action);
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] p-4">
      <div className="flex items-baseline justify-between border-b border-[var(--line)] pb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
          // Last action
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
          h+{hour}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-md border text-lg font-medium"
          style={{
            color,
            borderColor: color,
            backgroundColor: "rgba(255,255,255,0.02)",
          }}
        >
          {glyph}
        </span>
        <AnimatePresence mode="popLayout">
          <motion.span
            key={action ?? "nil"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="font-mono text-sm tracking-tight text-[var(--ink-primary)]"
          >
            {action ?? "—"}
          </motion.span>
        </AnimatePresence>
        <span className="ml-auto font-mono text-xs tabular-nums text-[var(--ink-muted)]">
          score {(rewardTotal ?? 0).toFixed(2)}
        </span>
      </div>
    </div>
  );
}

// ─── Subpanel: ReasoningStream ───────────────────────────────────────────

function ReasoningStreamPanel({
  hour,
  reasoning,
}: {
  hour: number;
  reasoning: string | null;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] p-4">
      <div className="flex items-baseline justify-between border-b border-[var(--line)] pb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
          // Agent reasoning
        </span>
        {reasoning ? (
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--cold-cyan)]">
            <span className="hum inline-block h-1.5 w-1.5 rounded-full bg-[var(--cold-cyan)]" />
            thinking
          </span>
        ) : null}
      </div>
      <div className="mt-3 min-h-[6rem]">
        {reasoning ? (
          <Typewriter
            text={reasoning}
            resetKey={`${hour}-${reasoning}`}
            speedMs={11}
          >
            {(visible, done) => (
              <p className="font-mono text-[12.5px] leading-relaxed text-[var(--ink-primary)]">
                {visible}
                {!done ? (
                  <span
                    className="cursor-blink ml-1 inline-block h-3 w-1.5 align-text-bottom"
                    style={{ background: "var(--cold-cyan)" }}
                  />
                ) : null}
              </p>
            )}
          </Typewriter>
        ) : (
          <p className="font-mono text-xs italic text-[var(--ink-muted)]">
            agent idle — no reasoning emitted this hour
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Subpanel: EventLog ──────────────────────────────────────────────────

function EventLogPanel({ events }: { events: EventV2[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  // Keep scrolled to the latest entry.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [events]);
  const reversed = useMemo(() => [...events].reverse(), [events]);
  return (
    <div className="flex min-h-[12rem] flex-1 flex-col rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] p-4">
      <div className="flex items-baseline justify-between border-b border-[var(--line)] pb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
          // Event log
        </span>
        <span className="font-mono text-[10px] text-[var(--ink-muted)]">
          last 5
        </span>
      </div>
      <ol
        ref={listRef}
        className="mt-2 flex-1 space-y-1.5 overflow-y-auto pr-1"
      >
        <AnimatePresence initial={false}>
          {reversed.length === 0 ? (
            <li className="font-mono text-xs italic text-[var(--ink-muted)]">
              no events yet
            </li>
          ) : (
            reversed.map((ev) => {
              const { color, bg, label } = eventChip(ev.type);
              return (
                <motion.li
                  key={`${ev.hour}-${ev.type}-${ev.text}`}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="flex items-baseline gap-2 font-mono text-[12px] text-[var(--ink-secondary)]"
                >
                  <span className="w-9 shrink-0 text-[var(--ink-muted)] tabular-nums">
                    h+{String(ev.hour).padStart(2, "0")}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.15em]"
                    )}
                    style={{ color, backgroundColor: bg }}
                  >
                    {label}
                  </span>
                  <span>{ev.text}</span>
                </motion.li>
              );
            })
          )}
        </AnimatePresence>
      </ol>
    </div>
  );
}

// ─── Public AgentFeed ────────────────────────────────────────────────────

export const AgentFeed = memo(function AgentFeed({
  hour,
  lastAction,
  lastReasoning,
  events,
  reward,
}: AgentFeedProps) {
  return (
    <div className="panel flex h-full flex-col gap-3 p-4">
      <LastActionPanel
        hour={hour}
        action={lastAction}
        rewardTotal={reward.total ?? 0}
      />
      <ReasoningStreamPanel hour={hour} reasoning={lastReasoning} />
      <EventLogPanel events={events} />
    </div>
  );
});
