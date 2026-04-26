"use client";

import { Suspense, useCallback, useMemo, useState } from "react";

import { TopBar } from "@/components/chrome/TopBar";
import { AgentFeed } from "@/components/dashboard/AgentFeed";
import { BriefingPanel } from "@/components/dashboard/BriefingPanel";
import { HourTimeline } from "@/components/dashboard/HourTimeline";
import { RewardBreakdown } from "@/components/dashboard/RewardBreakdown";
import { Transport } from "@/components/dashboard/Transport";
import { TriangleMap } from "@/components/dashboard/TriangleMap";
import { useDataSource } from "@/lib/dataSource";
import { useEpisodeConfig } from "@/lib/episodeConfig";
import { useEpisode } from "@/lib/useEpisode";
import { useLiveEpisode } from "@/lib/useLiveEpisode";

export default function DashboardPage() {
  // useSearchParams (inside useDataSource) requires a Suspense boundary.
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const dataSource = useDataSource();
  const { cfg, loaded: cfgLoaded } = useEpisodeConfig();
  const [autopilot, setAutopilot] = useState(true);

  const mock = useEpisode(cfg?.task ?? "hard", {
    briefingOverride:
      cfg?.briefingSource === "user" ? cfg.customBriefing : undefined,
    briefingSourceOverride: cfg?.briefingSource ?? undefined,
  });

  // Gate the live hook on cfg hydration. Without this, the first render
  // posts `/reset` for the fallback task ("hard") and a second `/reset`
  // fires the moment cfg loads — those two resets race, drop the
  // autopilot interval, and produce the "stuck at hour 0" symptom.
  const live = useLiveEpisode({
    task: cfg?.task ?? "hard",
    customBriefing:
      cfg?.briefingSource === "user" ? cfg.customBriefing : undefined,
    briefingSourceOverride: cfg?.briefingSource,
    enabled: dataSource === "live" && cfgLoaded,
    autopilot,
  });

  // Live mode falls back to the mock trace whenever the backend hasn't
  // produced a state yet (or explicitly errored). Keeps the dashboard
  // useful even before Person 1's V2 endpoint is up.
  const useLive = !!(
    dataSource === "live" &&
    live.observation &&
    !live.error
  );

  const observation = useLive ? live.observation! : mock.observation;

  // Stable primitive/object refs so memoized child components skip re-renders
  // when only unrelated dashboard state (e.g. autopilot toggle) changes.
  const briefing = observation.briefing;
  const briefingSource = observation.briefing_source ?? "auto";
  const lastAction = observation.last_action;
  const lastReasoning = observation.last_reasoning;
  const events = observation.events;
  const reward = observation.reward_breakdown;
  const done = observation.done;
  const hour = useLive ? observation.hour : mock.hour;
  const difficulty = observation.difficulty;

  const handleToggleAutopilot = useCallback(() => setAutopilot((v) => !v), []);
  const handleStepOnce = useCallback(
    () => live.step({ node: "DVS_Barmer", action_type: "no_op" }, "manual tick").catch(() => {}),
    [live]
  );
  const handleCheckTemp = useCallback(
    () => live.step({ node: "DVS_Barmer", action_type: "check_temperature" }, "user-triggered probe").catch(() => {}),
    [live]
  );
  const handleCheckTruck = useCallback(
    () => live.step({ node: "DVS_Barmer", action_type: "check_truck_status" }, "user-triggered probe").catch(() => {}),
    [live]
  );

  const fullEvents = useMemo(() => {
    if (useLive) return events;
    const seen = new Set<string>();
    const out = [];
    for (const s of mock.trace) {
      for (const e of s.events) {
        const k = `${e.hour}-${e.type}-${e.text}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(e);
      }
    }
    return out;
  }, [useLive, mock.trace, events]);

  return (
    <>
      <TopBar />
      <main className="relative flex-1">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-5 px-6 py-6 md:px-10 md:py-8">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--line)] pb-4">
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
                // Mission Control · Barmer District
              </span>
              <h1 className="text-2xl font-medium leading-none tracking-tight md:text-4xl">
                Episode running.
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DataSourcePill source={dataSource} liveError={live.error} />
              {observation?.ethical_tension_active ? (
                <span
                  className="rounded-full border border-[var(--signal-violet)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--signal-violet)]"
                  style={{ boxShadow: "0 0 18px rgba(178,134,255,0.35)" }}
                >
                  ethical tension
                </span>
              ) : null}
            </div>
          </div>

          <BriefingPanel
            briefing={briefing}
            briefingSource={briefingSource}
            task={difficulty}
            episodeKey={`${dataSource}-${difficulty}`}
          />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <TriangleMap state={observation} />
            </div>
            <div className="flex flex-col gap-5 lg:col-span-2">
              <RewardBreakdown reward={reward} done={done} />
            </div>
            <div className="lg:col-span-3">
              <AgentFeed
                hour={hour}
                lastAction={lastAction}
                lastReasoning={lastReasoning}
                events={events}
                reward={reward}
              />
            </div>
          </div>

          <HourTimeline
            task={difficulty}
            hour={hour}
            state={observation}
            fullEvents={fullEvents}
            onSeek={useLive ? () => {} : mock.setHour}
          />

          {!useLive ? (
            <Transport
              task={mock.task}
              setTask={mock.setTask}
              playing={mock.playing}
              togglePlay={mock.togglePlay}
              restart={mock.restart}
              speed={mock.speed}
              setSpeed={mock.setSpeed}
            />
          ) : (
            <LiveTransportBar
              autopilot={autopilot}
              onToggleAutopilot={handleToggleAutopilot}
              onStepOnce={handleStepOnce}
              onCheckTemp={handleCheckTemp}
              onCheckTruck={handleCheckTruck}
              done={done}
              hour={observation.hour}
              maxHours={observation.max_hours}
            />
          )}

          <div className="flex items-center justify-between border-t border-[var(--line)] pt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            <span>
              {dataSource === "live"
                ? live.error
                  ? `backend offline · serving mock fallback (${live.error})`
                  : "backend connected · polling /state"
                : "mock episode driver · scaffold"}
            </span>
            <span>
              {dataSource === "live"
                ? "switch to mock: append ?live=0"
                : "switch to live: append ?live=1"}
            </span>
          </div>
        </div>
      </main>
    </>
  );
}

function DataSourcePill({
  source,
  liveError,
}: {
  source: "mock" | "live";
  liveError: string | null;
}) {
  if (source === "mock") {
    return (
      <span className="rounded-full border border-[var(--line-strong)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-secondary)]">
        mock data
      </span>
    );
  }
  if (liveError) {
    return (
      <span className="rounded-full border border-[var(--warn-amber)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--warn-amber)]">
        live · backend offline
      </span>
    );
  }
  return (
    <span
      className="rounded-full border border-[var(--good-green)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--good-green)]"
      style={{ boxShadow: "0 0 14px rgba(80,224,168,0.35)" }}
    >
      live · backend
    </span>
  );
}

function LiveTransportBar({
  autopilot,
  onToggleAutopilot,
  onStepOnce,
  onCheckTemp,
  onCheckTruck,
  done,
  hour,
  maxHours,
}: {
  autopilot: boolean;
  onToggleAutopilot: () => void;
  onStepOnce: () => void;
  onCheckTemp: () => void;
  onCheckTruck: () => void;
  done: boolean;
  hour: number;
  maxHours: number;
}) {
  return (
    <div className="panel flex flex-wrap items-center justify-between gap-3 p-3 px-4">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--ink-muted)]">
          live transport
        </span>
        <span className="rounded-md border border-[var(--line)] px-2 py-1 font-mono text-[11px] tabular-nums text-[var(--ink-secondary)]">
          h+{String(hour).padStart(2, "0")} / {maxHours}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onToggleAutopilot}
          disabled={done}
          className={`rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors disabled:opacity-40 ${
            autopilot
              ? "border-[var(--cold-cyan)] bg-[var(--cold-cyan)] text-[var(--bg-base)]"
              : "border-[var(--line-strong)] text-[var(--ink-secondary)] hover:border-[var(--cold-cyan)] hover:text-[var(--cold-cyan)]"
          }`}
        >
          {autopilot ? "■ autopilot on" : "▶ autopilot off"}
        </button>
        <button
          onClick={onStepOnce}
          disabled={done || autopilot}
          className="rounded-md border border-[var(--line-strong)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-secondary)] transition-colors hover:border-[var(--cold-cyan)] hover:text-[var(--cold-cyan)] disabled:opacity-40"
          title="Send a single no_op step (advances 1 hour)."
        >
          step +1h
        </button>
        <button
          onClick={onCheckTemp}
          disabled={done}
          className="rounded-md border border-[var(--line-strong)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-secondary)] transition-colors hover:border-[var(--warn-amber)] hover:text-[var(--warn-amber)] disabled:opacity-40"
        >
          check temp
        </button>
        <button
          onClick={onCheckTruck}
          disabled={done}
          className="rounded-md border border-[var(--line-strong)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-secondary)] transition-colors hover:border-[var(--signal-violet)] hover:text-[var(--signal-violet)] disabled:opacity-40"
        >
          check truck
        </button>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <main className="flex-1">
      <div className="mx-auto max-w-[1500px] px-6 py-12 font-mono text-xs uppercase tracking-[0.3em] text-[var(--ink-muted)]">
        loading mission control…
      </div>
    </main>
  );
}
