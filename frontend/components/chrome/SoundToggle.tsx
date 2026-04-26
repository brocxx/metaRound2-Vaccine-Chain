"use client";

import { useSound } from "@/lib/useSound";

export function SoundToggle() {
  const { enabled, toggle } = useSound();
  return (
    <button
      onClick={toggle}
      aria-label={enabled ? "Mute sound" : "Enable sound"}
      title={enabled ? "Sound on — click to mute" : "Sound off — click to enable"}
      className="group inline-flex items-center gap-2 rounded-full border border-[var(--line-strong)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)] transition-colors hover:border-[var(--cold-cyan)] hover:text-[var(--cold-cyan)]"
    >
      <span
        aria-hidden
        className="inline-flex h-1.5 w-1.5 rounded-full transition-colors"
        style={{
          background: enabled ? "var(--cold-cyan)" : "var(--ink-faint)",
          boxShadow: enabled ? "var(--glow-cyan)" : "none",
        }}
      />
      <span>{enabled ? "sound on" : "sound off"}</span>
    </button>
  );
}
