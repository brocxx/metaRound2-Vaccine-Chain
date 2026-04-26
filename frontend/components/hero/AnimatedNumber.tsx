"use client";

/**
 * Smoothly counts from 0 → value the first time it enters the viewport.
 * Used by the hero "brief" stat grid so numbers dramatise on scroll-in.
 */

import { animate, useInView, useMotionValue, useTransform } from "framer-motion";
import { motion } from "framer-motion";
import { useEffect, useRef } from "react";

interface AnimatedNumberProps {
  value: number;
  digits?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  durationMs?: number;
}

export function AnimatedNumber({
  value,
  digits = 0,
  prefix = "",
  suffix = "",
  className,
  durationMs = 1100,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const mv = useMotionValue(0);
  const display = useTransform(mv, (n) => `${prefix}${n.toFixed(digits)}${suffix}`);

  useEffect(() => {
    if (!inView) return;
    const c = animate(mv, value, {
      duration: durationMs / 1000,
      ease: [0.22, 1, 0.36, 1],
    });
    return c.stop;
  }, [inView, value, durationMs, mv]);

  return (
    <motion.span ref={ref} className={className}>
      {display}
    </motion.span>
  );
}
