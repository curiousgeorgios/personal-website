import type { PrintConfig } from "./config";
import { readSettings } from "./store";

// Prints are open when PRINTS_OPEN is "true", every print secret is set and an exchange rate is stored (spec 16.5)

export type PrintsStatus = { open: true } | { open: false; reason: string };

const list = (names: readonly string[]) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** Whether prints could open before anything is read: the switch and the secrets */
export const canOpen = (config: PrintConfig) => config.switchedOn && config.missing.length === 0;

export function printsStatus(config: PrintConfig, rate: number | null): PrintsStatus {
  if (!config.switchedOn) return { open: false, reason: 'PRINTS_OPEN isn\'t "true"' };
  if (config.missing.length > 0) return { open: false, reason: `${config.missing.length === 1 ? "this secret isn't" : "these secrets aren't"} set: ${list(config.missing)}` };
  if (rate === null) return { open: false, reason: "no exchange rate has been fetched yet" };
  return { open: true };
}

/** For a page's line: no D1 read while prints are switched off, and closed if the read fails */
export async function printsOpenNow(config: PrintConfig, db: D1Database): Promise<boolean> {
  if (!canOpen(config)) return false;
  try {
    return printsStatus(config, (await readSettings(db)).rate).open;
  } catch (error) {
    console.error("prints: couldn't read whether prints are open", error instanceof Error ? error.message : String(error));
    return false;
  }
}
