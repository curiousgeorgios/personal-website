import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import { cacheCloudflare } from "@astrojs/cloudflare/cache";

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
    define: { __TEST_HOOKS__: JSON.stringify(process.env.TEST_HOOKS === "1") },
    // Astro inlines a page script below this limit when it has no imports and no dynamic imports. 24KB keeps the
    // deck runner inside the HTML, so a cached page never needs a hashed file to play a record. Other assets keep
    // Vite's default, so nothing else becomes a data: URL the CSP would block.
    build: { assetsInlineLimit: (file, content) => (file.endsWith(".js") ? content.length < 24 * 1024 : undefined) },
  },
  security: {
    // Astro hashes inline scripts and styles and sends the policy as a response header; bundled files need 'self'
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ],
      scriptDirective: { resources: ["'self'"] },
      styleDirective: { resources: ["'self'"] },
    },
  },
});
