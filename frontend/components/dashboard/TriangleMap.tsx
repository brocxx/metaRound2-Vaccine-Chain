"use client";

/**
 * The centrepiece of the V2 dashboard.
 *
 * One large SVG showing the three Barmer-district facilities in a triangle,
 * connected by curved road lines whose colour reflects /state.roads. Inside
 * each node circle:
 *
 *   - outer ring   = current sensor temperature (color follows tempColor)
 *   - inner donut  = generator fuel %
 *   - center text  = vials on hand
 *   - dot          = generator on/off
 *
 * Special states overlay on top:
 *
 *   - sensor_lying → outer ring fragments into dashed amber, "judge view"
 *     badge appears above with the actual temperature, faint waveform
 *     connects sensor reading to ground truth
 *   - outreach this hour → node ring pulses violet
 *   - hover → other nodes fade to 30%, side-tooltip with NodeReadout
 *   - transfer event → glowing particle rides the matching road
 *
 * Subcomponents are kept private to this file; only TriangleMap is exported.
 */

import { AnimatePresence, motion } from "framer-motion";
import { Component, memo, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";

import {
  EventV2,
  NodeKey,
  NodeStateV2,
  NODE_KEYS,
  NODE_LABELS,
  NODE_TYPE_LABELS,
  RoadEdge,
  ROADS,
  RoadKey,
  RoadStatus,
  TEMP_DANGER,
  TEMP_SAFE_MAX,
  VaccineStateV2,
  tempColor,
} from "@/lib/types";

import { RoutesPanel } from "./RoutesPanel";

class RoutesPanelErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Keep this panel failure isolated; mission-control map must stay usable.
  }

  override render(): ReactNode {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ─── Layout constants ─────────────────────────────────────────────────────

const VIEW_W = 1000;
const VIEW_H = 720;

const POS: Record<NodeKey, { x: number; y: number }> = {
  DVS_Barmer: { x: 500, y: 130 },
  CHC_Balotra: { x: 175, y: 590 },
  PHC_Sindhari: { x: 825, y: 590 },
};

const NODE_R = 90;
const RING_R = 76;
const FUEL_R = 56;

// ─── Geometry helpers ─────────────────────────────────────────────────────

function bezierBetween(a: NodeKey, b: NodeKey): string {
  const A = POS[a];
  const B = POS[b];
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;
  // Push the control point slightly outward from the centroid for a curved feel.
  const cx = mx + (mx - 500) * 0.15;
  const cy = my + (my - 440) * 0.1;
  return `M ${A.x} ${A.y} Q ${cx} ${cy} ${B.x} ${B.y}`;
}

const ROAD_PATHS: Record<RoadKey, string> = {
  DVS_Barmer_to_CHC_Balotra: bezierBetween("DVS_Barmer", "CHC_Balotra"),
  CHC_Balotra_to_PHC_Sindhari: bezierBetween("CHC_Balotra", "PHC_Sindhari"),
  DVS_Barmer_to_PHC_Sindhari: bezierBetween("DVS_Barmer", "PHC_Sindhari"),
};

// ─── Subcomponent: MapRoad ────────────────────────────────────────────────

const MapRoad = memo(function MapRoad({
  edge,
  status,
}: {
  edge: RoadEdge;
  status: RoadStatus;
}) {
  const path = ROAD_PATHS[edge.key];
  const open = status === "open";
  const color = open ? "var(--cold-cyan)" : "var(--danger-red)";
  const id = `road-${edge.key}`;

  return (
    <g>
      {/* Wide hairline backing */}
      <path
        d={path}
        stroke="var(--line-strong)"
        strokeWidth={6}
        fill="none"
        opacity={0.5}
      />
      {/* Active line — closed roads use a CSS marching dash so polling re-renders
          don't restart the animation. */}
      <path
        id={id}
        d={path}
        stroke={color}
        strokeWidth={open ? 1.5 : 2.5}
        strokeDasharray={open ? "0" : "8 6"}
        fill="none"
        opacity={open ? 0.85 : 0.95}
        className={open ? undefined : "road-closed-march"}
        style={{
          filter: open
            ? "drop-shadow(0 0 6px rgba(108,217,255,0.45))"
            : "drop-shadow(0 0 8px rgba(255,77,109,0.5))",
          transition: "opacity 0.4s ease, stroke-width 0.3s ease",
        }}
      />
      {/* Closed-road label */}
      {!open ? (
        <RoadLabel edge={edge} text="ROAD CLOSED" color={color} />
      ) : null}
    </g>
  );
});

function RoadLabel({
  edge,
  text,
  color,
}: {
  edge: RoadEdge;
  text: string;
  color: string;
}) {
  const A = POS[edge.from];
  const B = POS[edge.to];
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2 - 14;
  return (
    <g transform={`translate(${mx},${my})`}>
      <rect
        x={-58}
        y={-11}
        width={116}
        height={22}
        rx={11}
        fill="var(--bg-base)"
        stroke={color}
        strokeOpacity={0.5}
      />
      <text
        x={0}
        y={4}
        textAnchor="middle"
        style={{
          font: '600 10px "JetBrains Mono", ui-monospace, monospace',
          letterSpacing: "0.2em",
        }}
        fill={color}
      >
        {text}
      </text>
    </g>
  );
}

// ─── Subcomponent: TransferParticle ──────────────────────────────────────

interface TransferAnim {
  id: string;
  road: RoadKey;
  startedAt: number;
}

function TransferParticle({
  road,
  onDone,
}: {
  road: RoadKey;
  onDone: () => void;
}) {
  const path = ROAD_PATHS[road];
  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onAnimationComplete={() => {
        // Schedule cleanup after the motion finishes
        window.setTimeout(onDone, 1800);
      }}
    >
      <circle r={10} fill="var(--cold-cyan)" opacity={0.25}>
        <animateMotion dur="1.6s" repeatCount="1" path={path} />
      </circle>
      <circle r={5} fill="var(--cold-cyan)" style={{ filter: "drop-shadow(0 0 10px rgba(108,217,255,0.85))" }}>
        <animateMotion dur="1.6s" repeatCount="1" path={path} />
      </circle>
    </motion.g>
  );
}

// ─── Subcomponent: SensorLieHalo ──────────────────────────────────────────

const SensorLieHalo = memo(function SensorLieHalo({
  node,
  data,
}: {
  node: NodeKey;
  data: NodeStateV2;
}) {
  const { x, y } = POS[node];
  const ringR = RING_R + 12;

  return (
    <g pointerEvents="none">
      {/* Dashed amber arc — CSS-driven so React re-renders don't restart it. */}
      <circle
        cx={x}
        cy={y}
        r={ringR}
        fill="none"
        stroke="var(--warn-amber)"
        strokeWidth={2}
        strokeDasharray="6 8"
        className="sensor-lie-arc"
        style={{ filter: "drop-shadow(0 0 14px rgba(255,181,71,0.55))" }}
      />
      {/* Judge-view badge */}
      <g transform={`translate(${x},${y - ringR - 26})`}>
        <rect
          x={-78}
          y={-14}
          width={156}
          height={28}
          rx={14}
          fill="var(--bg-base)"
          stroke="var(--warn-amber)"
        />
        <text
          x={-66}
          y={4}
          style={{
            font: '600 9px "JetBrains Mono", ui-monospace, monospace',
            letterSpacing: "0.18em",
          }}
          fill="var(--warn-amber)"
        >
          JUDGE
        </text>
        <text
          x={-32}
          y={4}
          style={{
            font: '500 11px "JetBrains Mono", ui-monospace, monospace',
          }}
          fill="var(--ink-primary)"
        >
          actual {data.actual_temperature.toFixed(1)}°C
        </text>
      </g>
      {/* Waveform connecting reported → actual (CSS animated) */}
      <path
        d={`M ${x - 18} ${y - ringR - 10} q 6 -8 12 0 t 12 0 t 12 0`}
        stroke="var(--warn-amber)"
        strokeWidth={1}
        fill="none"
        className="sensor-lie-wave"
      />
    </g>
  );
});

// ─── Subcomponent: MapNode ────────────────────────────────────────────────

const MapNode = memo(function MapNode({
  nodeKey,
  data,
  pulseOutreach,
  faded,
  onHover,
}: {
  nodeKey: NodeKey;
  data: NodeStateV2;
  pulseOutreach: boolean;
  faded: boolean;
  onHover: (key: NodeKey | null) => void;
}) {
  const { x, y } = POS[nodeKey];
  const tempStroke = tempColor(data.sensor_reading);

  // Fuel donut math
  const fuelCircumference = 2 * Math.PI * FUEL_R;
  const fuelOffset = fuelCircumference * (1 - data.generator_fuel_pct);

  const labelTop = nodeKey === "DVS_Barmer";

  return (
    <g
      onMouseEnter={() => onHover(nodeKey)}
      onMouseLeave={() => onHover(null)}
      style={{
        cursor: "pointer",
        opacity: faded ? 0.28 : 1,
        transition: "opacity 0.25s ease",
      }}
    >
      {/* Outreach pulse — CSS so it doesn't restart on re-render */}
      {pulseOutreach ? (
        <circle
          cx={x}
          cy={y}
          r={NODE_R + 18}
          fill="none"
          stroke="var(--signal-violet)"
          strokeWidth={2}
          className="node-outreach-pulse"
        />
      ) : null}

      {/* Hit area */}
      <circle cx={x} cy={y} r={NODE_R + 8} fill="transparent" />

      {/* Outer temperature ring */}
      <circle
        cx={x}
        cy={y}
        r={RING_R}
        fill="none"
        stroke={tempStroke}
        strokeWidth={data.temperature_alarm ? 4 : 2}
        opacity={data.temperature_alarm ? 0.95 : 0.8}
        style={{
          filter:
            data.sensor_reading > TEMP_DANGER
              ? "drop-shadow(0 0 14px rgba(255,77,109,0.7))"
              : data.sensor_reading > TEMP_SAFE_MAX
              ? "drop-shadow(0 0 10px rgba(255,181,71,0.5))"
              : "drop-shadow(0 0 8px rgba(80,224,168,0.35))",
          transition: "stroke 0.4s ease, stroke-width 0.3s ease, opacity 0.3s ease",
        }}
      />
      {data.temperature_alarm ? (
        <circle
          cx={x}
          cy={y}
          r={RING_R}
          fill="none"
          stroke={tempStroke}
          strokeWidth={1}
          className="node-alarm-pulse"
        />
      ) : null}

      {/* Generator fuel donut (truthful, always shown) */}
      <circle
        cx={x}
        cy={y}
        r={FUEL_R}
        fill="none"
        stroke="var(--line-strong)"
        strokeWidth={4}
      />
      <circle
        cx={x}
        cy={y}
        r={FUEL_R}
        fill="none"
        stroke={
          data.generator_on
            ? data.generator_fuel_pct < 0.25
              ? "var(--warn-amber)"
              : "var(--good-green)"
            : "var(--danger-red)"
        }
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={`${fuelCircumference}`}
        strokeDashoffset={fuelOffset}
        transform={`rotate(-90 ${x} ${y})`}
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />

      {/* Solid panel inside */}
      <circle
        cx={x}
        cy={y}
        r={FUEL_R - 10}
        fill="var(--bg-panel)"
        stroke="var(--line)"
      />

      {/* Vial count */}
      <text
        x={x}
        y={y - 4}
        textAnchor="middle"
        style={{
          font: '500 30px "Space Grotesk", ui-sans-serif, sans-serif',
        }}
        fill="var(--ink-primary)"
      >
        {data.vials}
      </text>
      <text
        x={x}
        y={y + 14}
        textAnchor="middle"
        style={{
          font: '500 9px "JetBrains Mono", ui-monospace, monospace',
          letterSpacing: "0.25em",
        }}
        fill="var(--ink-muted)"
      >
        VIALS
      </text>

      {/* Sensor reading chip */}
      <g transform={`translate(${x},${y + RING_R + 22})`}>
        <rect
          x={-44}
          y={-12}
          width={88}
          height={24}
          rx={12}
          fill="var(--bg-elev)"
          stroke="var(--line-strong)"
        />
        <text
          x={0}
          y={4}
          textAnchor="middle"
          style={{
            font: '600 12px "JetBrains Mono", ui-monospace, monospace',
            transition: "fill 0.4s ease",
          }}
          fill={tempStroke}
        >
          {data.sensor_reading.toFixed(1)}°C
        </text>
      </g>

      {/* Generator dot */}
      <g transform={`translate(${x - RING_R + 6},${y - RING_R + 6})`}>
        <circle
          r={5}
          fill={
            data.generator_on
              ? data.generator_fuel_pct < 0.25
                ? "var(--warn-amber)"
                : "var(--good-green)"
              : "var(--danger-red)"
          }
        />
      </g>

      {/* Node label outside the ring */}
      <g
        transform={`translate(${x},${
          labelTop ? y - NODE_R - 22 : y + NODE_R + 50
        })`}
      >
        <text
          x={0}
          y={0}
          textAnchor="middle"
          style={{
            font: '600 12px "JetBrains Mono", ui-monospace, monospace',
            letterSpacing: "0.25em",
          }}
          fill="var(--ink-primary)"
        >
          {NODE_LABELS[nodeKey].toUpperCase()}
        </text>
        <text
          x={0}
          y={14}
          textAnchor="middle"
          style={{
            font: '400 10px "JetBrains Mono", ui-monospace, monospace',
          }}
          fill="var(--ink-muted)"
        >
          {NODE_TYPE_LABELS[nodeKey]}
        </text>
      </g>
    </g>
  );
}, (prev, next) =>
  prev.nodeKey === next.nodeKey &&
  prev.faded === next.faded &&
  prev.pulseOutreach === next.pulseOutreach &&
  prev.data.vials === next.data.vials &&
  prev.data.sensor_reading === next.data.sensor_reading &&
  prev.data.actual_temperature === next.data.actual_temperature &&
  prev.data.sensor_lying === next.data.sensor_lying &&
  prev.data.generator_on === next.data.generator_on &&
  prev.data.generator_fuel_pct === next.data.generator_fuel_pct &&
  prev.data.temperature_alarm === next.data.temperature_alarm
);

// ─── Subcomponent: NodeTooltip ────────────────────────────────────────────

function NodeTooltip({
  nodeKey,
  data,
  hour,
}: {
  nodeKey: NodeKey;
  data: NodeStateV2;
  hour: number;
}) {
  const right = nodeKey !== "PHC_Sindhari";
  return (
    <div
      className={`pointer-events-none absolute top-3 ${right ? "right-3" : "left-3"} w-72 rounded-xl border border-[var(--line-strong)] bg-[var(--bg-base)]/95 p-4 backdrop-blur-md`}
    >
      <div className="flex items-baseline justify-between border-b border-[var(--line)] pb-2">
        <div className="flex flex-col">
          <span className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--ink-primary)]">
            {NODE_LABELS[nodeKey]}
          </span>
          <span className="font-mono text-[10px] text-[var(--ink-muted)]">
            {NODE_TYPE_LABELS[nodeKey]}
          </span>
        </div>
        <span className="font-mono text-[10px] text-[var(--ink-muted)]">
          h+{hour}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-y-2 font-mono text-xs">
        <dt className="text-[var(--ink-muted)]">Sensor</dt>
        <dd
          className="text-right tabular-nums"
          style={{ color: tempColor(data.sensor_reading) }}
        >
          {data.sensor_reading.toFixed(2)}°C
        </dd>
        <dt className="text-[var(--ink-muted)]">Actual</dt>
        <dd
          className="text-right tabular-nums"
          style={{
            color: data.sensor_lying
              ? "var(--warn-amber)"
              : "var(--ink-secondary)",
          }}
        >
          {data.actual_temperature.toFixed(2)}°C
        </dd>
        <dt className="text-[var(--ink-muted)]">Vials</dt>
        <dd className="text-right tabular-nums text-[var(--ink-primary)]">
          {data.vials}
        </dd>
        <dt className="text-[var(--ink-muted)]">Generator</dt>
        <dd
          className="text-right"
          style={{
            color: data.generator_on
              ? "var(--good-green)"
              : "var(--danger-red)",
          }}
        >
          {data.generator_on ? "ON" : "OFF"}
        </dd>
        <dt className="text-[var(--ink-muted)]">Fuel</dt>
        <dd className="text-right tabular-nums text-[var(--ink-secondary)]">
          {Math.round(data.generator_fuel_pct * 100)}%
        </dd>
        {data.sensor_lying ? (
          <>
            <dt className="text-[var(--warn-amber)]">Sensor</dt>
            <dd className="text-right text-[var(--warn-amber)]">
              LYING (Δ{Math.abs(
                data.sensor_reading - data.actual_temperature
              ).toFixed(1)}°)
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

// ─── Main: TriangleMap ────────────────────────────────────────────────────

interface TriangleMapProps {
  state: VaccineStateV2;
}

function TriangleMapInner({ state }: TriangleMapProps) {
  const [hovered, setHovered] = useState<NodeKey | null>(null);

  // Spawn a TransferParticle whenever a new transfer event with a road key
  // appears in state.events. We dedupe on (hour + road).
  const seenRef = useRef<Set<string>>(new Set());
  const [particles, setParticles] = useState<TransferAnim[]>([]);

  useEffect(() => {
    const nextSeen = seenRef.current;
    state.events.forEach((ev: EventV2) => {
      if (ev.type !== "transfer" || !ev.road) return;
      const key = `${ev.hour}-${ev.road}`;
      if (nextSeen.has(key)) return;
      nextSeen.add(key);
      const id = `p-${key}-${Math.random().toString(36).slice(2, 6)}`;
      setParticles((p) => [...p, { id, road: ev.road!, startedAt: Date.now() }]);
    });
  }, [state.events]);

  // Identify outreach-this-hour nodes (pulse them).
  const outreachNodes = useMemo(() => {
    return new Set(
      state.outreach_schedule
        .filter((o) => o.hour === state.hour)
        .map((o) => o.node)
    );
  }, [state.outreach_schedule, state.hour]);

  return (
    <div className="panel relative h-full min-h-[560px] overflow-hidden p-0">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full"
      >
        {/* Faint district outline */}
        <defs>
          <radialGradient id="districtGradient" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="#0c1320" stopOpacity={0.7} />
            <stop offset="100%" stopColor="#05070a" stopOpacity={0} />
          </radialGradient>
          <pattern
            id="mapDots"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="0.6" fill="var(--ink-faint)" />
          </pattern>
        </defs>
        <rect
          x={0}
          y={0}
          width={VIEW_W}
          height={VIEW_H}
          fill="url(#districtGradient)"
        />
        <rect
          x={0}
          y={0}
          width={VIEW_W}
          height={VIEW_H}
          fill="url(#mapDots)"
          opacity={0.35}
        />

        {/* Roads */}
        {ROADS.map((edge) => (
          <MapRoad
            key={edge.key}
            edge={edge}
            status={state.roads[edge.key] ?? "open"}
          />
        ))}

        {/* Transfer particles */}
        <AnimatePresence>
          {particles.map((p) => (
            <TransferParticle
              key={p.id}
              road={p.road}
              onDone={() =>
                setParticles((arr) => arr.filter((x) => x.id !== p.id))
              }
            />
          ))}
        </AnimatePresence>

        {/* Nodes */}
        {NODE_KEYS.map((k) => (
          <MapNode
            key={k}
            nodeKey={k}
            data={state.nodes[k]}
            pulseOutreach={outreachNodes.has(k)}
            faded={hovered !== null && hovered !== k}
            onHover={setHovered}
          />
        ))}

        {/* Sensor-lie halos render last so they sit above */}
        {NODE_KEYS.map((k) =>
          state.nodes[k]?.sensor_lying ? (
            <SensorLieHalo key={`lie-${k}`} node={k} data={state.nodes[k]} />
          ) : null
        )}
      </svg>

      {/* Hover tooltip */}
      {hovered ? (
        <NodeTooltip
          nodeKey={hovered}
          data={state.nodes[hovered]}
          hour={state.hour}
        />
      ) : null}

      {/* Map legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
        <Legend color="var(--cold-cyan)" label="Open road" />
        <Legend color="var(--danger-red)" label="Closed" />
        <Legend color="var(--warn-amber)" label="Sensor lie" dashed />
        <Legend color="var(--signal-violet)" label="Outreach" />
      </div>

      {/* Static OSM geo overlay — wrapped in a local error boundary so even if
          this additive panel throws, the core mission-control map stays alive. */}
      <RoutesPanelErrorBoundary>
        <RoutesPanel routes={state.routes} />
      </RoutesPanelErrorBoundary>
    </div>
  );
}

/**
 * Custom equality: only re-render if node data or hour changes.
 * Ignores reference identity of the state object itself.
 */
function mapsAreEqual(a: TriangleMapProps, b: TriangleMapProps) {
  if (a.state.hour !== b.state.hour) return false;
  if (a.state.done !== b.state.done) return false;
  if (a.state.ethical_tension_active !== b.state.ethical_tension_active) return false;
  if (a.state.events.length !== b.state.events.length) return false;
  if (a.state.outreach_schedule.length !== b.state.outreach_schedule.length) return false;
  // Routes are static-but-late: undefined on first /reset, populated on the
  // first /state poll. Detect that one-time transition so RoutesPanel is
  // visible without waiting for autopilot to advance the hour.
  if (
    Object.keys(a.state.routes ?? {}).length !==
    Object.keys(b.state.routes ?? {}).length
  )
    return false;
  for (const k of NODE_KEYS) {
    const na = a.state.nodes[k];
    const nb = b.state.nodes[k];
    if (!na || !nb) return false;
    if (na.vials !== nb.vials) return false;
    if (na.sensor_reading !== nb.sensor_reading) return false;
    if (na.actual_temperature !== nb.actual_temperature) return false;
    if (na.sensor_lying !== nb.sensor_lying) return false;
    if (na.generator_on !== nb.generator_on) return false;
    if (na.generator_fuel_pct !== nb.generator_fuel_pct) return false;
    if (na.temperature_alarm !== nb.temperature_alarm) return false;
  }
  return true;
}

export const TriangleMap = memo(TriangleMapInner, mapsAreEqual);

function Legend({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-px w-6"
        style={{
          background: dashed ? "transparent" : color,
          backgroundImage: dashed
            ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 8px)`
            : undefined,
          height: 2,
        }}
      />
      {label}
    </span>
  );
}
