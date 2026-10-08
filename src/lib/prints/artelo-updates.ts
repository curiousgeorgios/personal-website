import { revokeOrderGrantsStatement } from "../photos/store";
import { artelo, readArteloOrder, readShipments, shipmentsColumn, unwrap } from "./artelo";
import { mapStatus, PENDING_REASON } from "./artelo-status";
import type { PrintDeps } from "./config";
import { sendDueMail } from "./mail";
import { getOrder, type OrderRow, type OrderStatus, type Shipment } from "./store";
import { fromHex, sameBytes } from "./stripe";

// Artelo's statuses arriving by webhook, by the poll or with an order placement adopts (spec 18.3). Artelo's webhook
// carries no timestamp, so the order of statuses is the guard: placed < in_production < shipped < delivered, a lower one
// arriving late is ignored, and cancelled, delivered and refunded are final. That also makes a replayed body harmless.
// Only Artelo's order id, its status and the cleaned tracking are ever taken from what Artelo sends.

export interface ArteloUpdate {
  /** Artelo's id or ours: both are looked up */
  orderId: string;
  status: string;
  shipments: Shipment[] | null;
}

/** Longer than any id Artelo or this site makes: such a value names no order, so it isn't looked up */
const ORDER_ID_LIMIT = 128;

/** orderId, status and shipments from the top level of the body, or from a top-level data object */
export function readArteloUpdate(value: unknown): ArteloUpdate | null {
  const record = unwrap(value);
  if (!record) return null;
  const orderId = typeof record.orderId === "string" || typeof record.orderId === "number" ? String(record.orderId) : "";
  if (!orderId || orderId.length > ORDER_ID_LIMIT || typeof record.status !== "string") return null;
  return { orderId, status: record.status, shipments: readShipments(record.shipments) };
}

/** x-artelo-signature is 64 hex characters; a header past this is refused before anything is computed */
export const SIGNATURE_LIMIT = 128;

/**
 * x-artelo-signature: the hex HMAC-SHA256 of the body. Artelo's example signs JSON.stringify(req.body), so the body
 * re-serialised matches too; it is parsed for that only when the raw body doesn't match. Anything but exactly 32 bytes
 * of hex is refused unread, and each comparison takes the same time whatever the bytes
 */
export async function verifyArteloSignature(secret: string, header: string | null, raw: string): Promise<boolean> {
  if (!secret || !header || header.length > SIGNATURE_LIMIT) return false;
  const given = header.trim();
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const signature = fromHex(given)!;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const matches = async (text: string) => sameBytes(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text))), signature);
  if (await matches(raw)) return true;
  let reserialised: string;
  try {
    reserialised = JSON.stringify(JSON.parse(raw));
  } catch {
    // Not JSON: only the raw form could match
    return false;
  }
  return reserialised !== raw && (await matches(reserialised));
}

/** Artelo's statuses are single words (InProduction); anything else is never stored or logged, in case it carries text */
const STATUS_WORD = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
export const statusWord = (status: string | null): string | null => (status !== null && STATUS_WORD.test(status) ? status : null);

/** needs_attention set by Artelo ranks with placed; an order not yet Artelo's (checkout, expired, paid) has no rank */
const RANK: Partial<Record<OrderStatus, number>> = { placed: 1, needs_attention: 1, in_production: 2, shipped: 3, delivered: 4 };
const NOT_YET_ARTELOS: ReadonlySet<OrderStatus> = new Set(["checkout", "expired", "paid"]);
const FINAL: ReadonlySet<OrderStatus> = new Set(["cancelled", "delivered", "refunded"]);
/** Once in production nothing needs the masters, and after a cancellation neither ("Decisions") */
const REVOKES: readonly OrderStatus[] = ["in_production", "shipped", "delivered", "cancelled"];
/** The statuses whose move makes an email due: George's (needs attention, a cancellation) or the buyer's shipped one */
const MAILS: ReadonlySet<OrderStatus> = new Set(["needs_attention", "shipped", "delivered", "cancelled"]);

export type UpdateOutcome = "applied" | "ignored" | "unknown";

/** The emails a move made due, after the answer; a failure leaves them to the cron's unsent emails step */
const mailSoon = (deps: PrintDeps) =>
  deps.waitUntil(sendDueMail(deps).catch((error: unknown) => console.error("prints: couldn't send the due emails straight away; the cron will", error instanceof Error ? error.name : typeof error)));

/** The order a status names, by Artelo's id or failing that by ours. Only ever read: an id that is neither changes nothing */
async function findOrder(db: D1Database, orderId: string): Promise<OrderRow | null> {
  return (await db.prepare("SELECT * FROM print_orders WHERE artelo_order_id = ?").bind(orderId).first<OrderRow>()) ?? (await getOrder(db, orderId));
}

/**
 * One status against the order as read: "raced" when the order changed between the read and the write, so nothing was
 * moved. Every move is conditional on the status and attention reason it was decided from, so a refund or another
 * delivery landing meanwhile is never overwritten
 */
async function applyTo(deps: PrintDeps, order: OrderRow, status: string, shipments: readonly Shipment[] | null): Promise<UpdateOutcome | "raced"> {
  const { db } = deps;
  const now = deps.now();
  const target = mapStatus(status);
  const ignore = async () => {
    await db.prepare("UPDATE print_orders SET artelo_status = ?, status_checked_at = ?, updated_at = ? WHERE id = ?").bind(status, now, now, order.id).run();
    return "ignored" as const;
  };
  if (!target) {
    console.log("prints: artelo sent order", order.id, "a status this site doesn't map:", status);
    return ignore();
  }
  // Still being placed (an answer lost, say): only recorded, so placement's next lookup adopts the order properly rather
  // than leaving it placed with no Artelo id, where neither placement nor the poll would ever look at it again
  if (FINAL.has(order.status) || NOT_YET_ARTELOS.has(order.status)) return ignore();
  // A needs_attention this site set (a refund to cancel at Artelo, say) isn't Artelo's to clear: only needs_attention set
  // by Artelo ranks with placed (spec 18.3). A cancellation still ends it
  if (order.status === "needs_attention" && order.attention_reason !== PENDING_REASON && target !== "cancelled") return ignore();
  const current = RANK[order.status] ?? -1;
  if (target === "needs_attention" ? current >= 2 || order.status === "needs_attention" : target !== "cancelled" && (RANK[target] ?? 0) <= current) return ignore();

  const asRead = "WHERE id = ? AND status = ? AND attention_reason IS ?";
  const read = [order.id, order.status, order.attention_reason] as const;
  let move: D1PreparedStatement;
  if (target === "cancelled") {
    // George's email is due unless the buyer is already refunded in full, when the guard is left as it is; it is sent and
    // retried like the others (spec 18.4)
    move = db
      .prepare(`UPDATE print_orders SET status = 'cancelled', attention_reason = NULL, attention_notified_at = NULL, admin_notified_at = CASE WHEN COALESCE(refunded_amount, 0) < print_total + delivery_amount THEN 0 ELSE admin_notified_at END, artelo_status = ?, status_checked_at = ?, updated_at = ? ${asRead}`)
      .bind(status, now, now, ...read);
  } else if (target === "needs_attention") {
    move = db
      .prepare(`UPDATE print_orders SET status = 'needs_attention', attention_reason = ?, attention_notified_at = NULL, artelo_status = ?, status_checked_at = ?, updated_at = ? ${asRead}`)
      .bind(PENDING_REASON, status, now, now, ...read);
  } else {
    // Moving on clears any attention Artelo set; shipping (or a delivery whose shipping was never heard) stores the
    // tracking and leaves shipped_email_at empty, so the buyer's email is due
    const shipping = target === "shipped" || target === "delivered";
    move = db
      .prepare(`UPDATE print_orders SET status = ?, attention_reason = NULL, attention_notified_at = NULL, artelo_status = ?, shipments = COALESCE(?, shipments), shipped_at = CASE WHEN ? = 1 THEN COALESCE(shipped_at, ?) ELSE shipped_at END, status_checked_at = ?, updated_at = ? ${asRead}`)
      .bind(target, status, shipping ? shipmentsColumn(shipments) : null, shipping ? 1 : 0, now, now, now, ...read);
  }
  // The grants go in the same write, judged by the order's status as it runs: whoever moved it, a status that revokes revokes
  const revokes = REVOKES.includes(target)
    ? [revokeOrderGrantsStatement(db, order.id, now, `print_orders.status IN (${REVOKES.map((name) => `'${name}'`).join(", ")})`)]
    : [];
  const [moved] = await db.batch([move, ...revokes]);
  if (moved.meta.changes === 0) return "raced";
  if (MAILS.has(target)) mailSoon(deps);
  return "applied";
}

/** Applies one status to its order: D1 only, inline; any email goes out after the answer, in waitUntil */
export async function applyArteloUpdate(deps: PrintDeps, update: ArteloUpdate): Promise<UpdateOutcome> {
  let order = await findOrder(deps.db, update.orderId);
  if (!order) return "unknown";
  if (!statusWord(update.status)) {
    console.error("prints: artelo sent order", order.id, "a status that isn't a single word; nothing was written");
    return "ignored";
  }
  // A race costs a fresh read and another go; three in a row is left to the next delivery or the poll
  for (let round = 0; round < 3; round++) {
    const outcome = await applyTo(deps, order, update.status, update.shipments);
    if (outcome !== "raced") return outcome;
    order = await getOrder(deps.db, order.id);
    if (!order) return "unknown";
  }
  console.error("prints: order", order.id, "kept changing while artelo's status was applied; the poll will try again");
  return "ignored";
}

/** An order is polled when its last check, or its placement, is this old */
export const POLL_AFTER = 12 * 3600;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The cron's fourth step: Artelo deletes a webhook after 20 failed deliveries, so ask (at most 20, 300ms apart; Artelo allows 50 in 10 seconds) */
export async function pollStatuses(deps: PrintDeps, pause: (ms: number) => Promise<void> = sleep): Promise<void> {
  const { results } = await deps.db
    .prepare("SELECT id, artelo_order_id FROM print_orders WHERE artelo_order_id IS NOT NULL AND status IN ('placed', 'in_production', 'shipped', 'needs_attention') AND COALESCE(status_checked_at, placed_at, 0) < ? ORDER BY COALESCE(status_checked_at, placed_at, 0), id LIMIT 20")
    .bind(deps.now() - POLL_AFTER)
    .all();
  let threw = 0;
  for (const [index, row] of (results as unknown as { id: string; artelo_order_id: string }[]).entries()) {
    if (index > 0) await pause(300);
    const result = await artelo(deps, "GET", `/orders/get-by-id?orderId=${encodeURIComponent(row.artelo_order_id)}`);
    const found = result.ok ? readArteloOrder(result.body) : null;
    // An answer about another order is never applied to this one
    if (!found?.status || found.id !== row.artelo_order_id) {
      console.error("prints: couldn't check order", row.id, "at artelo:", result.ok ? "an unreadable answer" : (result.status ?? "no answer"));
      continue;
    }
    try {
      await applyArteloUpdate(deps, { orderId: row.artelo_order_id, status: found.status, shipments: found.shipments });
    } catch (error) {
      threw += 1;
      console.error("prints: couldn't apply artelo's status to order", row.id, error instanceof Error ? error.name : typeof error);
    }
  }
  // Still the cron's failure to log, once the others have had their turn
  if (threw > 0) throw new Error(`${threw} of the polled orders' statuses couldn't be applied`);
}
