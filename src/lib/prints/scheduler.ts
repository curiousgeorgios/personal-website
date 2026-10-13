import { DurableObject } from "cloudflare:workers";
import { printDeps } from "./config";
import { runScheduled } from "./cron";
import { writeSetting } from "./store";

export const PRINT_INTERVAL_MS = 5 * 60_000;

// A private, persistent fallback for a Cron Trigger that is registered but never dispatched (ADR-0031).
export class PrintScheduler extends DurableObject<Env> {
  async ensureStarted(): Promise<void> {
    await this.ctx.storage.transaction(async (storage) => {
      if (await storage.getAlarm() === null) await storage.setAlarm(Date.now() + 5_000);
    });
  }

  async alarm(): Promise<void> {
    // Schedule first: a provider or database outage must not stop tomorrow's attempts.
    const next = Date.now() + PRINT_INTERVAL_MS;
    await this.ctx.storage.setAlarm(next);
    const deps = printDeps(this.env, (promise) => this.ctx.waitUntil(promise));
    const now = deps.now();
    await writeSetting(deps.db, "alarm_last_checked_at", String(now), now);
    await writeSetting(deps.db, "alarm_next_at", String(Math.floor(next / 1000)), now);
    const cron = await deps.db.prepare("SELECT value FROM print_settings WHERE key = 'cron_last_run_at'").first<{ value: string }>();
    // A healthy cron already guarantees the same work. Existing per-order leases tolerate at-least-once delivery.
    const lastCron = Number(cron?.value);
    if (Number.isFinite(lastCron) && lastCron <= now && now - lastCron < PRINT_INTERVAL_MS / 1000) return;
    await runScheduled(deps);
    await writeSetting(deps.db, "alarm_last_run_at", String(deps.now()), deps.now());
  }
}
