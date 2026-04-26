"use client";

/**
 * Mounts a Lenis smooth-scroll instance on the document root.
 *
 * Disabled on app-shell routes (/dashboard, /replay) and on touch devices
 * where native scroll behaves better. Lives in the root layout.
 */

import Lenis from "lenis";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const DISABLE_ROUTES = ["/dashboard", "/replay"];

export function SmoothScrollProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const disabled = DISABLE_ROUTES.some((r) => pathname?.startsWith(r));

  useEffect(() => {
    if (disabled) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const lenis = new Lenis({
      duration: 1.1,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });

    let rafId = 0;
    function raf(time: number) {
      lenis.raf(time);
      rafId = window.requestAnimationFrame(raf);
    }
    rafId = window.requestAnimationFrame(raf);

    return () => {
      window.cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, [disabled, pathname]);

  return <>{children}</>;
}
