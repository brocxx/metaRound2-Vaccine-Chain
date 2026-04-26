"use client";

/**
 * Replaces the V1 ScorePanel with a V2-shaped reward readout.
 *
 *   total = max(0, coverage − 0.3·waste − 0.5·missed_sessions)
 *
 * Coverage and waste are 0–1, missed_sessions is an integer count. We render
 * each as an animated bar with a number that counts up smoothly.
 */

import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { memo, useEffect } from "react";

import type { RewardBreakdown as RewardBreakdownType } from "@/lib/types";

interface RewardBreakdownProps {
  reward: RewardBreakdownType;
  done: boolean;
}

function AnimatedNumber({
  value,
  digits = 2,
  className,
}: {
  value: number;
  digits?: number;
  className?: string;
}) {
  const mv = useMotionValue(0);
  const display = useTransform(mv, (v) => v.toFixed(digits));
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.6, ease: "easeOut" });
    return controls.stop;
  }, [value, mv]);
  return <motion.span className={className}>{display}</motion.span>;
}

function Bar({
  label,
  value,
  color,
  format,
  hint,
}: {
  label: string;
  value: number;
  color: string;
  format: (n: number) => React.ReactNode;
  hint?: string;
}) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
        <span>{label}</span>
        <span className="text-[var(--ink-secondary)]">{format(value)}</span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
        <motion.div
          className="absolute inset-y-0 left-0"
          style={{ background: color, boxShadow: `0 0 12px ${color}55` }}
          initial={false}
          animate={{ width: `${pct * 100}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
      {hint ? (
        <p className="font-mono text-[10px] text-[var(--ink-faint)]">{hint}</p>
      ) : null}
    </div>
  );
}

export const RewardBreakdown = memo(function RewardBreakdown({ reward, done }: RewardBreakdownProps) {
  const total = reward.total ?? 0;

  return (
    <section className="panel flex h-full flex-col p-5">
      <header className="flex items-baseline justify-between border-b border-[var(--line)] pb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
          // Reward
        </span>
        <span
          className="font-mono text-[10px] uppercase tracking-[0.2em]"
          style={{
            color: done ? "var(--good-green)" : "var(--ink-muted)",
          }}
        >
          {done ? "episode complete" : "running"}
        </span>
      </header>

      <div className="mt-4 flex items-baseline gap-3">
        <AnimatedNumber
          value={total}
          digits={3}
          className="font-mono text-5xl tabular-nums text-[var(--ink-primary)]"
        />
        <span className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--ink-muted)]">
          terminal reward
        </span>
      </div>
      <p className="mt-1 font-mono text-[10px] text-[var(--ink-faint)]">
        max(0, coverage − 0.3·waste − 0.5·missed)
      </p>

      <div className="mt-6 flex flex-1 flex-col gap-5">
        <Bar
          label="Coverage"
          value={reward.coverage}
          color="var(--good-green)"
          format={(n) => `${(n * 100).toFixed(0)}%`}
          hint="vials delivered ÷ vials needed"
        />
        <Bar
          label="Waste"
          value={reward.waste}
          color="var(--warn-amber)"
          format={(n) => `${(n * 100).toFixed(0)}%`}
          hint="spoiled vials ÷ vials needed"
        />
        <Bar
          label="Missed sessions"
          value={Math.min(1, reward.missed_sessions)}
          color="var(--danger-red)"
          format={(n) => Math.round(n).toString()}
          hint="outreach windows fully missed"
        />
      </div>
    </section>
  );
});
