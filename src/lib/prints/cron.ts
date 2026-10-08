import type { PrintDeps } from "./config";

/** One job of the five-minute run: a name for the log, and the work */
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

export async function runScheduled(deps: PrintDeps): Promise<void> {
  const failed = await runSteps(cronSteps(deps));
  console.log(failed.length > 0 ? `prints: cron ran; ${failed.join(", ")} failed` : "prints: cron ran");
}
