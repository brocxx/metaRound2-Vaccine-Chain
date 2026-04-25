"use client";

/**
 * Read-only episode replay.
 *
 * Loads either:
 *   - an uploaded JSON file (an array of VaccineStateV2 the backend dumped
 *     during a finished episode), or
 *   - the seeded "hard" demo trace from mockEpisode (one click).
 *
 * Renders the same TriangleMap + Timeline + AgentFeed + BriefingPanel
 * as the live dashboard but with a thick scrubber and a "key moments"
 * rail underneath that jumps the playhead when clicked.
 */

import { motion } from "framer-motion";
import { useMemo, useRef, useState } from "react";

import { TopBar } from "@/components/chrome/TopBar";
import { AgentFeed } from "@/components/dashboard/AgentFeed";
import { BriefingPanel } from "@/components/dashboard/BriefingPanel";
import { HourTimeline } from "@/components/dashboard/HourTimeline";
import { RewardBreakdown } from "@/components/dashboard/RewardBreakdown";
import { TriangleMap } from "@/components/dashboard/TriangleMap";
import { cn } from "@/lib/cn";
import { getMockTrace } from "@/lib/mockEpisode";
import type { EventV2, VaccineStateV2 } from "@/lib/types";

type LoadedTrace = {
  source: "upload" | "demo";
  filename?: string;
  trace: VaccineStateV2[];
};

// Heuristic ranking for the "key moments" rail. Higher = more important.
const EVENT_WEIGHT: Record<string, number> = {
  sensor_lie: 100,
  ethical_tension: 95,
  flood: 80,
  spoilage: 75,
  truck: 60,
  outreach: 50,
  generator: 40,
  transfer: 30,
  info: 10,
};

function pickKeyMoments(trace: VaccineStateV2[], k = 8): EventV2[] {
  const seen = new Set<string>();
  const all: EventV2[] = [];
  for (const s of trace) {
    for (const e of s.events) {
      const key = `${e.hour}-${e.type}-${e.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(e);
    }
  }
  return all
    .map((e) => ({ e, w: EVENT_WEIGHT[e.type] ?? 0 }))
    .sort((a, b) => b.w - a.w || a.e.hour - b.e.hour)
    .slice(0, k)
    .map((x) => x.e)
    .sort((a, b) => a.hour - b.hour);
}

function parseLoadedJson(raw: string): VaccineStateV2[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Trust caller; light validation
      if (parsed.length === 0 || typeof parsed[0]?.hour !== "number")
        return null;
      return parsed as VaccineStateV2[];
    }
    if (parsed && typeof parsed === "object" && "hour" in parsed) {
      return [parsed as VaccineStateV2];
    }
    return null;
  } catch {
    return null;
  }
}

export default function ReplayPage() {
  const [loaded, setLoaded] = useState<LoadedTrace | null>(null);
  const [hour, setHour] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const observation = loaded?.trace[Math.min(hour, loaded.trace.length - 1)];

  const fullEvents = useMemo(() => {
    if (!loaded) return [] as EventV2[];
    const seen = new Set<string>();
    const out: EventV2[] = [];
    for (const s of loaded.trace) {
      for (const e of s.events) {
        const key = `${e.hour}-${e.type}-${e.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(e);
      }
    }
    return out;
  }, [loaded]);

  const keyMoments = useMemo(
    () => (loaded ? pickKeyMoments(loaded.trace) : []),
    [loaded]
  );

  function loadDemo() {
    const trace = getMockTrace("hard");
    setLoaded({ source: "demo", trace });
    setHour(0);
    setError(null);
  }

  async function handleFile(file: File) {
    try {
      const text = await file.text();
      const trace = parseLoadedJson(text);
      if (!trace) {
        setError(
          "couldn't parse this file — expected a VaccineStateV2 array or single object"
        );
        return;
      }
      setLoaded({ source: "upload", filename: file.name, trace });
      setHour(0);
      setError(null);
    } catch {
      setError("file read failed");
    }
  }

  return (
    <>
      <TopBar />
      <main className="relative flex-1">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-5 px-6 py-6 md:px-10 md:py-8">
          {/* Header + loader */}
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--line)] pb-5">
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                // Replay · read-only
              </span>
              <h1 className="text-2xl font-medium leading-none tracking-tight md:text-4xl">
                {loaded
                  ? loaded.source === "demo"
                    ? "Seeded hard demo"
                    : `Uploaded · ${loaded.filename ?? "trace"}`
                  : "Load an episode."}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="rounded-md border border-[var(--line-strong)] px-3 py-1.5 font-mono text-xs text-[var(--ink-secondary)] transition-colors hover:border-[var(--cold-cyan)] hover:text-[var(--cold-cyan)]"
              >
                ↥ upload .json
              </button>
              <button
                onClick={loadDemo}
                className="rounded-md bg-[var(--cold-cyan)] px-4 py-1.5 font-mono text-xs uppercase tracking-[0.2em] text-[var(--bg-base)] transition-opacity hover:opacity-90"
                style={{ boxShadow: "var(--glow-cyan)" }}
              >
                ▶ load seeded hard
              </button>
            </div>
          </header>

          {error ? (
            <div className="panel border-[var(--danger-red)] p-4 font-mono text-xs text-[var(--danger-red)]">
              {error}
            </div>
          ) : null}

          {!loaded ? (
            <Empty />
          ) : observation ? (
            <>
              <BriefingPanel
                briefing={observation.briefing}
                briefingSource={observation.briefing_source ?? "auto"}
                task={observation.difficulty}
                episodeKey={`${loaded.source}-${loaded.filename ?? "demo"}`}
                instant
              />

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                <div className="lg:col-span-7">
                  <TriangleMap state={observation} />
                </div>
                <div className="flex flex-col gap-5 lg:col-span-2">
                  <RewardBreakdown
                    reward={observation.reward_breakdown}
                    done={observation.done}
                  />
                </div>
                <div className="lg:col-span-3">
                  <AgentFeed
                    hour={observation.hour}
                    lastAction={observation.last_action}
                    lastReasoning={observation.last_reasoning}
                    events={observation.events}
                    reward={observation.reward_breakdown}
                  />
                </div>
              </div>

              <HourTimeline
                task={observation.difficulty}
                hour={hour}
                state={observation}
                fullEvents={fullEvents}
                onSeek={setHour}
              />

              {/* Key moments rail */}
              <KeyMomentsRail
                moments={keyMoments}
                currentHour={hour}
                onJump={setHour}
              />

              <div className="flex items-center justify-between border-t border-[var(--line)] pt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                <span>read-only · scrub the timeline or pick a key moment</span>
                <span>{loaded.trace.length} states loaded</span>
              </div>
            </>
          ) : null}
        </div>
      </main>
    </>
  );
}

function Empty() {
  return (
    <div className="panel flex min-h-[40vh] flex-col items-center justify-center gap-3 p-12 text-center">
      <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
        // No episode loaded
      </span>
      <p className="max-w-md font-mono text-sm text-[var(--ink-secondary)]">
        Drop a finished episode JSON (an array of <code className="kbd">/state</code> snapshots), or load
        the seeded hard demo to see the bible&apos;s example trace.
      </p>
    </div>
  );
}

function KeyMomentsRail({
  moments,
  currentHour,
  onJump,
}: {
  moments: EventV2[];
  currentHour: number;
  onJump: (h: number) => void;
}) {
  const colorOf: Record<string, string> = {
    sensor_lie: "var(--warn-amber)",
    ethical_tension: "var(--signal-violet)",
    flood: "var(--danger-red)",
    spoilage: "var(--danger-red)",
    truck: "var(--cold-cyan)",
    outreach: "var(--signal-violet)",
    generator: "var(--warn-amber)",
    transfer: "var(--cold-cyan)",
  };

  if (moments.length === 0) return null;

  return (
    <section className="panel p-5">
      <header className="mb-3 flex items-baseline justify-between border-b border-[var(--line)] pb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
          // Key moments
        </span>
        <span className="font-mono text-[10px] text-[var(--ink-muted)]">
          click to scrub
        </span>
      </header>
      <ol className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
        {moments.map((m) => {
          const color = colorOf[m.type] ?? "var(--ink-muted)";
          const active = m.hour === currentHour;
          return (
            <motion.li
              key={`${m.hour}-${m.type}-${m.text}`}
              whileHover={{ y: -2 }}
              className="contents"
            >
              <button
                onClick={() => onJump(m.hour)}
                className={cn(
                  "group flex flex-col items-start gap-1 rounded-lg border p-3 text-left font-mono transition-colors",
                  active
                    ? "border-[var(--cold-cyan)] bg-[var(--bg-elev)]"
                    : "border-[var(--line)] bg-[var(--bg-elev)] hover:border-[var(--line-strong)]"
                )}
                style={
                  active
                    ? { boxShadow: "var(--glow-cyan)" }
                    : undefined
                }
              >
                <div className="flex w-full items-center justify-between">
                  <span
                    className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em]"
                    style={{ color, backgroundColor: color + "1A" }}
                  >
                    {m.type.replace("_", " ")}
                  </span>
                  <span className="text-[10px] text-[var(--ink-muted)]">
                    h+{String(m.hour).padStart(2, "0")}
                  </span>
                </div>
                <span className="text-[12px] leading-snug text-[var(--ink-primary)]">
                  {m.text}
                </span>
              </button>
            </motion.li>
          );
        })}
      </ol>
    </section>
  );
}
