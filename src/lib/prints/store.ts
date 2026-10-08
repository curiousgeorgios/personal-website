import { FRAMES, TIERS, type Frame, type Tier } from "./catalogue";

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
  /** 0 while George's cancellation or missed-webhook email is due, then when it went; null when none is due */
  admin_notified_at: number | null;
  updated_at: number;
}

export async function getOrder(db: D1Database, id: string): Promise<OrderRow | null> {
  return db.prepare("SELECT * FROM print_orders WHERE id = ?").bind(id).first<OrderRow>();
}

export function shipmentsOf(order: Pick<OrderRow, "shipments">): Shipment[] {
  if (!order.shipments) return [];
  const parsed: unknown = JSON.parse(order.shipments);
  return Array.isArray(parsed) ? (parsed as Shipment[]) : [];
}
