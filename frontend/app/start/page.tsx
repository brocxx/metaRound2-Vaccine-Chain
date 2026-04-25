"use client";

/**
 * Pre-episode session-start screen.
 *
 *   1. Pick difficulty (easy / medium / hard)
 *   2. Pick briefing mode (auto-generated / custom)
 *   3. If custom: write the briefing yourself
 *   4. Begin → save config → /dashboard
 *
 * Once Phase 8 lands, "Begin" will additionally hit POST /reset with
 * { difficulty, user_briefing? } before navigating.
 */

import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { TopBar } from "@/components/chrome/TopBar";
import { cn } from "@/lib/cn";
import { saveEpisodeConfig } from "@/lib/episodeConfig";
import { AUTO_BRIEFINGS } from "@/lib/mockEpisode";
import type { BriefingSource, Task } from "@/lib/types";

const TASK_OPTIONS: {
  id: Task;
  title: string;
  hours: number;
  blurb: string;
  highlight: string;
}[] = [
  {
    id: "easy",
    title: "Easy",
    hours: 48,
    blurb:
      "Post-monsoon. All roads passable, all generators serviced, sensors calibrated.",
    highlight: "warmup",
  },
  {
    id: "medium",
    title: "Medium",
    hours: 48,
    blurb:
      "Pre-monsoon. One bridge floods soon. One generator overdue. Briefing flags both.",
    highlight: "generator + flood risk",
  },
  {
    id: "hard",
    title: "Hard",
    hours: 72,
    blurb:
      "Peak monsoon. A sensor lies. A road floods. A truck arrival window is unknown. Two simultaneous outreaches. The briefing is the only edge.",
    highlight: "the demo scenario",
  },
];

export default function StartPage() {
  const router = useRouter();
  const [task, setTask] = useState<Task>("hard");
  const [briefingSource, setBriefingSource] = useState<BriefingSource>("auto");
  const [customBriefing, setCustomBriefing] = useState<string>("");

  const placeholder =
    "There's a political rally blocking NH-15 between hours 10 and 22. Plan transfers around it. The CHC Balotra fridge made an unusual hum during the morning round — flag any temperature drift early.";

  function begin() {
    saveEpisodeConfig({
      task,
      briefingSource,
      customBriefing:
        briefingSource === "user" && customBriefing.trim().length > 0
          ? customBriefing.trim()
          : undefined,
    });
    router.push("/dashboard");
  }

  return (
    <>
      <TopBar />
      <main className="relative flex-1">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-10 px-6 py-12 md:px-12 md:py-16">
          {/* Header */}
          <header className="flex flex-col gap-3 border-b border-[var(--line)] pb-8">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
              // Configure episode
            </span>
            <h1 className="text-4xl font-medium leading-tight tracking-tight md:text-6xl">
              Choose the scenario.
              <br />
              <span className="text-[var(--ink-muted)]">
                Then write the agent its briefing.
              </span>
            </h1>
            <p className="max-w-2xl pt-2 font-mono text-xs text-[var(--ink-secondary)] md:text-sm">
              The whole point of V2 is that an LLM agent reads a district
              briefing and uses it to disambiguate noisy sensors. Pick a
              difficulty, pick whether the seeded scenario writes the
              briefing — or write your own.
            </p>
          </header>

          {/* 1. Difficulty */}
          <section className="space-y-4">
            <h2 className="flex items-baseline gap-3 text-sm font-medium uppercase tracking-[0.25em] text-[var(--ink-secondary)]">
              <span className="font-mono text-[var(--cold-cyan)]">01 /</span>
              Difficulty
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {TASK_OPTIONS.map((opt) => {
                const selected = task === opt.id;
                return (
                  <motion.button
                    key={opt.id}
                    onClick={() => setTask(opt.id)}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      "panel group relative overflow-hidden p-5 text-left transition-colors",
                      selected
                        ? "border-[var(--cold-cyan)]"
                        : "hover:border-[var(--line-strong)]"
                    )}
                    style={
                      selected
                        ? {
                            boxShadow:
                              "var(--glow-cyan), inset 0 0 0 1px var(--cold-cyan)",
                          }
                        : undefined
                    }
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                        {opt.highlight}
                      </span>
                      <span className="font-mono text-xs text-[var(--ink-muted)]">
                        {opt.hours}h
                      </span>
                    </div>
                    <h3
                      className={cn(
                        "mt-3 text-2xl font-medium tracking-tight",
                        selected
                          ? "text-[var(--cold-cyan)]"
                          : "text-[var(--ink-primary)]"
                      )}
                    >
                      {opt.title}
                    </h3>
                    <p className="mt-2 font-mono text-xs leading-relaxed text-[var(--ink-secondary)]">
                      {opt.blurb}
                    </p>
                  </motion.button>
                );
              })}
            </div>
          </section>

          {/* 2. Briefing mode */}
          <section className="space-y-4">
            <h2 className="flex items-baseline gap-3 text-sm font-medium uppercase tracking-[0.25em] text-[var(--ink-secondary)]">
              <span className="font-mono text-[var(--cold-cyan)]">02 /</span>
              Briefing
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <BriefingChoice
                selected={briefingSource === "auto"}
                onClick={() => setBriefingSource("auto")}
                title="Auto-generated"
                tag="default · seeded scenario"
                blurb="The backend (or the demo mock) writes a Barmer-flavoured briefing matching the difficulty you picked."
              />
              <BriefingChoice
                selected={briefingSource === "user"}
                onClick={() => setBriefingSource("user")}
                title="Custom"
                tag="you write it"
                blurb="Hand-author the briefing — useful for stress-testing, adversarial scripts, or judge demos."
              />
            </div>

            {briefingSource === "user" ? (
              <div className="panel mt-3 p-5">
                <div className="mb-3 flex items-baseline justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                    // Your briefing to the agent
                  </span>
                  <span className="font-mono text-[10px] text-[var(--ink-muted)]">
                    {customBriefing.length} chars
                  </span>
                </div>
                <textarea
                  value={customBriefing}
                  onChange={(e) => setCustomBriefing(e.target.value)}
                  placeholder={placeholder}
                  rows={6}
                  className="w-full resize-y rounded-md border border-[var(--line-strong)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[12.5px] leading-relaxed text-[var(--ink-primary)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--cold-cyan)]"
                />
                <button
                  type="button"
                  onClick={() => setCustomBriefing(AUTO_BRIEFINGS[task])}
                  className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)] underline-offset-2 hover:text-[var(--cold-cyan)] hover:underline"
                >
                  ⤺ load the seeded {task} briefing
                </button>
              </div>
            ) : (
              <div className="panel mt-3 p-5">
                <div className="flex items-baseline justify-between border-b border-[var(--line)] pb-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                    // Preview · seeded {task} briefing
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--cold-cyan)]">
                    AUTO
                  </span>
                </div>
                <p className="mt-3 font-mono text-[12.5px] leading-relaxed text-[var(--ink-secondary)]">
                  {AUTO_BRIEFINGS[task]}
                </p>
              </div>
            )}
          </section>

          {/* 3. Begin */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] pt-6">
            <Link
              href="/"
              className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
            >
              ← back
            </Link>
            <button
              onClick={begin}
              className="group inline-flex items-center gap-3 rounded-full bg-[var(--cold-cyan)] px-7 py-3.5 text-sm font-medium text-[var(--bg-base)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
              style={{ boxShadow: "var(--glow-cyan)" }}
            >
              <span>Begin episode</span>
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                className="transition-transform group-hover:translate-x-1"
              >
                <path
                  d="M4 10h12m0 0l-5-5m5 5l-5 5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="square"
                />
              </svg>
            </button>
          </div>
        </div>
      </main>
    </>
  );
}

function BriefingChoice({
  selected,
  onClick,
  title,
  tag,
  blurb,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  tag: string;
  blurb: string;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.985 }}
      className={cn(
        "panel relative overflow-hidden p-5 text-left transition-colors",
        selected
          ? "border-[var(--signal-violet)]"
          : "hover:border-[var(--line-strong)]"
      )}
      style={
        selected
          ? { boxShadow: "0 0 24px rgba(178,134,255,0.35)" }
          : undefined
      }
    >
      <div className="flex items-baseline justify-between">
        <h3
          className={cn(
            "text-xl font-medium tracking-tight",
            selected
              ? "text-[var(--signal-violet)]"
              : "text-[var(--ink-primary)]"
          )}
        >
          {title}
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
          {tag}
        </span>
      </div>
      <p className="mt-2 font-mono text-xs leading-relaxed text-[var(--ink-secondary)]">
        {blurb}
      </p>
    </motion.button>
  );
}
