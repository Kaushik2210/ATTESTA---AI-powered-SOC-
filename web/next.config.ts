import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The repo root also carries a package-lock.json (for root-level
  // tooling: license-checker, playwright, axe-core -- see
  // eval/ui/gate.mjs), which otherwise makes Next.js guess at the
  // workspace root. Pin it explicitly to web/ itself.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
