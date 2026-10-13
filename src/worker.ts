import { handle } from "@astrojs/cloudflare/handler";
import { printDeps } from "./lib/prints/config";
import { runScheduled } from "./lib/prints/cron";

// The Worker's entry (spec 13.3): Astro answers requests; the five-minute cron places, reconciles, mails and polls
export default {
  fetch: handle,
  async scheduled(_controller, env, ctx) {
    await runScheduled(printDeps(env, (promise) => ctx.waitUntil(promise)));
  },
} satisfies ExportedHandler<Env>;
