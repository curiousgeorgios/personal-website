import { photoMaster, revokeOrderGrantsStatement } from "../photos/store";
import { REFUND_REASON } from "./artelo-status";
import { isFrame, isTier, offerFor, printsFor } from "./catalogue";
import type { PrintDeps } from "./config";
import { sendAdminNote } from "./mail";
import { isOrderId } from "./order-id";
import { mailNow, placeOrder } from "./place";
import { getOrder, loadPrices, markExpired, type OrderRow } from "./store";
import { expireSession, getSession, type StripeSession } from "./stripe";

// Stripe's webhook, processed exactly once (spec 18.1), and the cron's reconciliation (18.6 step 2), which share the paid
// transition. Logs carry only event ids, types and order ids.

export interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

export function readEvent(value: unknown): StripeEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  const data = event.data as { object?: unknown } | undefined;
  if (typeof event.id !== "string" || typeof event.type !== "string" || !data?.object || typeof data.object !== "object") return null;
  return { id: event.id, type: event.type, livemode: event.livemode === true, data: { object: data.object as Record<string, unknown> } };
}

export const MISMATCH_REASON = "the amount paid differs from the quote";
export const MODE_REASON = "stripe's test and live modes don't match this order; check it before it's placed.";
export const MISSING_REASON = "the order row was missing; check it before it's placed.";
export type PaidOutcome = "paid" | "attention" | "unchanged" | "recreated" | "unpaid" | "foreign";

/**
 * The print order a session was made for, or null when it isn't one of this site's checkouts. Checkout sets both
 * fields to the order's id; a Payment Link or another integration on the account can carry a client_reference_id (a
 * buyer may even type one into a link's URL), but metadata is set only by whoever creates the session, and another
 * integration that sets both to the same value still has to use a print order id's shape (ADR-0027). Never logged: on
 * a session that isn't ours, client_reference_id is anybody's text
 */
export function printOrderOf(session: Pick<StripeSession, "client_reference_id" | "metadata">): string | null {
  const id = session.client_reference_id;
  return isOrderId(id) && session.metadata?.order_id === id ? id : null;
}

/** An order a session may move: still waiting for payment, and holding no session or this one (its `?` is the session id) */
const PAYABLE = "status IN ('checkout', 'expired') AND (stripe_session_id IS NULL OR stripe_session_id = ?)";

/** The first placement attempt, after the answer; a throw is logged by order id, and the cron tries again */
const placeLater = (deps: PrintDeps, id: string) =>
  placeOrder(deps, id).catch((error: unknown) => console.error("prints: the first attempt at order", id, "threw", error instanceof Error ? error.name : typeof error));

/** Why a paid session can't go straight to placing, or null. Adaptive Pricing is off, so any conversion is a mismatch */
function mismatch(order: OrderRow, session: StripeSession): string | null {
  if (Number(session.livemode === true) !== order.livemode) return MODE_REASON;
  if (session.currency !== "aud" || (session.currency_conversion !== undefined && session.currency_conversion !== null) || session.amount_total !== order.print_total + order.delivery_amount) return MISMATCH_REASON;
  return null;
}

/**
 * Whole non-negative cents from a provider's value (metadata text or a number), else 0: migration 0007 refuses a
 * fractional or negative amount, and a refused write would lose a paid order or a refund
 */
const cents = (value: unknown): number => {
  const rounded = Math.round(Number(value));
  return Number.isSafeInteger(rounded) && rounded >= 0 ? rounded : 0;
};

/** A missing order rebuilt from the session's metadata, straight into needs_attention (it never should happen) */
async function recreate(deps: PrintDeps, session: StripeSession, orderId: string, livemode: boolean): Promise<D1PreparedStatement[]> {
  const { db } = deps;
  const now = deps.now();
  const meta = session.metadata ?? {};
  const prices = await loadPrices(db);
  const statements = [
    db.prepare("INSERT INTO print_orders (id, country, print_total, delivery_amount, delivery_taxed, status, attention_reason, livemode, stripe_session_id, stripe_payment_intent, attempts, retry_until, next_attempt_at, created_at, paid_at, updated_at) VALUES (?, ?, ?, ?, ?, 'needs_attention', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
      .bind(orderId, /^[A-Z]{2}$/.test(meta.country ?? "") ? meta.country : "ZZ", cents(meta.print_total), cents(meta.delivery_amount), meta.delivery_taxed === "1" ? 1 : 0, MISSING_REASON, livemode ? 1 : 0, session.id, session.payment_intent, now + deps.config.retryWindow, now, now, now, now),
  ];
  for (let line = 1; line <= 10; line++) {
    const [photoId = "", tier = "", frame = "", quantity = ""] = (meta[`line_${line}`] ?? "").split(":");
    // A quantity outside 1 to 10 would make the store refuse the whole batch, and with it the paid order
    if (!photoId || !isTier(tier) || !isFrame(frame) || !/^(?:[1-9]|10)$/.test(quantity)) continue;
    const photo = await photoMaster(db, photoId);
    const size = photo ? (offerFor(printsFor(photo.print_width, photo.print_height), tier)?.size.size ?? "") : "";
    statements.push(
      db.prepare("INSERT INTO print_order_items (order_id, line, photo_id, tier, size, frame, quantity, unit_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
        .bind(orderId, line, photoId, tier, size, frame, Number(quantity), prices[tier][frame]),
    );
  }
  return statements;
}

/**
 * The paid transition (spec 18.1), shared by the webhook (with its ledger row first in `before`) and the reconciliation
 * (with none: the status condition is the guard). The batch commits the order change with the ledger row, or neither.
 * Only this site's own session for the order may pay it: one that isn't a print checkout, or names an order holding
 * another session, is "foreign" and writes nothing, `before` included, so its payment intent (where placement reads
 * the address it ships to) never replaces the order's
 */
export async function applyPaid(deps: PrintDeps, session: StripeSession, before: D1PreparedStatement[], livemode = session.livemode === true): Promise<PaidOutcome> {
  if (session.payment_status !== "paid") return "unpaid";
  const { db } = deps;
  const orderId = printOrderOf(session);
  if (!orderId) return "foreign";
  const order = await getOrder(db, orderId);
  if (!order) {
    await db.batch([...before, ...(await recreate(deps, session, orderId, livemode))]);
    deps.waitUntil(mailNow(deps));
    return "recreated";
  }
  if (order.stripe_session_id !== null && order.stripe_session_id !== session.id) return "foreign";
  const now = deps.now();
  const reason = mismatch(order, session);
  const results = await db.batch([
    ...before,
    // The session condition again in the statement, so a read that went stale can't let another session through
    db.prepare(`UPDATE print_orders SET status = ?, attention_reason = ?, attention_notified_at = NULL, paid_at = ?, stripe_session_id = ?, stripe_payment_intent = ?, attempts = 0, retry_until = ?, next_attempt_at = ?, lease_until = NULL, status_checked_at = NULL, updated_at = ? WHERE id = ? AND ${PAYABLE}`)
      .bind(reason ? "needs_attention" : "paid", reason, now, session.id, session.payment_intent, now + deps.config.retryWindow, now, now, order.id, session.id),
  ]);
  if (results.at(-1)!.meta.changes === 0) return "unchanged";
  // The first placement attempt runs after the answer (spec 18.1)
  deps.waitUntil(reason ? mailNow(deps) : placeLater(deps, order.id));
  return reason ? "attention" : "paid";
}

/** The refund's money: never lowered by an event that arrives late, and never 0 over an amount already recorded */
const REFUNDED_AMOUNT = "MAX(COALESCE(refunded_amount, 0), ?)";

/** 200 once the event is applied or was already; 500 when it can't be, so Stripe delivers it again (it retries for 3 days) */
export async function handleStripeEvent(deps: PrintDeps, event: StripeEvent): Promise<200 | 500> {
  const { db } = deps;
  const record = db.prepare("INSERT INTO stripe_events (id, type, received_at) VALUES (?, ?, ?)").bind(event.id, event.type, deps.now());
  const object = event.data.object;
  // An event that isn't for one of this site's print orders is recorded and answered 200: no retry will ever make it ours
  const ignore = async () => {
    await record.run();
    console.log("prints: stripe event", event.id, event.type, "isn't for one of this site's print orders; recorded and ignored");
    return 200 as const;
  };
  try {
    if (await db.prepare("SELECT 1 AS seen FROM stripe_events WHERE id = ?").bind(event.id).first()) return 200;
    if (event.type === "checkout.session.completed") {
      const session = object as unknown as StripeSession;
      if (session.payment_status !== "paid") {
        console.log("prints: stripe event", event.id, "is for an unpaid session; nothing recorded");
        return 200;
      }
      if ((await applyPaid(deps, session, [record], event.livemode)) === "foreign") return await ignore();
      return 200;
    }
    if (event.type === "checkout.session.expired") {
      const session = object as unknown as StripeSession;
      const id = printOrderOf(session);
      if (!id) return await ignore();
      const order = await getOrder(db, id);
      if (!order) {
        // Our own session, its row gone (it never should be): no redelivery can bring the row back, so it is said once, loudly
        await record.run();
        console.error("prints: stripe event", event.id, "expired the session of order", id, "but there is no such order; recorded");
        return 200;
      }
      if (order.stripe_session_id !== null && order.stripe_session_id !== session.id) return await ignore();
      await db.batch([record, db.prepare("UPDATE print_orders SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'checkout' AND (stripe_session_id IS NULL OR stripe_session_id = ?)").bind(deps.now(), id, session.id)]);
      return 200;
    }
    if (event.type === "charge.refunded") {
      const intent = typeof object.payment_intent === "string" ? object.payment_intent : null;
      const order = intent ? await db.prepare("SELECT * FROM print_orders WHERE stripe_payment_intent = ?").bind(intent).first<OrderRow>() : null;
      if (!order) {
        // Stripe copies the payment intent's metadata to its charge once, so a print order's charge names its order. Only
        // a charge naming an order that is still waiting for the paid transition to store its intent is retried: Stripe's
        // redelivery will find it. Any other charge never will: order_id is a common key (WooCommerce's gateway sets it),
        // so an id of another shape, or one no waiting order has, is another integration's sale
        const metadata = object.metadata as { order_id?: unknown } | null | undefined;
        const named = isOrderId(metadata?.order_id) ? metadata.order_id : null;
        const waiting = named ? await db.prepare("SELECT 1 AS waiting FROM print_orders WHERE id = ? AND status IN ('checkout', 'expired')").bind(named).first() : null;
        if (waiting) throw new Error("no order holds this payment yet");
        return await ignore();
      }
      const now = deps.now();
      const refunded = cents(object.amount_refunded);
      const statements = [record, db.prepare(`UPDATE print_orders SET refunded_at = ?, refunded_amount = ${REFUNDED_AMOUNT}, updated_at = ? WHERE id = ?`).bind(now, refunded, now, order.id)];
      if (object.refunded === true) {
        statements.push(
          // Not yet placed: nothing to make, so the retries stop. Any lease stays: a refunded order holding one with no
          // Artelo id is the marker that a create may be in flight, which Task 14's daily job looks up at Artelo
          db.prepare("UPDATE print_orders SET status = 'refunded', updated_at = ? WHERE id = ? AND status IN ('paid', 'needs_attention') AND artelo_order_id IS NULL").bind(now, order.id),
          // Already with Artelo, placed or held there needing something: George cancels it there. Its email goes once,
          // so a redelivery under another event id (a second refund event, say) doesn't send it again
          db.prepare("UPDATE print_orders SET status = 'needs_attention', attention_reason = ?, attention_notified_at = NULL, updated_at = ? WHERE id = ? AND (status IN ('placed', 'in_production') OR (status = 'needs_attention' AND artelo_order_id IS NOT NULL AND attention_reason IS NOT ?))").bind(REFUND_REASON, now, order.id, REFUND_REASON),
          // Refunded before Artelo had it: nothing will be made, so its master links go, in the same write as the event,
          // judged by the order's state as the batch runs (Artelo's statuses revoke the rest)
          revokeOrderGrantsStatement(db, order.id, now, "print_orders.status = 'refunded' AND print_orders.artelo_order_id IS NULL"),
        );
      }
      await db.batch(statements);
      deps.waitUntil(mailNow(deps));
      return 200;
    }
    // Only the three events are subscribed; anything else is recorded and ignored
    await record.run();
    return 200;
  } catch (error) {
    console.error("prints: stripe event", event.id, event.type, "wasn't applied:", error instanceof Error ? error.message : String(error));
    return 500;
  }
}

/** Checkouts older than this are asked about: sessions expire after an hour */
export const RECONCILE_AFTER = 65 * 60;
/** A session Stripe doesn't know this long after its order began (a session lasts an hour) is gone for good */
export const UNKNOWN_SESSION_AFTER = 25 * 3600;

/**
 * The cron's second step (spec 18.6): no paid order goes unnoticed, and nothing expires before Stripe is asked. Each
 * order read goes to the back of the line (status_checked_at), so twenty that stay checkout can't hide a newer paid one. Resolves to how many were read, for the cron's log
 */
export async function reconcileCheckouts(deps: PrintDeps): Promise<number> {
  const { results } = await deps.db
    .prepare("SELECT id, stripe_session_id, created_at, status_checked_at FROM print_orders WHERE status = 'checkout' AND created_at < ? ORDER BY COALESCE(status_checked_at, created_at), created_at LIMIT 20")
    .bind(deps.now() - RECONCILE_AFTER)
    .all();
  for (const row of results as unknown as { id: string; stripe_session_id: string | null; created_at: number; status_checked_at: number | null }[]) {
    // What stays true run after run is logged on the order's first read only, not every five minutes
    const firstRead = row.status_checked_at === null;
    // Stripe never answered, so the buyer never saw a payment page
    if (!row.stripe_session_id) {
      await markExpired(deps.db, row.id, deps.now());
      continue;
    }
    const now = deps.now();
    await deps.db.prepare("UPDATE print_orders SET status_checked_at = ? WHERE id = ?").bind(now, row.id).run();
    const result = await getSession(deps, row.stripe_session_id);
    if (!result.ok) {
      if (result.status === 404 && row.created_at < now - UNKNOWN_SESSION_AFTER) {
        await markExpired(deps.db, row.id, now);
        console.error(`prints: order ${row.id}'s session is unknown to stripe; expired`);
      } else if (result.status !== 404) console.error("prints: couldn't read the session of order", row.id, result.status ?? "no answer");
      else if (firstRead) console.error("prints: order", row.id, "has a session stripe doesn't know yet; it expires a day after the order if that stays so");
      continue;
    }
    const session = result.body as unknown as StripeSession;
    // The session the order holds must be this order's own checkout; anything else is never applied to it, or to another
    if (printOrderOf(session) !== row.id || session.id !== row.stripe_session_id) {
      if (firstRead) console.error("prints: order", row.id, "holds a session that isn't its own checkout; left as it is");
      continue;
    }
    if (session.status === "complete" && session.payment_status === "paid") {
      // George's email is made due in the transition's own batch, under the transition's own conditions, so a paid order
      // never commits without it and an order paid meanwhile by the webhook never gets it; it is claimed and released like
      // the others and retried by the cron (spec 18.4)
      const due = deps.db.prepare(`UPDATE print_orders SET admin_notified_at = 0 WHERE id = ? AND ${PAYABLE}`).bind(row.id, session.id);
      const outcome = await applyPaid(deps, session, [due]);
      if (outcome === "paid" || outcome === "attention") await sendAdminNote(deps, row.id);
    } else if (session.status === "expired") {
      await markExpired(deps.db, row.id, deps.now());
    } else if (session.status === "open") {
      // Expire it now and let its expiry be seen on the next run
      await expireSession(deps, session.id);
    }
  }
  return results.length;
}
