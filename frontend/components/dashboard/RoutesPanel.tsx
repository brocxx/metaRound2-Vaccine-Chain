"use client";

/**
 * RoutesPanel — surfaces the static OSM-derived route metadata
 * (`distance_km`, `eta_min`, `road_type`) emitted by the backend on
 * `/state.routes`. Mounted as a small overlay on the TriangleMap.
 *
 * Strictly additive: when `routes` is undefined or empty (e.g. the
 * `geo_config.json` fallback path is hit, or this is an old backend),
 * the component returns `null` and the legacy demo is unchanged.
 *
 * NOTE: this file deliberately does NOT touch `dashboard/page.tsx`,
 * `episodeConfig.ts`, or `useLiveEpisode.ts` — those are protected by
 * the autopilot-ticking fix in commit 2408efe2.
 */

import { memo } from "react";

import {
  NODE_LABELS,
  NodeKey,
  RoadKey,
  RouteGeo,
  VaccineStateV2,
} from "@/lib/types";

interface RoutesPanelProps {
  routes: VaccineStateV2["routes"];
}

interface ParsedRoute {
  key: RoadKey;
  from: NodeKey | null;
  to: NodeKey | null;
  geo: RouteGeo;
}

const NODE_KEY_SET = new Set<NodeKey>([
  "DVS_Barmer",
  "CHC_Balotra",
  "PHC_Sindhari",
]);

function parseRouteKey(key: string): { from: NodeKey | null; to: NodeKey | null } {
  // Route keys follow `<NodeA>_to_<NodeB>` where each node is one of three
  // multi-word identifiers (e.g. `DVS_Barmer`). Splitting on the literal
  // `_to_` keeps the underscore inside each node id intact.
  const parts = key.split("_to_");
  if (parts.length !== 2) return { from: null, to: null };
  const [a, b] = parts;
  return {
    from: NODE_KEY_SET.has(a as NodeKey) ? (a as NodeKey) : null,
    to: NODE_KEY_SET.has(b as NodeKey) ? (b as NodeKey) : null,
  };
}

function formatRoadType(rt: string): string {
  return rt
    .split("_")
    .map((s) => (s.length ? s[0].toUpperCase() + s.slice(1) : s))
    .join(" ");
}

function RoutesPanelInner({ routes }: RoutesPanelProps) {
  if (!routes) return null;
  const entries = Object.entries(routes);
  if (entries.length === 0) return null;

  const parsed: ParsedRoute[] = entries.map(([key, geo]) => {
    const { from, to } = parseRouteKey(key);
    return { key: key as RoadKey, from, to, geo: geo as RouteGeo };
  });

  return (
    <div
      className="pointer-events-none absolute bottom-3 right-3 z-10 w-72 rounded-xl border border-[var(--line-strong)] bg-[var(--bg-base)]/90 p-3 backdrop-blur-md"
      data-testid="routes-panel"
    >
      <div className="mb-2 flex items-baseline justify-between border-b border-[var(--line)] pb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--ink-muted)]">
          Static Geo · OSM
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          {parsed.length} route{parsed.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {parsed.map(({ key, from, to, geo }) => {
          const label =
            from && to
              ? `${NODE_LABELS[from]} → ${NODE_LABELS[to]}`
              : key.replace(/_/g, " ");
          return (
            <li key={key} className="flex flex-col gap-0.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-secondary)]">
                {label}
              </span>
              <span className="flex items-center gap-2 font-mono text-[11px] text-[var(--ink-primary)] tabular-nums">
                <span>{geo.distance_km} km</span>
                <span className="text-[var(--ink-faint)]">·</span>
                <span>{geo.eta_min} min</span>
                <span className="text-[var(--ink-faint)]">·</span>
                <span className="text-[var(--ink-muted)]">
                  {formatRoadType(geo.road_type)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const RoutesPanel = memo(RoutesPanelInner);
