import type { PrintDeps } from "./config";
import { refreshRate } from "./fx";
import { sendDueMail } from "./mail";
import { readSettings, writeSetting, type DailyJob } from "./store";

/** A daily job runs when its timestamp is this old: 20 hours, so a five-minute cron drifting never skips a day */
export const DAILY_EVERY = 20 * 3600;

/** Runs a daily job (spec 18.6) when its print_settings timestamp is over 20 hours old, and records the time once it is done */
export async function daily(deps: PrintDeps, job: DailyJob, run: () => Promise<boolean>): Promise<void> {
  const settings = await readSettings(deps.db);
  if (deps.now() - settings.daily[job] < DAILY_EVERY) return;
  if (await run()) await writeSetting(deps.db, `daily_${job}_at`, String(deps.now()), deps.now());
}

/** One job of the five-minute run: a name for the log, and the work. The work resolves to something truthy (a count of what
 * it handled, say) when it did something, and to nothing, false or 0 when there was nothing to do */
export type CronStep = readonly [name: string, run: () => Promise<unknown>];

/** Runs every step in order, each in its own try, so one failure doesn't stop the rest (spec 18.6); returns the names that failed */
export async function runSteps(steps: readonly CronStep[]): Promise<string[]> {
  const failed: string[] = [];
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (error) {
      failed.push(name);
      console.error(`prints: the cron's ${name} step failed`, error instanceof Error ? error.message : String(error));
    }
  }
  return failed;
}

/** The five-minute run's steps, in spec 18.6's order. The webhooks are the accelerator; this is the guarantee */
export function cronSteps(deps: PrintDeps): CronStep[] {
  return [
    ["unsent emails", () => sendDueMail(deps)],
    ["exchange rate", () => daily(deps, "fx", async () => (await refreshRate(deps)) !== "failed")],
  ];
}

/** Runs the steps and logs only a run where a step did something or failed, so a quiet run every five minutes leaves no line */
export async function runScheduled(deps: PrintDeps, steps: readonly CronStep[] = cronSteps(deps)): Promise<void> {
  const busy: string[] = [];
  const failed = await runSteps(
    steps.map(([name, run]): CronStep => [name, async () => { if (await run()) busy.push(name); }]),
  );
  if (failed.length > 0) console.log(`prints: cron ran; ${failed.join(", ")} failed`);
  else if (busy.length > 0) console.log(`prints: cron ran; ${busy.join(", ")} did work`);
}
