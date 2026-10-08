import { photoName, previewOf } from "../photos/gallery";
import { previewSize, type Preview, type PublicPreview } from "../photos/store";
import type { QuoteLine } from "./artelo";
import { itemsValue, printCount, validate, type BasketLine, type RawEntry } from "./basket";
import { FRAMES, TIERS, offerFor, printsFor, type Frame, type Tier } from "./catalogue";

// The prints tables (migration 0007): the fixed price list, the settings and the orders. Addresses are never written
// here (spec 21.2): an order row holds its country, amounts, ids, statuses and bookkeeping, nothing personal.

/** AUD cents by tier and frame (spec 14.2) */
export type PriceList = Record<Tier, Record<Frame, number>>;

export const PRICES_SQL = "SELECT tier, frame, amount FROM print_prices";

export function toPrices(rows: readonly { tier: string; frame: string; amount: number }[]): PriceList {
  const prices = Object.fromEntries(TIERS.map((tier) => [tier, Object.fromEntries(FRAMES.map((frame) => [frame, 0]))])) as PriceList;
  for (const row of rows) {
    if ((TIERS as readonly string[]).includes(row.tier) && (FRAMES as readonly string[]).includes(row.frame)) prices[row.tier as Tier][row.frame as Frame] = row.amount;
  }
  // A missing price would sell a print for nothing: refuse to carry on
  for (const tier of TIERS) for (const frame of FRAMES) if (!(prices[tier][frame] > 0)) throw new Error(`no print price for ${tier} ${frame}`);
  return prices;
}

export async function loadPrices(db: D1Database): Promise<PriceList> {
  return toPrices((await db.prepare(PRICES_SQL).all()).results as unknown as { tier: string; frame: string; amount: number }[]);
}

/** The daily jobs of spec 18.6, each with its own timestamp in print_settings (daily_<job>_at) */
export type DailyJob = "fx" | "webhook_check" | "cleanup";

export const DEFAULT_BUFFER = 0.08;

export interface PrintSettings {
  /** Added to Artelo's delivery for exchange-rate movement: 0 to 0.2 (spec 16.4) */
  buffer: number;
  /** A$ per US$1, the ECB's, or null when none is stored (prints are then closed) */
  rate: number | null;
  /** The ECB's date for the rate, YYYY-MM-DD */
  rateDate: string | null;
  /** When Artelo's webhook last arrived (seconds) */
  arteloWebhookAt: number | null;
  /** The daily check found no webhook at Artelo */
  webhookMissing: boolean;
  /** When each daily job last ran (seconds; 0 for never) */
  daily: Record<DailyJob, number>;
}

export const SETTINGS_SQL = "SELECT key, value FROM print_settings";

export function toSettings(rows: readonly { key: string; value: string }[]): PrintSettings {
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const number = (key: string) => {
    const value = values.get(key);
    const parsed = value === undefined || value.trim() === "" ? Number.NaN : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const buffer = number("delivery_buffer");
  const rate = number("usd_aud");
  const rateDate = values.get("usd_aud_date") ?? null;
  return {
    buffer: buffer !== null && buffer >= 0 && buffer <= 0.2 ? buffer : DEFAULT_BUFFER,
    rate: rate !== null && rate >= 0.8 && rate <= 3 ? rate : null,
    rateDate: rateDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(rateDate) ? rateDate : null,
    arteloWebhookAt: number("artelo_webhook_at"),
    webhookMissing: values.get("artelo_webhook_missing") === "1",
    daily: { fx: number("daily_fx_at") ?? 0, webhook_check: number("daily_webhook_check_at") ?? 0, cleanup: number("daily_cleanup_at") ?? 0 },
  };
}

export async function readSettings(db: D1Database): Promise<PrintSettings> {
  return toSettings((await db.prepare(SETTINGS_SQL).all()).results as unknown as { key: string; value: string }[]);
}

export const settingStatement = (db: D1Database, key: string, value: string, now: number) =>
  db.prepare("INSERT INTO print_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(key, value, now);

export async function writeSetting(db: D1Database, key: string, value: string, now: number): Promise<void> {
  await settingStatement(db, key, value, now).run();
}

export type OrderStatus = "checkout" | "expired" | "paid" | "needs_attention" | "placed" | "in_production" | "shipped" | "delivered" | "cancelled" | "refunded";

/** A parcel's tracking, as stored in print_orders.shipments: a parcel's details, not a person's */
export interface Shipment {
  carrier: string;
  number: string;
  url: string;
}

export interface OrderRow {
  id: string;
  country: string;
  print_total: number;
  delivery_amount: number;
  delivery_taxed: number;
  status: OrderStatus;
  attention_reason: string | null;
  livemode: number;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  artelo_order_id: string | null;
  artelo_status: string | null;
  artelo_cost: number | null;
  shipments: string | null;
  refunded_amount: number | null;
  attempts: number;
  next_attempt_at: number | null;
  retry_until: number | null;
  lease_until: number | null;
  created_at: number;
  paid_at: number | null;
  placed_at: number | null;
  shipped_at: number | null;
  refunded_at: number | null;
  status_checked_at: number | null;
  shipped_email_at: number | null;
  attention_notified_at: number | null;
  /** 0 while George's cancellation email or his payment-whose-stripe-webhook-never-arrived email is due, then when it went; null when none is due */
  admin_notified_at: number | null;
  updated_at: number;
}

export async function getOrder(db: D1Database, id: string): Promise<OrderRow | null> {
  return db.prepare("SELECT * FROM print_orders WHERE id = ?").bind(id).first<OrderRow>();
}

export function shipmentsOf(order: Pick<OrderRow, "shipments">): Shipment[] {
  if (!order.shipments) return [];
  const parsed: unknown = JSON.parse(order.shipments);
  if (!Array.isArray(parsed)) return [];
  // These render on the buyer's page and in /admin: keep only parcels with all three fields as strings
  return parsed.filter((item): item is Shipment => !!item && typeof item === "object" && ["carrier", "number", "url"].every((key) => typeof (item as Record<string, unknown>)[key] === "string"));
}

/** A photograph as a basket, an order and an email name and show it */
export interface BasketPhoto {
  id: string;
  title: string;
  /** Its post's date, YYYY-MM-DD */
  date: string;
  width: number;
  height: number;
  /** Its place among its post's published photographs (plus itself when hidden), for its name (spec 4) */
  index: number;
  total: number;
  published: boolean;
  /** Its 240 and 480 previews */
  previews: PublicPreview[];
}

export interface FactRow {
  id: string;
  title: string;
  print_width: number;
  print_height: number;
  previews: string;
  published: number;
  published_on: string;
  idx: number;
  total: number;
}

/** What naming and showing a photograph needs, joined to its post; the caller adds the WHERE */
export const PHOTO_FACTS = `SELECT photos.id, photos.title, photos.print_width, photos.print_height, photos.previews, photos.published, photo_posts.published_on,
  (SELECT COUNT(*) FROM photos AS s WHERE s.collection = photos.collection AND (s.published = 1 OR s.id = photos.id) AND s.position < photos.position) AS idx,
  (SELECT COUNT(*) FROM photos AS s WHERE s.collection = photos.collection AND (s.published = 1 OR s.id = photos.id)) AS total
  FROM photos JOIN photo_posts ON photo_posts.collection = photos.collection`;

export function toBasketPhoto(row: FactRow): BasketPhoto {
  const previews = (JSON.parse(row.previews) as Preview[]).filter((preview) => previewSize(preview.key) === 240 || previewSize(preview.key) === 480);
  return {
    id: row.id, title: row.title, date: row.published_on, width: row.print_width, height: row.print_height, index: row.idx, total: row.total, published: row.published === 1,
    previews: previews.map(({ key, width, height, format }) => ({ url: `/media/${key}`, width, height, format })),
  };
}

export const photoNameOf = (photo: BasketPhoto) => photoName({ title: photo.title, date: photo.date }, photo.index, photo.total);

/** A basket line with everything a page, a quote and checkout need: its Artelo size, orientation, price and name */
export interface PricedLine extends BasketLine, QuoteLine {
  name: string;
  /** The 240 WebP, for the basket */
  thumb: PublicPreview | null;
  /** The 480 WebP, for Stripe's page */
  image: PublicPreview | null;
}

export interface ResolvedBasket {
  lines: PricedLine[];
  /** The canonical items value, "" when empty */
  items: string;
  count: number;
  /** AUD cents */
  printTotal: number;
  unavailable: number;
  overCap: number;
}

/** The basket against what is published and offered now: the server trusts nothing from the query string (spec 15.2) */
export function priceBasket(entries: readonly RawEntry[], photos: ReadonlyMap<string, BasketPhoto>, prices: PriceList): ResolvedBasket {
  const prints = (photoId: string) => {
    const photo = photos.get(photoId);
    return photo ? printsFor(photo.width, photo.height) : null;
  };
  const { lines, unavailable, overCap } = validate(entries, (entry) => offerFor(prints(entry.photoId), entry.tier) !== undefined);
  const priced = lines.map((line): PricedLine => {
    const photo = photos.get(line.photoId)!;
    const offers = prints(line.photoId)!;
    return {
      ...line, size: offerFor(offers, line.tier)!.size, orientation: offers.orientation, unitAmount: prices[line.tier][line.frame], name: photoNameOf(photo),
      thumb: previewOf(photo, 240, "webp") ?? null, image: previewOf(photo, 480, "webp") ?? null,
    };
  });
  return { lines: priced, items: itemsValue(lines), count: printCount(lines), printTotal: priced.reduce((sum, line) => sum + line.unitAmount * line.quantity, 0), unavailable, overCap };
}

/** The basket's photographs, the price list and the settings in one batch */
export async function loadBasket(db: D1Database, entries: readonly RawEntry[]): Promise<{ basket: ResolvedBasket; settings: PrintSettings }> {
  const ids = [...new Set(entries.map((entry) => entry.photoId))];
  const [facts, prices, settings] = await db.batch([
    // Many ids as one JSON parameter: D1 caps a statement at 100 bound parameters
    db.prepare(`${PHOTO_FACTS} WHERE photos.published = 1 AND photos.id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)),
    db.prepare(PRICES_SQL),
    db.prepare(SETTINGS_SQL),
  ]);
  const photos = new Map((facts.results as unknown as FactRow[]).map((row) => [row.id, toBasketPhoto(row)]));
  return {
    basket: priceBasket(entries, photos, toPrices(prices.results as unknown as { tier: string; frame: string; amount: number }[])),
    settings: toSettings(settings.results as unknown as { key: string; value: string }[]),
  };
}

export async function resolveBasket(db: D1Database, entries: readonly RawEntry[]): Promise<ResolvedBasket> {
  return (await loadBasket(db, entries)).basket;
}

/** The price list and the settings in one batch, for a photograph's print row */
export async function loadPrintContext(db: D1Database): Promise<{ prices: PriceList; settings: PrintSettings }> {
  const [prices, settings] = await db.batch([db.prepare(PRICES_SQL), db.prepare(SETTINGS_SQL)]);
  return {
    prices: toPrices(prices.results as unknown as { tier: string; frame: string; amount: number }[]),
    settings: toSettings(settings.results as unknown as { key: string; value: string }[]),
  };
}

export interface NewOrder {
  id: string;
  country: string;
  printTotal: number;
  deliveryAmount: number;
  deliveryTaxed: 0 | 1;
  livemode: 0 | 1;
  now: number;
}

/** The order and its lines in one batch, before any Checkout Session exists (spec 17.2 step 3). The address is not written */
export async function createOrder(db: D1Database, order: NewOrder, lines: readonly PricedLine[]): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO print_orders (id, country, print_total, delivery_amount, delivery_taxed, status, livemode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'checkout', ?, ?, ?)")
      .bind(order.id, order.country, order.printTotal, order.deliveryAmount, order.deliveryTaxed, order.livemode, order.now, order.now),
    ...lines.map((line) =>
      db.prepare("INSERT INTO print_order_items (order_id, line, photo_id, tier, size, frame, quantity, unit_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(order.id, line.line, line.photoId, line.tier, line.size.size, line.frame, line.quantity, line.unitAmount),
    ),
  ]);
}

export async function setSession(db: D1Database, id: string, sessionId: string, now: number): Promise<void> {
  await db.prepare("UPDATE print_orders SET stripe_session_id = ?, updated_at = ? WHERE id = ?").bind(sessionId, now, id).run();
}

/** checkout becomes expired; any other status is left alone. True when it changed */
export async function markExpired(db: D1Database, id: string, now: number): Promise<boolean> {
  return (await db.prepare("UPDATE print_orders SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'checkout'").bind(now, id).run()).meta.changes > 0;
}

/** One line of a placed order, named for its page and emails */
export interface OrderLine {
  line: number;
  photoId: string;
  tier: Tier;
  /** Artelo's size name, e.g. x12x18 */
  size: string;
  frame: Frame;
  quantity: number;
  /** AUD cents */
  unitAmount: number;
  name: string;
  /** The 240 WebP while the photo is published; a hidden photo's previews aren't served (plan 6) */
  thumb: PublicPreview | null;
}

interface ItemRow {
  order_id: string;
  line: number;
  photo_id: string;
  tier: Tier;
  size: string;
  frame: Frame;
  quantity: number;
  unit_amount: number;
}

/** Each order's lines, in one batch: the items, then their photographs whether or not they are still published */
export async function orderLines(db: D1Database, orderIds: readonly string[]): Promise<Map<string, OrderLine[]>> {
  const ids = JSON.stringify(orderIds);
  const [items, facts] = await db.batch([
    db.prepare("SELECT order_id, line, photo_id, tier, size, frame, quantity, unit_amount FROM print_order_items WHERE order_id IN (SELECT value FROM json_each(?)) ORDER BY order_id, line").bind(ids),
    db.prepare(`${PHOTO_FACTS} WHERE photos.id IN (SELECT photo_id FROM print_order_items WHERE order_id IN (SELECT value FROM json_each(?)))`).bind(ids),
  ]);
  const photos = new Map((facts.results as unknown as FactRow[]).map((row) => [row.id, toBasketPhoto(row)]));
  const lines = new Map<string, OrderLine[]>(orderIds.map((id) => [id, []]));
  for (const row of items.results as unknown as ItemRow[]) {
    const photo = photos.get(row.photo_id);
    lines.get(row.order_id)?.push({
      line: row.line, photoId: row.photo_id, tier: row.tier, size: row.size, frame: row.frame, quantity: row.quantity, unitAmount: row.unit_amount,
      name: photo ? photoNameOf(photo) : `photo ${row.photo_id}`,
      thumb: photo?.published ? (previewOf(photo, 240, "webp") ?? null) : null,
    });
  }
  return lines;
}
