import type { NextConfig } from "next";

/**
 * Static export so the FastAPI Docker image (Python 3.11-slim) can serve
 * the whole frontend as flat HTML/JS/CSS without needing a Node.js
 * runtime in the deployed container. `trailingSlash: true` makes
 * routes like /start resolve to `out/start/index.html`, which is what
 * StaticFiles(html=True) wants.
 *
 * `images: { unoptimized: true }` is required by `output: 'export'` —
 * we don't use next/image yet, but the flag prevents future surprises.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
