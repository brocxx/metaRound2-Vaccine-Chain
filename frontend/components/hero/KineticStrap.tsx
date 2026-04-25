const ITEMS = [
  "BRIEFING",
  "REASONING",
  "TRANSFER",
  "REFUEL",
  "DO_NOTHING",
  "SENSOR_LIE",
  "FLOOD",
  "OUTREACH",
  "ETHICAL_TENSION",
  "TRUCK_ETA",
  "BARMER",
  "BALOTRA",
  "SINDHARI",
];

export function KineticStrap() {
  const reel = [...ITEMS, ...ITEMS, ...ITEMS, ...ITEMS];

  return (
    <div
      aria-hidden
      className="relative overflow-hidden border-y border-[var(--line)] bg-[var(--bg-panel)] py-5"
    >
      <div className="marquee">
        {reel.map((label, i) => (
          <span
            key={`${label}-${i}`}
            className="mx-8 inline-flex items-center gap-3 font-mono text-sm tracking-[0.3em] text-[var(--ink-secondary)]"
          >
            <span className="text-[var(--cold-cyan)]">●</span>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
