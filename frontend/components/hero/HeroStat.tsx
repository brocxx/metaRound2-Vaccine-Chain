interface HeroStatProps {
  label: string;
  /** Either a fixed string (e.g. "Brief + lie + flood") or a renderable
   *  node — pass an <AnimatedNumber/> for the count-up effect. */
  value: React.ReactNode;
  detail?: string;
}

export function HeroStat({ label, value, detail }: HeroStatProps) {
  return (
    <div className="group flex flex-col gap-3 bg-[var(--bg-panel)] p-7 transition-colors hover:bg-[var(--bg-elev)]">
      <span className="label-mono">{label}</span>
      <span className="text-3xl font-medium tracking-tight tabular-nums md:text-4xl">
        {value}
      </span>
      {detail ? (
        <span className="font-mono text-xs text-[var(--ink-muted)]">
          {detail}
        </span>
      ) : null}
    </div>
  );
}
