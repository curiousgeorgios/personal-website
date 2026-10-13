import { afterEach, expect, test, vi } from "vitest";
import { freshRate, refreshRate } from "../../src/lib/prints/fx";
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

test("a rate for another base or amount is ignored, as is a rate sent with an error status", async () => {
  captureLogs();
  const deps = withFx(() => json({ amount: 1, base: "USD", date: "2026-10-07", rates: { AUD: 1.5 } }));
  await refreshRate(deps);
  for (const body of [{ amount: 1, base: "EUR", date: "2026-10-07", rates: { AUD: 1.7 } }, { amount: 100, base: "USD", date: "2026-10-07", rates: { AUD: 1.7 } }]) {
    expect(await refreshRate(testDeps(deps.db, { fetch: fakeFetch({ "GET https://fx.test/latest": () => json(body) }).fetch }))).toBe("ignored");
  }
  const erroring = testDeps(deps.db, { fetch: fakeFetch({ "GET https://fx.test/latest": () => json({ date: "2026-10-07", rates: { AUD: 1.9 } }, 503) }).fetch });
  expect(await refreshRate(erroring)).toBe("failed");
  expect((await readSettings(deps.db)).rate).toBe(1.5);
});

test("a stored rate quotes for 7 days from its ecb date, then not at all", () => {
  // NOW is 2026-10-08T22:53:20Z
  const rate = (rateDate: string | null, value: number | null = 1.5) => freshRate({ rate: value, rateDate }, NOW);
  expect(rate("2026-10-08")).toBe(1.5);
  expect(rate("2026-10-02")).toBe(1.5);
  expect(rate("2026-10-01")).toBeNull();
  expect(rate("2026-06-01")).toBeNull();
  expect(rate(null)).toBeNull();
  expect(rate("2026-10-07", null)).toBeNull();
});
