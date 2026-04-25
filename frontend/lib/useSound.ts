"use client";

/**
 * Tiny Web-Audio synth. No audio files needed — we generate three sounds
 * directly with oscillators / filtered noise so the bundle stays small
 * and the bible's "1 ambient hum, 1 alarm tick, 1 transfer chime" check
 * is satisfied.
 *
 * Mute is global, persisted to localStorage. The hook reads/writes it
 * and exposes play() helpers for the dashboard to call.
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "vaccine.sound.enabled";

let ctx: AudioContext | null = null;
let humNode: { osc: OscillatorNode; gain: GainNode } | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

function startHum(): void {
  const c = getCtx();
  if (!c || humNode) return;
  const osc = c.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 55;

  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 220;
  filter.Q.value = 0.6;

  const gain = c.createGain();
  gain.gain.value = 0;

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(c.destination);
  osc.start();
  gain.gain.linearRampToValueAtTime(0.025, c.currentTime + 1.2);
  humNode = { osc, gain };
}

function stopHum(): void {
  if (!humNode || !ctx) return;
  const { osc, gain } = humNode;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
  window.setTimeout(() => {
    try {
      osc.stop();
      osc.disconnect();
      gain.disconnect();
    } catch {
      /* ignore */
    }
    humNode = null;
  }, 500);
}

function alarmTick(): void {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(880, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(440, c.currentTime + 0.18);
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(0.18, c.currentTime + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.24);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.26);
}

function transferChime(): void {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(660, c.currentTime);
  osc.frequency.linearRampToValueAtTime(990, c.currentTime + 0.22);
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(0.18, c.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.6);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.62);
}

export function useSound() {
  const [enabled, setEnabledState] = useState<boolean>(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === "1") setEnabledState(true);
    } catch {
      /* ignore */
    }
  }, []);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (v) {
      const c = getCtx();
      if (c?.state === "suspended") c.resume().catch(() => {});
      startHum();
    } else {
      stopHum();
    }
  }, []);

  const toggle = useCallback(() => setEnabled(!enabled), [enabled, setEnabled]);

  const play = useCallback(
    (kind: "alarm" | "transfer") => {
      if (!enabled) return;
      if (kind === "alarm") alarmTick();
      else transferChime();
    },
    [enabled]
  );

  return { enabled, setEnabled, toggle, play };
}
