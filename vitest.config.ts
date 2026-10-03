/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";

// Unit tests render components with Astro's container, without the Cloudflare adapter
// (the adapter starts its own Vite server, which clashes with Vitest's).
export default getViteConfig(
  { test: { include: ["tests/unit/**/*.test.ts"], environment: "node" } },
  { configFile: false, session: false },
);
