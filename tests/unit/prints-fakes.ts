import { vi } from "vitest";
import { ulid } from "../../src/lib/admin/ulid";
import { offerFor, printsFor, type Frame, type Tier } from "../../src/lib/prints/catalogue";
import type { PrintConfig, PrintDeps } from "../../src/lib/prints/config";
import type { OrderStatus } from "../../src/lib/prints/store";
import { sqliteD1 } from "./sqlite-d1";

// Shared by the print unit tests: a config, deps, a store holding the e2e fixture's print photographs, orders and a fetch
// that answers from a table, so no test reaches Stripe, Artelo or the exchange rate.

/** 2026-10-08T22:53:20Z */
export const NOW = 1_791_500_000;
export const PHOTO_KEY = "1".repeat(64);
export const VIEW_SECRET = "2".repeat(64);
export const SHA = "e5".repeat(32);

export const ADDRESS = { name: "Ada Lovelace", line1: "12 Example Street", line2: "Unit 3", city: "Bondi Beach", state: "NSW", postcode: "2026", country: "AU", phone: "+61 400 000 000" };
export const US_ADDRESS = { name: "Grace Hopper", line1: "1600 Example Avenue", line2: "", city: "Arlington", state: "VA", postcode: "22201", country: "US", phone: "+1 202 555 0100" };

export function testConfig(over: Partial<PrintConfig> = {}): PrintConfig {
  return {
    switchedOn: true, sellerName: "george vlachos", gst: "none", gstTaxRate: "", fromEmail: "prints@curiousgeorge.dev",
    siteOrigin: "https://curiousgeorge.dev", adminEmail: "hello@curiousgeorge.dev", arteloBase: "https://artelo.test", stripeBase: "https://stripe.test",
    fxUrl: "https://fx.test/latest",
    secrets: {
      STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture", ARTELO_API_KEY: "artelo-fixture-key",
      ARTELO_WEBHOOK_SECRET: "artelo-fixture-webhook-secret", PRINT_VIEW_SECRET: VIEW_SECRET, PHOTO_LINK_SECRET: PHOTO_KEY,
    },
    missing: [], retryWindow: 86_400, emailSink: null, testClients: false,
    ...over,
  };
}

export type Handler = (request: Request) => Response | Promise<Response>;
export interface Call {
  method: string;
  url: string;
  body: string;
  headers: Headers;
}

/** A fetch answering "METHOD origin+path" from the table and recording every call; anything unanswered is a network error */
export function fakeFetch(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push({ method: request.method, url: request.url, body: await request.clone().text(), headers: request.headers });
    const handler = handlers[`${request.method} ${url.origin}${url.pathname}`];
    if (!handler) throw new TypeError(`fetch failed: nothing answers ${request.method} ${url.origin}${url.pathname}`);
    return handler(request);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

export const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

/** PHOTO_PRINTS with every master present except those of the photographs named */
export const masters = (missing: string[] = []) =>
  ({ head: vi.fn(async (key: string) => (missing.some((id) => key.startsWith(`prints/${id}/`)) ? null : { size: 1000, httpMetadata: { contentType: "image/jpeg" } })) }) as unknown as R2Bucket;

export function testDeps(db: D1Database, over: Partial<PrintDeps> = {}): PrintDeps & { waited: Promise<unknown>[] } {
  const waited: Promise<unknown>[] = [];
  return { db, config: testConfig(), fetch: fakeFetch({}).fetch, now: () => NOW, photoPrints: masters(), email: null, waitUntil: (promise) => void waited.push(promise), waited, ...over };
}

const previews = (id: string, width: number, height: number) =>
  [240, 480].flatMap((size) => {
    const scale = size / Math.max(width, height);
    return (["webp", "avif"] as const).map((format) => ({ key: `photos/previews/${id}/${SHA}/${size}.${format}`, width: Math.round(width * scale), height: Math.round(height * scale), format }));
  });

/**
 * The e2e fixture's print-relevant photographs (spec 11.3): fixture-b-01 (4000 × 6000) and fixture-b-02 (6000 × 4000)
 * get all three sizes, fixture-01 and fixture-02 (2048 square) small only, fixture-03 is hidden and fixture-c-01
 * (1200 × 1800) gets none. A rate of 1.50 is stored, as the e2e servers seed it.
 */
export async function printDb(): Promise<D1Database> {
  const db = sqliteD1();
  const posts: [string, string, string | null][] = [["fixture", "2026-09-27T18:30:00+10:00", "bondi, sydney"], ["fixture-b", "2026-06-14T09:15:00+10:00", null], ["fixture-c", "2026-03-01T12:00:00+11:00", "fremantle, perth"]];
  for (const [collection, at, place] of posts) {
    await db.prepare("INSERT INTO photo_posts (collection, published_at, published_on, place) VALUES (?, ?, ?, ?)").bind(collection, Date.parse(at) / 1000, at.slice(0, 10), place).run();
  }
  const photos: [string, string, number, number, number, string][] = [
    ["fixture-01", "fixture", 2048, 2048, 1, "a test photograph"], ["fixture-02", "fixture", 2048, 2048, 1, ""], ["fixture-03", "fixture", 2048, 2048, 0, ""],
    ["fixture-b-01", "fixture-b", 4000, 6000, 1, ""], ["fixture-b-02", "fixture-b", 6000, 4000, 1, ""], ["fixture-c-01", "fixture-c", 1200, 1800, 1, ""],
  ];
  for (const [position, [id, collection, width, height, published, title]] of photos.entries()) {
    await db.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, collection, position, title, published, JSON.stringify(previews(id, width, height)), `prints/${id}/${SHA}.jpg`, width, height, 1000, SHA).run();
  }
  await db.prepare("INSERT INTO print_settings (key, value, updated_at) VALUES ('usd_aud', '1.5', 0), ('usd_aud_date', '2026-10-07', 0)").run();
  return db;
}

const PRICES: Record<Tier, Record<Frame, number>> = { small: { unframed: 5900, oak: 13900 }, medium: { unframed: 7900, oak: 17900 }, large: { unframed: 11900, oak: 25900 } };
const DIMENSIONS: Record<string, [number, number]> = { "fixture-01": [2048, 2048], "fixture-02": [2048, 2048], "fixture-b-01": [4000, 6000], "fixture-b-02": [6000, 4000] };

/**
 * An order (paid by default: due now, a day to place it) with its lines, sizes and prices as checkout would write them.
 * `columns` overrides any print_orders column. Returns its id.
 */
export async function insertOrder(db: D1Database, columns: Record<string, string | number | null> = {}, lines: [string, Tier, Frame, number][] = [["fixture-b-01", "medium", "oak", 1], ["fixture-b-02", "small", "unframed", 1]]): Promise<string> {
  const id = typeof columns.id === "string" ? columns.id : ulid(NOW * 1000);
  const printTotal = lines.reduce((sum, [, tier, frame, quantity]) => sum + PRICES[tier][frame] * quantity, 0);
  const row: Record<string, string | number | null> = {
    id, country: "AU", print_total: printTotal, delivery_amount: 4900, delivery_taxed: 0, status: "paid" satisfies OrderStatus, livemode: 0,
    stripe_session_id: `cs_test_${id}`, stripe_payment_intent: `pi_test_${id}`, attempts: 0, next_attempt_at: NOW, retry_until: NOW + 86_400,
    created_at: NOW - 600, paid_at: NOW - 60, updated_at: NOW,
    ...columns,
  };
  const names = Object.keys(row);
  await db.batch([
    db.prepare(`INSERT INTO print_orders (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).bind(...names.map((name) => row[name])),
    ...lines.map(([photoId, tier, frame, quantity], index) => {
      const [width, height] = DIMENSIONS[photoId] ?? [4000, 6000];
      const size = offerFor(printsFor(width, height), tier)?.size.size ?? "";
      return db.prepare("INSERT INTO print_order_items (order_id, line, photo_id, tier, size, frame, quantity, unit_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, index + 1, photoId, tier, size, frame, quantity, PRICES[tier][frame]);
    }),
  ]);
  return id;
}

/** Every row of every table as one string, to prove what is never stored */
export async function dumpDb(db: D1Database): Promise<string> {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results as { name: string }[];
  const rows = await Promise.all(tables.map(async ({ name }) => JSON.stringify((await db.prepare(`SELECT * FROM "${name}"`).all()).results)));
  return rows.join("\n");
}

/** Silences the console and returns everything it was given, to prove what is never logged */
export function captureLogs(): () => string {
  const spies = (["log", "warn", "error"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
  return () => spies.flatMap((spy) => spy.mock.calls.map((args) => args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "))).join("\n");
}
