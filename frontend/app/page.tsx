import Link from "next/link";

import { TopBar } from "@/components/chrome/TopBar";
import { AnimatedNumber } from "@/components/hero/AnimatedNumber";
import { HeroDither } from "@/components/hero/HeroDither";
import { HeroStat } from "@/components/hero/HeroStat";
import { KineticStrap } from "@/components/hero/KineticStrap";

export default function Home() {
  return (
    <>
      <TopBar />

      <main className="relative flex-1 overflow-hidden">
        <HeroDither />

        {/* Background grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(var(--ink-faint) 1px, transparent 1px), linear-gradient(90deg, var(--ink-faint) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />

        {/* Hero */}
        <section className="relative mx-auto max-w-[1400px] px-6 pt-28 pb-20 md:px-12 md:pt-40 md:pb-32">
          <div className="flex flex-col gap-10">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-[var(--good-green)] hum" />
              <span className="label-mono">OpenEnv // Episode Live</span>
              <span className="label-mono text-[var(--ink-faint)]">/</span>
              <span className="label-mono">Scalar School Hackathon &apos;26</span>
            </div>

            <h1 className="font-[var(--font-display)] font-medium leading-[0.86] tracking-tight text-[clamp(3rem,11vw,11rem)]">
              <span className="block text-[var(--ink-primary)]">VACCINE</span>
              <span className="block text-[var(--ink-primary)]">COLD CHAIN.</span>
              <span className="block text-[var(--ink-muted)]">
                72 hours. 3 nodes.
              </span>
              <span className="block text-[var(--cold-cyan)]">1 agent.</span>
            </h1>

            <p className="max-w-2xl text-lg leading-relaxed text-[var(--ink-secondary)] md:text-xl">
              An AI agent manages a 3-node vaccine cold chain through
              generator failures, lying temperature sensors, flooded roads, and
              uncertain truck arrivals. Score = vaccines delivered, minus what
              spoiled, minus the sessions it missed.
            </p>

            <div className="flex flex-wrap gap-4">
              <Link
                href="/start"
                className="group relative inline-flex items-center gap-3 rounded-full bg-[var(--cold-cyan)] px-7 py-4 text-base font-medium text-[var(--bg-base)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
                style={{ boxShadow: "var(--glow-cyan)" }}
              >
                <span>Run an episode</span>
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

              <Link
                href="#brief"
                className="inline-flex items-center gap-3 rounded-full border border-[var(--line-strong)] bg-transparent px-7 py-4 text-base font-medium text-[var(--ink-primary)] transition-colors hover:border-[var(--cold-cyan)] hover:text-[var(--cold-cyan)]"
              >
                Read the brief
              </Link>
            </div>
          </div>
        </section>

        <KineticStrap />

        {/* Brief / stats */}
        <section
          id="brief"
          className="relative mx-auto max-w-[1400px] px-6 py-24 md:px-12 md:py-32"
        >
          <div className="mb-12 flex items-baseline justify-between border-b border-[var(--line)] pb-6">
            <h2 className="text-3xl font-medium tracking-tight md:text-5xl">
              The brief.
            </h2>
            <span className="label-mono">// 02</span>
          </div>

          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--line)] md:grid-cols-3">
            <HeroStat
              label="Nodes"
              value={<AnimatedNumber value={3} />}
              detail="DVS Barmer · CHC Balotra · PHC Sindhari"
            />
            <HeroStat
              label="Max hours"
              value={<AnimatedNumber value={72} />}
              detail="1 step = 1 simulated hour"
            />
            <HeroStat
              label="Action types"
              value={<AnimatedNumber value={5} />}
              detail="transfer · refuel · cancel · check_truck · wait"
            />
            <HeroStat
              label="Hard task"
              value="Brief + lie + flood"
              detail="LLM reads briefing · sensor lies · road closes"
            />
            <HeroStat
              label="Cold band"
              value="2 → 8 °C"
              detail="outside this range, vials spoil"
            />
            <HeroStat
              label="Score"
              value="cov − waste − missed"
              detail="terminal reward, clamped at 0"
            />
          </div>
        </section>

        {/* Footer ticker */}
        <footer className="relative border-t border-[var(--line)] py-6">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 md:px-12">
            <span className="label-mono">v0.1.0 · Dev preview</span>
            <span className="label-mono">
              Scalar School Hackathon &apos;26 · OpenEnv
            </span>
          </div>
        </footer>
      </main>
    </>
  );
}
