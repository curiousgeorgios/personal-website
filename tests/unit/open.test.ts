import { afterEach, expect, test, vi } from "vitest";
import { printsOpenNow, printsStatus } from "../../src/lib/prints/open";
import { printDb, testConfig } from "./prints-fakes";

afterEach(() => vi.restoreAllMocks());

test("open needs the switch, every secret and a stored rate, and says which is missing", () => {
  expect(printsStatus(testConfig(), 1.5)).toEqual({ open: true });
  expect(printsStatus(testConfig({ switchedOn: false }), 1.5)).toEqual({ open: false, reason: 'PRINTS_OPEN isn\'t "true"' });
  expect(printsStatus(testConfig({ missing: ["ARTELO_API_KEY"] }), 1.5)).toEqual({ open: false, reason: "this secret isn't set: ARTELO_API_KEY" });
  expect(printsStatus(testConfig({ missing: ["STRIPE_SECRET_KEY", "ARTELO_API_KEY", "PRINT_VIEW_SECRET"] }), 1.5)).toEqual({ open: false, reason: "these secrets aren't set: STRIPE_SECRET_KEY, ARTELO_API_KEY and PRINT_VIEW_SECRET" });
  expect(printsStatus(testConfig(), null)).toEqual({ open: false, reason: "no exchange rate has been fetched yet" });
});

test("printsOpenNow reads the rate only when it could open, and a failed read keeps prints closed", async () => {
  const db = await printDb();
  expect(await printsOpenNow(testConfig(), db)).toBe(true);
  const prepare = vi.fn(() => { throw new Error("D1 is down"); });
  expect(await printsOpenNow(testConfig({ switchedOn: false }), { prepare } as unknown as D1Database)).toBe(false);
  expect(prepare).not.toHaveBeenCalled();
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await printsOpenNow(testConfig(), { prepare } as unknown as D1Database)).toBe(false);
  await db.prepare("DELETE FROM print_settings WHERE key = 'usd_aud'").run();
  expect(await printsOpenNow(testConfig(), db)).toBe(false);
});
