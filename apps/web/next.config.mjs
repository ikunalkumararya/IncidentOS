import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
 * The API server reads the repo-root .env through dotenv; Next only looks in
 * its own directory. Load the same file here so server-only values — the
 * webhook secret the /api/report handler signs with — reach route handlers in
 * dev and in `next start`. On a platform that injects real environment
 * variables there is no file and this is a no-op.
 *
 * Nothing loaded here is added to `env` below. Every key in that block is
 * inlined into the client bundle at build time, so a secret placed there would
 * ship to the browser.
 */
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** @type {import('next').NextConfig} */
const nextConfig = {
  /*
   * `next build` writes to the same directory `next dev` is serving from, so a
   * verification build run against a live dev server replaces the chunks it has
   * already handed the browser and breaks it until restart. Setting
   * NEXT_DIST_DIR sends such a build somewhere harmless.
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  async rewrites() {
    const backend = (process.env.API_INTERNAL_URL || (process.env.NODE_ENV !== "production" ? "http://localhost:4000" : "" )).replace(/\/$/, "");
    return {
      fallback: backend
        ? [{ source: "/api/:path*", destination: `${backend}/api/:path*` }]
        : [],
    };
  },
  env: {
    NEXT_PUBLIC_API_BASE: process.env.VERCEL ? "" : (process.env.NEXT_PUBLIC_API_BASE ?? ""),
    // Mirrored from the server's DEMO_USER_* so the sign-in page's one-click
    // demo button stays in step with the account that is actually seeded.
    NEXT_PUBLIC_DEMO_EMAIL: process.env.DEMO_USER_EMAIL ?? "demo@incidentos.dev",
    NEXT_PUBLIC_DEMO_PASSWORD: process.env.DEMO_USER_PASSWORD ?? "incident123",
  },
};
export default nextConfig;
