"use client";

/**
 * Dither / noise hero background.
 *
 * The plan budgets 90 minutes for an R3F shader version of this; this is
 * the universally-compatible CSS fallback. Two layered SVG turbulence
 * filters drift slowly to give the cinematic "alive" feel without any
 * GPU cost or extra dependency surface.
 */

import { motion } from "framer-motion";

export function HeroDither() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* Big radial wash */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(110% 80% at 70% 10%, rgba(108,217,255,0.16), transparent 55%), radial-gradient(80% 60% at 0% 100%, rgba(178,134,255,0.10), transparent 60%)",
        }}
      />

      {/* SVG turbulence — slow drift */}
      <motion.svg
        className="absolute inset-0 h-full w-full"
        initial={{ opacity: 0.55 }}
        animate={{ opacity: [0.45, 0.7, 0.45] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <filter id="hero-noise" x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="2"
              seed="7"
            />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.42
                      0 0 0 0 0.85
                      0 0 0 0 1
                      0 0 0 0.18 0"
            />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter="url(#hero-noise)" />
      </motion.svg>

      {/* Coarser dither on top */}
      <motion.svg
        className="absolute inset-0 h-full w-full mix-blend-overlay"
        initial={{ opacity: 0.3 }}
        animate={{ opacity: [0.25, 0.4, 0.25] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut" }}
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <filter id="hero-noise-coarse" x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="turbulence"
              baseFrequency="0.024"
              numOctaves="2"
              seed="3"
            />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 1
                      0 0 0 0 1
                      0 0 0 0 1
                      0 0 0 0.22 0"
            />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter="url(#hero-noise-coarse)" />
      </motion.svg>

      {/* Faint scanlines for a CRT vibe */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.4) 0px, rgba(255,255,255,0.4) 1px, transparent 1px, transparent 3px)",
        }}
      />

      {/* Bottom fade so content reads cleanly */}
      <div
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background:
            "linear-gradient(to bottom, transparent, var(--bg-base) 90%)",
        }}
      />
    </div>
  );
}
