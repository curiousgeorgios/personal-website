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
 * How far along a status is, for telling a late or replayed one: the order of statuses, with a cancellation past them all
 * (it is final at Artelo too); -1 for one without a place (unmapped, not yet Artelo's, refunded or none)
 */
const standing = (status: OrderStatus | null) => (status === "cancelled" ? 5 : status ? (RANK[status] ?? -1) : -1);

/**
 * What one status did: "applied" moved the order, "recorded" stored only Artelo's status and the check time, "stale" wrote
 * nothing (the status Artelo last reported again, or one at or below where the order and Artelo's last status already
 * stand: a replay or a late arrival), "raced" moved nothing because the order changed between the read and the write
 */
type Applied = "applied" | "recorded" | "stale" | "raced";

/**
 * One status against the order as read. Every move is conditional on the status and attention reason it was decided
 * from, so a refund or another delivery landing meanwhile is never overwritten
 */
async function applyTo(deps: PrintDeps, order: OrderRow, status: string, shipments: readonly Shipment[] | null): Promise<Applied> {
  const { db } = deps;
  const now = deps.now();
  const target = mapStatus(status);
  // A status the rules don't act on is recorded as Artelo's, unless it says nothing new: a late or replayed one writes
  // nothing, so it can neither show an older status in /admin nor push the poll back
  const ignore = async (): Promise<Applied> => {
    if (status === order.artelo_status || (target && standing(target) <= Math.max(standing(order.status), standing(mapStatus(order.artelo_status))))) return "stale";
    // As read, like a move, so a status that has just moved the order isn't followed by an older one recorded over it
    const recorded = await db.prepare("UPDATE print_orders SET artelo_status = ?, status_checked_at = ?, updated_at = ? WHERE id = ? AND status = ? AND artelo_status IS ?").bind(status, now, now, order.id, order.status, order.artelo_status).run();
    return recorded.meta.changes === 0 ? "raced" : "recorded";
  };
  if (!target) {
    if (status !== order.artelo_status) console.log("prints: artelo sent order", order.id, "a status this site doesn't map:", status);
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

/** As applyTo, plus "unapplied" (nothing written: a status that isn't a single word, or three lost races) and "unknown" */
async function applyUpdate(deps: PrintDeps, update: ArteloUpdate): Promise<Exclude<Applied, "raced"> | "unapplied" | "unknown"> {
  let order = await findOrder(deps.db, update.orderId);
  if (!order) return "unknown";
  if (!statusWord(update.status)) {
    console.error("prints: artelo sent order", order.id, "a status that isn't a single word; nothing was written");
    return "unapplied";
  }
  // A race costs a fresh read and another go; three in a row is left to the next delivery or the poll
  for (let round = 0; round < 3; round++) {
    const outcome = await applyTo(deps, order, update.status, update.shipments);
    if (outcome !== "raced") return outcome;
    order = await getOrder(deps.db, order.id);
    if (!order) return "unknown";
  }
  console.error("prints: order", order.id, "kept changing while artelo's status was applied; the poll will try again");
  return "unapplied";
}

/** Applies one status to its order: D1 only, inline; any email goes out after the answer, in waitUntil */
export async function applyArteloUpdate(deps: PrintDeps, update: ArteloUpdate): Promise<UpdateOutcome> {
  const outcome = await applyUpdate(deps, update);
  return outcome === "applied" || outcome === "unknown" ? outcome : "ignored";
}

/** An order is polled when its last check, or its placement, is this old */
export const POLL_AFTER = 12 * 3600;
/** A poll that couldn't apply anything asks again this much later, rather than on every run */
export const POLL_RETRY = 3600;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The poll's own stamp on an order: only while the order is still due, so it never pulls back a fresher stamp a webhook
 * wrote meanwhile. A failure is logged and left: the order is simply asked again on the next run
 */
async function stamp(deps: PrintDeps, id: string, at: number, cutoff: number): Promise<void> {
  try {
    await deps.db.prepare("UPDATE print_orders SET status_checked_at = ? WHERE id = ? AND COALESCE(status_checked_at, placed_at, 0) < ?").bind(at, id, cutoff).run();
  } catch (error) {
    console.error("prints: couldn't note the check of order", id, error instanceof Error ? error.name : typeof error);
  }
}

/**
 * The cron's fourth step: Artelo deletes a webhook after 20 failed deliveries, so ask (at most 20, 300ms apart; Artelo
 * allows 50 in 10 seconds). An answer that changes nothing counts as a check (asked again in 12 hours); one that can't be
 * applied at all (no answer, another order's, an unreadable status, lost races, a throw) is asked again in an hour
 */
export async function pollStatuses(deps: PrintDeps, pause: (ms: number) => Promise<void> = sleep): Promise<void> {
  const cutoff = deps.now() - POLL_AFTER;
  const { results } = await deps.db
    .prepare("SELECT id, artelo_order_id FROM print_orders WHERE artelo_order_id IS NOT NULL AND status IN ('placed', 'in_production', 'shipped', 'needs_attention') AND COALESCE(status_checked_at, placed_at, 0) < ? ORDER BY COALESCE(status_checked_at, placed_at, 0), id LIMIT 20")
    .bind(cutoff)
    .all();
  const later = () => deps.now() - POLL_AFTER + POLL_RETRY;
  let threw = 0;
  for (const [index, row] of (results as unknown as { id: string; artelo_order_id: string }[]).entries()) {
    if (index > 0) await pause(300);
    const result = await artelo(deps, "GET", `/orders/get-by-id?orderId=${encodeURIComponent(row.artelo_order_id)}`);
    const found = result.ok ? readArteloOrder(result.body) : null;
    // An answer about another order is never applied to this one
    if (!found?.status || found.id !== row.artelo_order_id) {
      console.error("prints: couldn't check order", row.id, "at artelo:", result.ok ? "an unreadable answer" : (result.status ?? "no answer"));
      await stamp(deps, row.id, later(), cutoff);
      continue;
    }
    try {
      const outcome = await applyUpdate(deps, { orderId: row.artelo_order_id, status: found.status, shipments: found.shipments });
      if (outcome === "stale") await stamp(deps, row.id, deps.now(), cutoff);
      else if (outcome === "unapplied" || outcome === "unknown") await stamp(deps, row.id, later(), cutoff);
    } catch (error) {
      threw += 1;
      console.error("prints: couldn't apply artelo's status to order", row.id, error instanceof Error ? error.name : typeof error);
      await stamp(deps, row.id, later(), cutoff);
    }
  }
  // Still the cron's failure to log, once the others have had their turn
  if (threw > 0) throw new Error(`${threw} of the polled orders' statuses couldn't be applied`);
}
