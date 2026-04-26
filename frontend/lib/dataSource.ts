"use client";

/**
 * Single switch deciding whether the dashboard reads the mock trace or
 * polls the live FastAPI backend.
 *
 * Order of precedence (first hit wins):
 *   1. ?live=1 / ?live=0 in the URL          (per-tab override)
 *   2. NEXT_PUBLIC_USE_LIVE env var          (build-time default)
 *   3. "mock"                                 (fallback)
 */

import { useSearchParams } from "next/navigation";

export type DataSource = "mock" | "live";

export function useDataSource(): DataSource {
  const params = useSearchParams();
  const q = params?.get("live");
  if (q === "1") return "live";
  if (q === "0") return "mock";
  return process.env.NEXT_PUBLIC_USE_LIVE === "1" ? "live" : "mock";
}
