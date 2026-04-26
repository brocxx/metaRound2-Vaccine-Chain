"use client";

/**
 * Soft cyan ring that lags the cursor and snaps larger when hovering
 * `<a>`, `<button>`, or anything tagged with [data-cursor="snap"].
 *
 * Hidden on touch devices. Renders into a fixed overlay; pointer-events:
 * none so it never intercepts clicks.
 */

import { motion, useMotionValue, useSpring } from "framer-motion";
import { useEffect, useState } from "react";

const SIZE_DEFAULT = 22;
const SIZE_HOVER = 56;

export function ReactiveCursor() {
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const sx = useSpring(x, { stiffness: 240, damping: 28, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 240, damping: 28, mass: 0.6 });

  const [size, setSize] = useState(SIZE_DEFAULT);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    function onMove(e: MouseEvent) {
      x.set(e.clientX);
      y.set(e.clientY);
      if (!visible) setVisible(true);
    }
    function onOver(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const interactive =
        t.closest("a, button, [data-cursor='snap']") !== null;
      setSize(interactive ? SIZE_HOVER : SIZE_DEFAULT);
    }
    function onLeave() {
      setVisible(false);
    }
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseover", onOver);
    window.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseover", onOver);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, [x, y, visible]);

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[60] hidden md:block"
      style={{
        x: sx,
        y: sy,
        translateX: "-50%",
        translateY: "-50%",
        opacity: visible ? 1 : 0,
        mixBlendMode: "screen",
      }}
    >
      <motion.div
        animate={{ width: size, height: size }}
        transition={{ type: "spring", stiffness: 220, damping: 22 }}
        className="rounded-full border"
        style={{
          borderColor: "var(--cold-cyan)",
          boxShadow: "0 0 18px rgba(108,217,255,0.45)",
        }}
      />
    </motion.div>
  );
}
