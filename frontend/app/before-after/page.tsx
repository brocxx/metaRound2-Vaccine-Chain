"use client";

/**
 * The marketing screenshot, made interactive.
 *
 * Two side-by-side prompt panels. Left: zero-shot baseline (no briefing) —
 * agent reads only the numbers, alarms on a sensor lie, burns a useless
 * request_fuel. Right: briefing-augmented agent — same prompt prefixed
 * with the district briefing, agent cross-checks fuel + briefing context,
 * holds. Each reasoning streams via the Typewriter when the section
 * enters the viewport.
 */

import { motion, useInView } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { TopBar } from "@/components/chrome/TopBar";
import { Typewriter } from "@/components/common/Typewriter";

const SHARED_OBSERVATION = `OBSERVATION (hour 6, hard mode):
  PHC_Sindhari
    sensor_reading: 9.4°C   (above 8.0 alarm threshold)
    generator_on: true
    generator_fuel_pct: 1.00
    vials: 140
    temperature_alarm: TRUE`;

const NO_BRIEFING_PROMPT = `${SHARED_OBSERVATION}

Pick one VaccineAction. Output your reasoning, then the action.`;

const WITH_BRIEFING_PROMPT = `BRIEFING (Barmer district, peak monsoon):
  "PHC Sindhari's temperature sensor was flagged for calibration drift in
   last quarter's eVIN audit — cross-check every alarm there against the
   generator fuel reading and power state before acting. A sensor spike
   with full fuel and the generator running is almost certainly a false
   alarm."

${SHARED_OBSERVATION}

Pick one VaccineAction. Output your reasoning, then the action.`;

const NO_BRIEFING_REASONING = `Sensor reading 9.4°C is above the 8.0°C cold-chain threshold. Vials at risk. Acting on the alarm: must intervene before more vials spoil. Best available intervention given the alarm is to call request_fuel on PHC_Sindhari to ensure the generator stays powered. Issuing request_fuel now.`;

const NO_BRIEFING_ACTION = `request_fuel(PHC_Sindhari)`;

const WITH_BRIEFING_REASONING = `Sensor reads 9.4°C — alarm tripped. But the briefing explicitly flagged this exact sensor for calibration drift in last quarter's eVIN audit, and instructed me to cross-check alarms against generator state. Generator is ON; fuel at 100%. Ambient is ~28°C, so a real cooling failure would have to push from 5°C past 8°C in one hour, which the generator output makes implausible. Conclusion: this is the false alarm the briefing predicted. Holding action.`;

const WITH_BRIEFING_ACTION = `do_nothing`;

export default function BeforeAfterPage() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, { once: true, amount: 0.25 });

  return (
    <>
      <TopBar />
      <main className="relative flex-1">
        <div className="mx-auto flex max-w-[1300px] flex-col gap-12 px-6 py-12 md:px-12 md:py-16">
          {/* Header */}
          <header className="flex flex-col gap-3 border-b border-[var(--line)] pb-8">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
              // The pitch · in 12 lines of reasoning
            </span>
            <h1 className="text-4xl font-medium leading-tight tracking-tight md:text-6xl">
              Same observation.
              <br />
              <span className="text-[var(--ink-muted)]">Two agents.</span>
              <br />
              <span className="text-[var(--cold-cyan)]">
                Only one keeps the vaccines alive.
              </span>
            </h1>
            <p className="max-w-3xl pt-2 font-mono text-xs text-[var(--ink-secondary)] md:text-sm">
              Hour 6 of a hard episode. PHC Sindhari&apos;s sensor reads
              9.4°C — above the cold-chain alarm. The fridge generator
              is on, fuel is full, and the briefing already warned that
              this exact sensor has a calibration drift. Watch what
              happens when the agent has the briefing — and when it
              doesn&apos;t.
            </p>
          </header>

          {/* Side-by-side */}
          <section
            ref={sectionRef}
            className="grid grid-cols-1 gap-6 lg:grid-cols-2"
          >
            <Card
              kind="bad"
              tag="ZERO-SHOT BASELINE"
              tagDetail="no briefing"
              prompt={NO_BRIEFING_PROMPT}
              reasoning={NO_BRIEFING_REASONING}
              action={NO_BRIEFING_ACTION}
              outcome="Wasted action. Vials never were at risk — the sensor lied. The agent burned a request_fuel slot it might need 30 hours from now when the truck still hasn't arrived."
              inView={inView}
              startDelayMs={400}
            />
            <Card
              kind="good"
              tag="BRIEFING-AUGMENTED"
              tagDetail="our agent"
              prompt={WITH_BRIEFING_PROMPT}
              reasoning={WITH_BRIEFING_REASONING}
              action={WITH_BRIEFING_ACTION}
              outcome="Correct hold. Sensor self-corrects to 5.1°C the next hour. Action budget preserved for the actual flood that hits at hour 16."
              inView={inView}
              startDelayMs={2400}
            />
          </section>

          {/* Diff caption */}
          <div className="panel relative overflow-hidden p-6 text-center">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px"
              style={{
                background:
                  "linear-gradient(90deg, transparent, var(--signal-violet) 50%, transparent)",
                opacity: 0.5,
              }}
            />
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
              the entire delta
            </p>
            <p className="mt-3 text-2xl font-medium tracking-tight text-[var(--ink-primary)] md:text-3xl">
              <span className="text-[var(--ink-muted)]">one paragraph of</span>{" "}
              <span className="text-[var(--cold-cyan)]">district context</span>
              <span className="text-[var(--ink-muted)]">
                {" "}
                turned a wasted intervention into a held action.
              </span>
            </p>
            <p className="mt-3 font-mono text-xs text-[var(--ink-secondary)]">
              That&apos;s the V2 environment — and the only kind of agent
              that wins on hard mode.
            </p>
          </div>

          {/* CTA */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] pt-8">
            <Link
              href="/"
              className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
            >
              ← back to home
            </Link>
            <Link
              href="/start"
              className="group inline-flex items-center gap-3 rounded-full bg-[var(--cold-cyan)] px-7 py-3.5 text-sm font-medium text-[var(--bg-base)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
              style={{ boxShadow: "var(--glow-cyan)" }}
            >
              <span>See it live</span>
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
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}

function Card({
  kind,
  tag,
  tagDetail,
  prompt,
  reasoning,
  action,
  outcome,
  inView,
  startDelayMs,
}: {
  kind: "good" | "bad";
  tag: string;
  tagDetail: string;
  prompt: string;
  reasoning: string;
  action: string;
  outcome: string;
  inView: boolean;
  startDelayMs: number;
}) {
  const accent = kind === "good" ? "var(--good-green)" : "var(--danger-red)";
  const accentChip =
    kind === "good"
      ? "border-[var(--good-green)] text-[var(--good-green)]"
      : "border-[var(--danger-red)] text-[var(--danger-red)]";

  // Delay typewriter mount until the previous card has had time to type.
  const [readyToType, setReadyToType] = useState(false);
  useEffect(() => {
    if (!inView) {
      setReadyToType(false);
      return;
    }
    const id = window.setTimeout(() => setReadyToType(true), startDelayMs);
    return () => window.clearTimeout(id);
  }, [inView, startDelayMs]);

  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
      transition={{
        duration: 0.5,
        ease: [0.22, 1, 0.36, 1],
        delay: kind === "good" ? 0.1 : 0,
      }}
      className="panel relative overflow-hidden p-6"
      style={{ borderColor: accent + "55" }}
    >
      <header className="flex items-baseline justify-between border-b border-[var(--line)] pb-3">
        <div className="flex items-baseline gap-2">
          <span
            className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.25em] ${accentChip}`}
          >
            {tag}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            {tagDetail}
          </span>
        </div>
        <span className="font-mono text-[10px] text-[var(--ink-muted)]">
          h+6
        </span>
      </header>

      <div className="mt-4 space-y-4">
        <Block label="// Prompt to LLM">
          <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[var(--ink-secondary)]">
            {prompt}
          </pre>
        </Block>

        <Block label="// Agent reasoning">
          {readyToType ? (
            <Typewriter text={reasoning} speedMs={11} resetKey={kind}>
              {(visible, done) => (
                <p className="font-mono text-[12.5px] leading-relaxed text-[var(--ink-primary)]">
                  {visible}
                  {!done ? (
                    <motion.span
                      className="ml-1 inline-block h-3 w-1.5 align-text-bottom"
                      style={{ background: accent }}
                      animate={{ opacity: [1, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity }}
                    />
                  ) : null}
                </p>
              )}
            </Typewriter>
          ) : (
            <p className="font-mono text-[12.5px] italic text-[var(--ink-muted)]">
              waiting for prompt to settle…
            </p>
          )}
        </Block>

        <Block label="// Action chosen">
          <span
            className="inline-block rounded-md border px-3 py-1.5 font-mono text-sm"
            style={{ color: accent, borderColor: accent }}
          >
            {action}
          </span>
        </Block>

        <Block label="// Outcome">
          <p className="font-mono text-[12px] leading-relaxed text-[var(--ink-secondary)]">
            {outcome}
          </p>
        </Block>
      </div>
    </motion.article>
  );
}

function Block({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] p-4">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
        {label}
      </div>
      {children}
    </div>
  );
}
