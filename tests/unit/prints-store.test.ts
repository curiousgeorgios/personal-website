import { beforeEach, describe, expect, test } from "vitest";
import { getOrder, loadPrices, readSettings, shipmentsOf, toPrices, toSettings, writeSetting } from "../../src/lib/prints/store";
import { insertOrder, NOW, printDb } from "./prints-fakes";
import { sqliteD1 } from "./sqlite-d1";

let db: D1Database;
beforeEach(() => {
  db = sqliteD1();
});

describe("migration 0007", () => {
  test("seeds the agreed price list and an 8% buffer, and no exchange rate", async () => {
    expect(await loadPrices(db)).toEqual({ small: { unframed: 5900, oak: 13900 }, medium: { unframed: 7900, oak: 17900 }, large: { unframed: 11900, oak: 25900 } });
    const settings = await readSettings(db);
    expect(settings.buffer).toBe(0.08);
    expect(settings.rate).toBeNull();
  });

  test("the schema refuses an unknown status, an eleventh line, bad shipments and a reused session", async () => {
    await expect(insertOrder(db, { status: "lost" })).rejects.toThrow();
    await expect(insertOrder(db, {}, Array.from({ length: 11 }, (): [string, "small", "oak", number] => ["fixture-b-01", "small", "oak", 1]))).rejects.toThrow();
    await expect(insertOrder(db, { shipments: "not json" })).rejects.toThrow();
    await insertOrder(db, { id: "01k0000000000000000000000a", stripe_session_id: "cs_test_same" });
    await expect(insertOrder(db, { id: "01k0000000000000000000000b", stripe_session_id: "cs_test_same" })).rejects.toThrow();
  });

  test("the schema refuses a fractional or negative amount in any money column", async () => {
    for (const column of ["print_total", "delivery_amount", "artelo_cost", "refunded_amount"]) {
      await expect(insertOrder(db, { [column]: 23800.5 })).rejects.toThrow();
      await expect(insertOrder(db, { [column]: -1 })).rejects.toThrow();
      await expect(insertOrder(db, { [column]: "twelve" })).rejects.toThrow();
    }
    const id = await insertOrder(db, { artelo_cost: 0, refunded_amount: 0, print_total: 0, delivery_amount: 0 });
    for (const amount of [5900.5, -5900]) {
      await expect(db.prepare("INSERT INTO print_order_items (order_id, line, photo_id, tier, size, frame, quantity, unit_amount) VALUES (?, 9, 'fixture-b-01', 'small', 'x8x12', 'oak', 1, ?)").bind(id, amount).run()).rejects.toThrow();
    }
    // Whole cents, nothing, or null where the column allows it
    await insertOrder(db, { artelo_cost: 6140, refunded_amount: 23800, print_total: 23800, delivery_amount: 4900 });
    await insertOrder(db, { artelo_cost: null, refunded_amount: null });
  });

  test("grants carry an order id", async () => {
    db = await printDb();
    await db.prepare("INSERT INTO photo_download_grants (id, photo_id, expires_at, order_id) VALUES ('g', 'fixture-01', 1, 'o')").run();
    expect(await db.prepare("SELECT order_id FROM photo_download_grants").first("order_id")).toBe("o");
  });
});

describe("prices and settings", () => {
  test("a missing price refuses to sell for nothing", () => {
    expect(() => toPrices([{ tier: "small", frame: "oak", amount: 13900 }])).toThrow("no print price for small unframed");
  });

  test("the rate counts only inside 0.8 to 3, the date only as YYYY-MM-DD, the buffer only inside 0 to 0.2", () => {
    const read = (rows: [string, string][]) => toSettings(rows.map(([key, value]) => ({ key, value })));
    expect(read([["usd_aud", "1.5237"], ["usd_aud_date", "2026-10-07"]])).toMatchObject({ rate: 1.5237, rateDate: "2026-10-07" });
    expect(read([["usd_aud", "0.5"]]).rate).toBeNull();
    expect(read([["usd_aud", "abc"], ["usd_aud_date", "07.10.26"]])).toMatchObject({ rate: null, rateDate: null });
    expect(read([["delivery_buffer", "0.5"]]).buffer).toBe(0.08);
    expect(read([["delivery_buffer", "0"]]).buffer).toBe(0);
    expect(read([["artelo_webhook_at", "1791000000"], ["artelo_webhook_missing", "1"], ["daily_fx_at", "5"]])).toMatchObject({ arteloWebhookAt: 1791000000, webhookMissing: true, daily: { fx: 5, webhook_check: 0, cleanup: 0 } });
  });

  test("writing a setting replaces it", async () => {
    await writeSetting(db, "delivery_buffer", "0.1", NOW);
    await writeSetting(db, "delivery_buffer", "0.12", NOW + 1);
    expect((await readSettings(db)).buffer).toBe(0.12);
    expect(await db.prepare("SELECT updated_at FROM print_settings WHERE key = 'delivery_buffer'").first("updated_at")).toBe(NOW + 1);
  });
});

test("an order reads back whole, with its shipments", async () => {
  const id = await insertOrder(db, { shipments: JSON.stringify([{ carrier: "ups", number: "1Z", url: "https://www.ups.com/track?tracknum=1Z" }]) });
  const order = await getOrder(db, id);
  expect(order).toMatchObject({ id, status: "paid", print_total: 23800, delivery_amount: 4900, delivery_taxed: 0, livemode: 0 });
  expect(shipmentsOf(order!)).toEqual([{ carrier: "ups", number: "1Z", url: "https://www.ups.com/track?tracknum=1Z" }]);
  expect(shipmentsOf({ shipments: null })).toEqual([]);
  // Only well-formed parcels survive: they render on the buyer's page
  expect(shipmentsOf({ shipments: JSON.stringify([{ carrier: "ups", number: "1Z", url: "https://x.test" }, { carrier: "ups", number: 5, url: "u" }, null, "x", { carrier: "ups" }]) })).toEqual([{ carrier: "ups", number: "1Z", url: "https://x.test" }]);
  expect(shipmentsOf({ shipments: "{}" })).toEqual([]);
  expect(await getOrder(db, "missing")).toBeNull();
});
