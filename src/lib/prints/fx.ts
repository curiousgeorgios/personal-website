import type { PrintDeps } from "./config";
import { settingStatement } from "./store";

/**
 * The European Central Bank's reference rate from Frankfurter (no key, no visitor data), into print_settings (spec 16.4).
 * "ignored" (a rate outside 0.8 to 3, or no date) counts as done for the day, so a bad answer isn't logged every five
 * minutes; "failed" (no answer) is tried again on the next run.
 */
export async function refreshRate(deps: PrintDeps): Promise<"stored" | "ignored" | "failed"> {
  let body: unknown;
  try {
    const response = await deps.fetch(deps.config.fxUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      console.error("prints: the exchange rate answered", response.status);
      return "failed";
    }
    body = await response.json();
  } catch (error) {
    console.error("prints: couldn't fetch the exchange rate", error instanceof Error ? error.message : String(error));
    return "failed";
  }
  const { rates, date } = (body ?? {}) as { rates?: { AUD?: unknown }; date?: unknown };
  const rate = rates?.AUD;
  if (typeof rate !== "number" || !(rate >= 0.8 && rate <= 3) || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("prints: ignored an exchange rate outside 0.8 to 3, or without a date:", JSON.stringify(rate ?? null));
    return "ignored";
  }
  const now = deps.now();
  await deps.db.batch([settingStatement(deps.db, "usd_aud", String(rate), now), settingStatement(deps.db, "usd_aud_date", date, now)]);
  return "stored";
}
