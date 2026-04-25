import Link from "next/link";

import { SoundToggle } from "./SoundToggle";

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--bg-base)]/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-6 md:px-12">
        <Link href="/" className="flex items-center gap-3">
          <span
            aria-hidden
            className="block h-6 w-6 rounded-full border border-[var(--cold-cyan)]"
            style={{ boxShadow: "var(--glow-cyan)" }}
          />
          <span className="font-mono text-sm tracking-wider text-[var(--ink-primary)]">
            COLDCHAIN/
            <span className="text-[var(--cold-cyan)]">OPENENV</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          <Link
            href="/start"
            className="label-mono transition-colors hover:text-[var(--ink-primary)]"
          >
            Start
          </Link>
          <Link
            href="/dashboard"
            className="label-mono transition-colors hover:text-[var(--ink-primary)]"
          >
            Mission Control
          </Link>
          <Link
            href="/before-after"
            className="label-mono transition-colors hover:text-[var(--ink-primary)]"
          >
            Before / After
          </Link>
          <Link
            href="/replay"
            className="label-mono transition-colors hover:text-[var(--ink-primary)]"
          >
            Replay
          </Link>
          <a
            href="https://github.com/brocxx/Vaccine-Cold-Chain-OpenEnv"
            target="_blank"
            rel="noreferrer"
            className="label-mono transition-colors hover:text-[var(--ink-primary)]"
          >
            Source ↗
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <SoundToggle />
          <span className="label-mono hidden md:inline">v0.1.0</span>
        </div>
      </div>
    </header>
  );
}
