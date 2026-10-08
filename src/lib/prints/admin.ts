import type { Frame, Tier } from "./catalogue";
import type { PrintConfig } from "./config";
import { printsStatus, type PrintsStatus } from "./open";
import { SETTINGS_SQL, shipmentsOf, toSettings, type OrderRow, type OrderStatus, type Shipment } from "./store";

// The admin's orders section (spec 20): the state of prints, then the latest orders, needs_attention first. An order row
// holds nothing personal (spec 21.2), so nothing here can show a buyer's name, address or email

export interface AdminOrderLine {
  photoId: string;
  tier: Tier;
  frame: Frame;
  quantity: number;
}

export interface AdminOrder {
  id: string;
  paidAt: number | null;
  lines: AdminOrderLine[];
  country: string;
  printTotal: number;
  deliveryAmount: number;
  /** The quote carried destination tax, so the line reads as the buyer saw it (spec 16.1) */
  deliveryTaxed: boolean;
  status: OrderStatus;
  reason: string | null;
  /** From the stored livemode: whether the payment was Stripe's live mode */
  livemode: boolean;
  refundedAmount: number | null;
  arteloId: string | null;
  /** US cents */
  arteloCost: number | null;
  shipments: Shipment[];
  paymentIntent: string | null;
}

export interface OrdersAdmin {
  status: PrintsStatus;
  rate: number | null;
  rateDate: string | null;
  /** The rate is over a week old: the rate job needs a look */
  stale: boolean;
  webhookAt: number | null;
  webhookMissing: boolean;
  buffer: number;
  orders: AdminOrder[];
}

export const STATUS_WORDS: Record<OrderStatus, string> = {
  checkout: "at checkout", expired: "expired", paid: "waiting to place", needs_attention: "needs attention", placed: "with artelo",
  in_production: "printing", shipped: "shipped", delivered: "delivered", cancelled: "cancelled", refunded: "refunded",
};

const LISTED = "SELECT * FROM print_orders WHERE status NOT IN ('checkout', 'expired') ORDER BY (status = 'needs_attention') DESC, paid_at DESC, id DESC LIMIT 100";

/** Everything the section shows, in one batch */
export async function loadOrdersAdmin(db: D1Database, config: PrintConfig, now: number): Promise<OrdersAdmin> {
  const [settingRows, orderRows, itemRows] = await db.batch([
    db.prepare(SETTINGS_SQL),
    db.prepare(LISTED),
    db.prepare(`SELECT order_id, line, photo_id, tier, frame, quantity FROM print_order_items WHERE order_id IN (SELECT id FROM (${LISTED})) ORDER BY order_id, line`),
  ]);
  const settings = toSettings(settingRows.results as unknown as { key: string; value: string }[]);
  const lines = new Map<string, AdminOrderLine[]>();
  for (const row of itemRows.results as unknown as { order_id: string; photo_id: string; tier: Tier; frame: Frame; quantity: number }[]) {
    lines.set(row.order_id, [...(lines.get(row.order_id) ?? []), { photoId: row.photo_id, tier: row.tier, frame: row.frame, quantity: row.quantity }]);
  }
  return {
    status: printsStatus(config, settings.rate),
    rate: settings.rate,
    rateDate: settings.rateDate,
    stale: settings.rateDate !== null && Date.parse(`${settings.rateDate}T00:00:00Z`) / 1000 < now - 7 * 86_400,
    webhookAt: settings.arteloWebhookAt,
    webhookMissing: settings.webhookMissing,
    buffer: settings.buffer,
    orders: (orderRows.results as unknown as OrderRow[]).map((row) => ({
      id: row.id, paidAt: row.paid_at, lines: lines.get(row.id) ?? [], country: row.country, printTotal: row.print_total, deliveryAmount: row.delivery_amount, deliveryTaxed: row.delivery_taxed === 1,
      status: row.status, reason: row.attention_reason, livemode: row.livemode === 1, refundedAmount: row.refunded_amount, arteloId: row.artelo_order_id,
      arteloCost: row.artelo_cost, shipments: shipmentsOf(row), paymentIntent: row.stripe_payment_intent,
    })),
  };
}

let sydney: Intl.DateTimeFormat | undefined;

/** A time in Sydney as the admin writes it: 08.10.26 14:02 */
export function stamp(seconds: number): string {
  sydney ??= new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const part = Object.fromEntries(sydney.formatToParts(new Date(seconds * 1000)).map((entry) => [entry.type, entry.value]));
  return `${part.day}.${part.month}.${part.year} ${part.hour}:${part.minute}`;
}

/** Stripe's dashboard page for a payment, test or live by the order's stored livemode; the id stays one path segment */
export const refundHref = (order: Pick<AdminOrder, "livemode" | "paymentIntent">): string | null =>
  order.paymentIntent ? `https://dashboard.stripe.com/${order.livemode ? "" : "test/"}payments/${encodeURIComponent(order.paymentIntent)}` : null;
