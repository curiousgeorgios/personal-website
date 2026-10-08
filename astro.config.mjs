import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import { cacheCloudflare } from "@astrojs/cloudflare/cache";
import { createHash } from "node:crypto";
import { NIGHT_POSTER } from "./src/scripts/night-poster.mjs";

// Test builds carry hooks for the e2e suite (TEST_HOOKS). ADMIN_BYPASS also skips Cloudflare Access on /admin, and is
// refused without TEST_HOOKS, so a production build can never contain it (spec 7).
const testBuild = process.env.TEST_HOOKS === "1";
const adminBypass = process.env.ADMIN_BYPASS === "1";
if (adminBypass && !testBuild) throw new Error("ADMIN_BYPASS=1 is only allowed with TEST_HOOKS=1 (bun run build:test or bun run dev:admin)");

export default defineConfig({
  site: "https://curiousgeorge.dev",
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  // No sessions: Astro must never set a cookie on this site
  session: false,
  // Route caching through Cloudflare's Worker cache; purged by tag from /admin (plan 3)
  cache: { provider: cacheCloudflare() },
  // Inline every stylesheet, so a page cached at the edge never references a hashed file a later deploy removed
  build: { inlineStylesheets: "always" },
  // No syntax highlighting: Shiki's inline styles conflict with the CSP
  markdown: { syntaxHighlight: false },
  vite: {
    // Test hooks (window.__deck, window.__deckScene) exist only in builds made with TEST_HOOKS=1 (bun run build:test)
    define: { __TEST_HOOKS__: JSON.stringify(testBuild), __ADMIN_BYPASS__: JSON.stringify(adminBypass) },
    // Astro inlines a page script below this limit when it has no imports and no dynamic imports. 24KB keeps the
    // deck runner inside the HTML, so a cached page never needs a hashed file to play a record. Other assets keep
    // Vite's default, so nothing else becomes a data: URL the CSP would block.
    build: { assetsInlineLimit: (file, content) => (file.endsWith(".js") ? content.length < 24 * 1024 : undefined) },
  },
  security: {
    // The middleware checks Origin on every write instead, so its 403s carry the security headers (Astro's skip them)
    checkOrigin: false,
    // Astro hashes inline scripts and styles and sends the policy as a response header; bundled files need 'self'
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "connect-src 'self'",
        "base-uri 'self'",
        // Chrome applies form-action to the redirect after a form post, and checkout is a post answered with a 303 to
        // Stripe's hosted page (spec 13.3)
        "form-action 'self' https://checkout.stripe.com",
        "frame-ancestors 'none'",
      ],
      // Astro hashes the scripts it bundles but not inline ones, so the night poster's script is hashed here, from the
      // same string Turntable.astro renders: an edit to one is an edit to both
      scriptDirective: { resources: ["'self'"], hashes: [`sha256-${createHash("sha256").update(NIGHT_POSTER).digest("base64")}`] },
      styleDirective: { resources: ["'self'"] },
    },
  },
});
