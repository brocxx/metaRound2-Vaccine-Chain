"use client";

/**
 * App-router template.tsx wraps every route in a fresh element on
 * navigation. We use it for short fade + upward drift transitions so
 * the SPA feels stitched together rather than nav-clicked.
 *
 * The dashboard and replay routes opt out — they're long-lived app shells
 * that re-render frequently from live polling and any wrapping enter-fade
 * makes those updates feel like flickers.
 */

import { motion } from "framer-motion";
import { usePathname } from "next/navigation";

const NO_TRANSITION_ROUTES = ["/dashboard", "/replay"];

export default function RouteTransitionTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const skip = NO_TRANSITION_ROUTES.some((r) => pathname?.startsWith(r));

  if (skip) {
    return <>{children}</>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="contents"
    >
      {children}
    </motion.div>
  );
}
