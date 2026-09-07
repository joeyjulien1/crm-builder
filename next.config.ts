import type { NextConfig } from "next";

/**
 * `distDir` is overridable so a verification build can be run without touching
 * the directory a running `next dev` is serving from.
 *
 * A production build writes over the dev server's chunks and manifests, and the
 * running process then fails on files that no longer exist — "Cannot find
 * module './611.js'", or a module missing from the React Client Manifest. The
 * dev server has to be restarted to recover, which is a miserable way to find
 * out someone else built while you were working.
 *
 *   NEXT_DIST_DIR=.next-verify npx next build
 */
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: { ignoreBuildErrors: false },
  serverExternalPackages: ["pg", "pg-boss"],
};

export default nextConfig;
