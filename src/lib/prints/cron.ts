import type { PrintDeps } from "./config";

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
  void deps;
  return [];
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
