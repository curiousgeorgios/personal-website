import { handle } from "@astrojs/cloudflare/handler";
import { printDeps } from "./lib/prints/config";
import { runScheduled } from "./lib/prints/cron";
import { writeSetting } from "./lib/prints/store";

export { PrintScheduler } from "./lib/prints/scheduler";

// The Worker's entry (spec 13.3): Astro answers requests; the five-minute cron places, reconciles, mails and polls
export default {
  async fetch(request, env, ctx) {
    const response = await handle(request, env, ctx);
    // /admin is private and owner-authenticated by the middleware. Visiting it arms the fallback once.
    // Fixture servers drive scheduled events explicitly, so background alarms must not race their assertions.
    if (!__TEST_HOOKS__ && response.status === 200 && /^\/admin\/?$/.test(new URL(request.url).pathname)) {
      ctx.waitUntil(env.PRINT_SCHEDULER.getByName("prints").ensureStarted().catch((error: unknown) => {
        console.error("prints: couldn't start the scheduler", error instanceof Error ? error.name : typeof error);
      }));
    }
    return response;
  },
  async scheduled(_controller, env, ctx) {
    const deps = printDeps(env, (promise) => ctx.waitUntil(promise));
    await runScheduled(deps);
    await writeSetting(deps.db, "cron_last_run_at", String(deps.now()), deps.now());
  },
} satisfies ExportedHandler<Env>;
