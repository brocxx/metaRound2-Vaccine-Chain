"use client";

/**
 * Full-width strip below the TopBar. Renders the current episode's
 * district briefing with a teletype effect on episode start. Header has
 * an "auto-generated" / "user-supplied" tag and a faux timestamp. Border
 * runs a subtle scanline so the panel never feels static.
 */

import { memo, useState } from "react";

import { Typewriter } from "@/components/common/Typewriter";
import type { BriefingSource, Task } from "@/lib/types";

interface BriefingPanelProps {
  briefing: string;
  briefingSource: BriefingSource;
  task: Task;
  /** Used as the typewriter reset key; pass the episode id so scrubbing
   *  inside the same episode doesn't replay the type animation. */
  episodeKey: string | number;
  /** When true (e.g. on /replay), skip the typewriter. */
  instant?: boolean;
}

const SOURCE_COPY: Record<BriefingSource, { tag: string; chip: string }> = {
  auto: {
    tag: "auto-generated · seeded scenario",
    chip: "AUTO",
  },
  user: {
    tag: "submitted by operator",
    chip: "CUSTOM",
  },
};

export const BriefingPanel = memo(function BriefingPanel({
  briefing,
  briefingSource,
  task,
  episodeKey,
  instant = false,
}: BriefingPanelProps) {
  const [done, setDone] = useState(instant);
  const meta = SOURCE_COPY[briefingSource];

  return (
    <section className="panel relative overflow-hidden p-6">
      {/* Animated scanline (CSS so React re-renders never restart it) */}
      <span
        aria-hidden
        className="briefing-scanline pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--cold-cyan) 50%, transparent)",
          opacity: 0.55,
        }}
      />

      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--line)] pb-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            // District briefing
          </span>
          <h2 className="text-base font-medium tracking-tight text-[var(--ink-primary)] md:text-lg">
            Barmer District Health Officer
          </h2>
          <span
            className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] ${
              briefingSource === "user"
                ? "border-[var(--signal-violet)] text-[var(--signal-violet)]"
                : "border-[var(--cold-cyan)] text-[var(--cold-cyan)]"
            }`}
          >
            {meta.chip}
          </span>
        </div>

        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
          <span>{meta.tag}</span>
          <span className="text-[var(--ink-faint)]">·</span>
          <span>scenario · {task}</span>
          <span className="text-[var(--ink-faint)]">·</span>
          <span>h+0 brief</span>
        </div>
      </header>

      <div className="relative mt-4">
        <Typewriter
          text={briefing}
          resetKey={`${episodeKey}-${briefingSource}`}
          instant={instant}
          speedMs={9}
          onDone={() => setDone(true)}
        >
          {(visible, isDone) => (
            <p className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-[var(--ink-secondary)] md:text-sm">
              {visible}
              {!isDone ? (
                <span
                  className="cursor-blink ml-1 inline-block h-4 w-2 align-text-bottom"
                  style={{ background: "var(--cold-cyan)" }}
                />
              ) : null}
            </p>
          )}
        </Typewriter>
      </div>

      <footer className="mt-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--good-green)] hum"
        />
        <span>
          {done
            ? "agent has read the brief — first decision pending"
            : "transmitting brief to agent…"}
        </span>
      </footer>
    </section>
  );
});
