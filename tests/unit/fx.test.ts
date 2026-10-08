import { afterEach, expect, test, vi } from "vitest";
import { refreshRate } from "../../src/lib/prints/fx";
import { readSettings } from "../../src/lib/prints/store";
import { captureLogs, fakeFetch, json, NOW, testDeps, type Handler } from "./prints-fakes";
import { sqliteD1 } from "./sqlite-d1";

const withFx = (handler: Handler) => testDeps(sqliteD1(), { fetch: fakeFetch({ "GET https://fx.test/latest": handler }).fetch });

afterEach(() => vi.restoreAllMocks());

test("stores the ecb's rate and date from frankfurter's answer", async () => {
  const deps = withFx(() => json({ amount: 1, base: "USD", date: "2026-10-07", rates: { AUD: 1.5237 } }));
  expect(await refreshRate(deps)).toBe("stored");
  expect(await readSettings(deps.db)).toMatchObject({ rate: 1.5237, rateDate: "2026-10-07" });
  expect(await deps.db.prepare("SELECT updated_at FROM print_settings WHERE key = 'usd_aud'").first("updated_at")).toBe(NOW);
});

test("a rate outside 0.8 to 3, or without a date, is ignored and logged, and the stored one kept", async () => {
  const logs = captureLogs();
  const deps = withFx(() => json({ date: "2026-10-07", rates: { AUD: 1.5 } }));
  await refreshRate(deps);
  for (const body of [{ date: "2026-10-07", rates: { AUD: 15 } }, { date: "2026-10-07", rates: { AUD: 0.5 } }, { rates: { AUD: 1.6 } }, { date: "2026-10-07", rates: {} }]) {
    const odd = testDeps(deps.db, { fetch: fakeFetch({ "GET https://fx.test/latest": () => json(body) }).fetch });
    expect(await refreshRate(odd)).toBe("ignored");
  }
  expect((await readSettings(deps.db)).rate).toBe(1.5);
  expect(logs()).toContain("prints: ignored an exchange rate");
});

test("a failed fetch changes nothing and says it failed", async () => {
  captureLogs();
  expect(await refreshRate(withFx(() => new Response("down", { status: 503 })))).toBe("failed");
  expect(await refreshRate(withFx(() => { throw new TypeError("network"); }))).toBe("failed");
  expect(await refreshRate(withFx(() => new Response("not json")))).toBe("failed");
});
