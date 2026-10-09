import { DAY, type PrintDeps } from "./config";
import { settingStatement, type PrintSettings } from "./store";

/** A stored rate older than this quotes nothing: the buffer covers a week of movement, not a month (spec 16.4, tightened) */
export const RATE_MAX_AGE = 7 * DAY;

/** The stored rate to quote with, or null (prices are then closed to quotes) when there is none or its ECB date is over 7 days old */
export function freshRate(settings: Pick<PrintSettings, "rate" | "rateDate">, now: number): number | null {
  if (settings.rate === null || settings.rateDate === null) return null;
  const dated = Date.parse(`${settings.rateDate}T00:00:00Z`) / 1000;
  return Number.isFinite(dated) && now - dated <= RATE_MAX_AGE ? settings.rate : null;
}

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
  const { rates, date, base, amount } = (body ?? {}) as { rates?: { AUD?: unknown }; date?: unknown; base?: unknown; amount?: unknown };
  const rate = rates?.AUD;
  // An FX_URL edited to another base or amount would store a rate that isn't A$ per US$1
  if ((base !== undefined && base !== "USD") || (amount !== undefined && amount !== 1)) {
    console.error("prints: ignored an exchange rate that isn't A$ per US$1");
    return "ignored";
  }
  if (typeof rate !== "number" || !(rate >= 0.8 && rate <= 3) || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("prints: ignored an exchange rate outside 0.8 to 3, or without a date:", JSON.stringify(rate ?? null));
    return "ignored";
  }
  const now = deps.now();
  await deps.db.batch([settingStatement(deps.db, "usd_aud", String(rate), now), settingStatement(deps.db, "usd_aud_date", date, now)]);
  return "stored";
}
