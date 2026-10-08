import { issueOrderGrant, photoMaster, revokeOrderGrants } from "../photos/store";
import type { Address } from "./address";
import { artelo, arteloAddress, ordersList, productInfo, readArteloOrder, unwrap, type ArteloOrder, type ArteloResult } from "./artelo";
import { mapStatus, PENDING_REASON, REFUND_REASON } from "./artelo-status";
import { parseSize, type Frame, type Orientation } from "./catalogue";
import type { PrintConfig, PrintDeps } from "./config";
import { sendDueMail } from "./mail";
import { getOrder, toAttention, type OrderRow } from "./store";
import { getPaymentIntent } from "./stripe";

// Placing the Artelo order (spec 18.2, 19): the whole order or none of it, never twice. Called from the Stripe
// webhook's waitUntil, the cron and the admin's retry now.

export const LEASE_SECONDS = 120;
/** The master links' ceiling, for orders stuck while Artelo processes images; they are revoked once in production */
export const LINK_SECONDS = 72 * 3600;

/** After failed attempt n: 5 minutes × 3^(n-1), at most 6 hours */
export const nextDelay = (attempt: number) => Math.min(300 * 3 ** (Math.max(attempt, 1) - 1), 6 * 3600);

export type PlaceOutcome = "placed" | "adopted" | "not-due" | "retry" | "attention";

/** Worth another attempt: its message names a status, never anything personal */
class Retryable extends Error {}
/** Needs George: its message is the order's attention reason */
class Permanent extends Error {}

interface Item {
  line: number;
  photo_id: string;
  size: string;
  frame: Frame;
  quantity: number;
  unit_amount: number;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NOT_IN_A_WORD = { before: "(?<![\\p{L}\\p{N}])", after: "(?![\\p{L}\\p{N}])" };

/**
 * Each address field, wherever Artelo's message repeats it, becomes [address]: a reason is stored, and an address never
 * is. So does each word of a field (three characters or more, four for a number) standing on its own, because Artelo may
 * quote part of one ("Lovelace", "Bondi"), and the phone written as bare digits. One pass, longest first, so a field
 * inside another, or inside "[address]", is never half replaced
 */
export function scrub(message: string, address: Address | null): string {
  if (!address) return message;
  const values = Object.values(address).map((value) => value.trim());
  const digits = address.phone.replace(/\D/g, "");
  const whole = [...values, ...(digits.length >= 6 ? [digits] : [])].filter((value) => value.length >= 3);
  const words = values.flatMap((value) => value.split(/[^\p{L}\p{N}+'-]+/u)).filter((word) => word.length >= (/^[\d+]+$/.test(word) ? 4 : 3));
  const longestFirst = (list: string[]) => [...new Set(list.map((value) => value.toLowerCase()))].sort((a, b) => b.length - a.length).map(escape);
  const parts = [...longestFirst(whole), ...(words.length > 0 ? [`${NOT_IN_A_WORD.before}(?:${longestFirst(words).join("|")})${NOT_IN_A_WORD.after}`] : [])];
  return parts.length > 0 ? message.replace(new RegExp(parts.join("|"), "giu"), "[address]") : message;
}

async function lookUp(deps: PrintDeps, orderId: string): Promise<ArteloOrder | null> {
  const result = await artelo(deps, "GET", `/orders/get?limit=5&name=${encodeURIComponent(orderId)}`);
  if (!result.ok) throw new Retryable(`the lookup at artelo failed (${result.status ?? "no answer"})`);
  const list = ordersList(result.body);
  if (!list) throw new Retryable("the lookup at artelo answered something unreadable");
  for (const entry of list) {
    const found = readArteloOrder(entry);
    if (found && found.orderId === orderId) return found;
    // Ours, but without an id to adopt it by: creating now could make it twice, so this lookup counts as failed
    if (!found && unwrap(entry)?.orderId === orderId) throw new Retryable("the lookup at artelo found the order without its id");
  }
  return null;
}

/** The address the delivery was quoted against, from the payment Stripe holds it on; in memory only (spec 18.2 step 3) */
async function quotedAddress(deps: PrintDeps, order: OrderRow): Promise<Address> {
  if (!order.stripe_payment_intent) throw new Permanent("the order has no stripe payment to read its address from.");
  const result = await getPaymentIntent(deps, order.stripe_payment_intent);
  if (!result.ok) {
    if (result.status === null || result.status === 429 || result.status >= 500) throw new Retryable(`stripe answered ${result.status ?? "nothing"}`);
    throw new Permanent(`stripe couldn't give the payment's delivery address (${result.status}).`);
  }
  const shipping = result.body.shipping as { name?: string | null; phone?: string | null; address?: Record<string, string | null> | null } | null;
  const address = shipping?.address;
  if (!shipping?.name || !address?.line1 || !address.country) throw new Permanent("the payment has no delivery address.");
  return {
    name: shipping.name, line1: address.line1, line2: address.line2 ?? "", city: address.city ?? "", state: address.state ?? "",
    postcode: address.postal_code ?? "", country: address.country, phone: shipping.phone ?? "",
  };
}

/** A 72-hour order grant for each photograph's master, after checking the master is there (spec 18.2 step 4) */
async function masterLinks(deps: PrintDeps, orderId: string, items: readonly Item[]): Promise<Map<string, { url: string; orientation: Orientation }>> {
  const secret = deps.config.secrets.PHOTO_LINK_SECRET;
  if (!secret) throw new Permanent("PHOTO_LINK_SECRET isn't set.");
  // The last attempt's links go first: this runs only after the lookup found nothing at Artelo, so nothing needs them
  await revokeOrderGrants(deps.db, orderId, deps.now());
  const links = new Map<string, { url: string; orientation: Orientation }>();
  for (const photoId of new Set(items.map((item) => item.photo_id))) {
    const photo = await photoMaster(deps.db, photoId);
    const object = photo ? await deps.photoPrints.head(photo.print_key) : null;
    if (!photo || !object) throw new Permanent(`the print file for ${photoId} is missing. import it again, then retry.`);
    const url = await issueOrderGrant(deps.db, secret, orderId, photoId, LINK_SECONDS, deps.config.siteOrigin, deps.now());
    links.set(photoId, { url, orientation: photo.print_width > photo.print_height ? "Horizontal" : "Vertical" });
  }
  return links;
}

function createBody(order: OrderRow, items: readonly Item[], links: Map<string, { url: string; orientation: Orientation }>, address: Address, config: PrintConfig) {
  return {
    orderId: order.id,
    createdAt: new Date((order.paid_at ?? order.created_at) * 1000).toISOString(),
    // Amounts in AUD, for the packing slip and the customs declaration only
    currency: "AUD",
    total: (order.print_total + order.delivery_amount) / 100,
    shippingCost: order.delivery_amount / 100,
    channelName: "curiousgeorge.dev",
    companyName: config.sellerName,
    // A Stripe test payment never produces a real print
    isTestOrder: order.livemode === 0,
    customerAddress: arteloAddress(address),
    items: items.map((item) => {
      const link = links.get(item.photo_id)!;
      return { orderItemId: `${order.id}-${item.line}`, quantity: item.quantity, unitPrice: item.unit_amount / 100, productInfo: productInfo({ size: parseSize(item.size), frame: item.frame, orientation: link.orientation }, link.url) };
    }),
  };
}

/** A network error, a timeout, 408, 429 and 5xx are worth retrying; any other 4xx is Artelo refusing (spec 19) */
function refusal(result: Extract<ArteloResult, { ok: false }>, address: Address): Error {
  const { status, message } = result;
  if (status === null || status === 408 || status === 429 || status >= 500) return new Retryable(status === null ? "couldn't reach artelo" : `artelo answered ${status}`);
  return new Permanent(message ? `artelo refused the order: ${scrub(message, address)}` : `artelo refused the order (${status}).`);
}

/** Sends whatever just became due. A failure here leaves it to the cron's unsent emails step and never changes the outcome */
async function mailNow(deps: PrintDeps): Promise<void> {
  try {
    await sendDueMail(deps);
  } catch (error) {
    console.error("prints: couldn't send the due emails straight away; the cron will", error instanceof Error ? error.name : typeof error);
  }
}

/** The order is Artelo's now: its id, status, cost and the time, the lease let go (spec 18.2 step 6) */
async function succeed(deps: PrintDeps, order: OrderRow, found: ArteloOrder): Promise<void> {
  const now = deps.now();
  const status = mapStatus(found.status) ?? "placed";
  // Whole US cents: artelo_cost holds only an integer, and a write it refused would leave a placed order looking unplaced
  const cost = found.costCents === null ? null : Math.round(found.costCents);
  const result = await deps.db
    .prepare("UPDATE print_orders SET status = ?, attention_reason = ?, attention_notified_at = NULL, artelo_order_id = ?, artelo_status = ?, artelo_cost = ?, shipments = COALESCE(?, shipments), placed_at = ?, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'paid'")
    .bind(status, status === "needs_attention" ? PENDING_REASON : null, found.id, found.status, cost, found.shipments ? JSON.stringify(found.shipments) : null, now, now, order.id)
    .run();
  if (result.meta.changes === 0) {
    // The order left paid while this attempt held the lease: a full refund landed. Artelo has it all the same, so it
    // keeps Artelo's id and needs George to cancel it there, never silently printed for a refunded buyer
    await deps.db
      .prepare("UPDATE print_orders SET artelo_order_id = ?, artelo_status = ?, artelo_cost = ?, status = CASE WHEN status = 'refunded' THEN 'needs_attention' ELSE status END, attention_reason = CASE WHEN status = 'refunded' THEN ? ELSE attention_reason END, attention_notified_at = CASE WHEN status = 'refunded' THEN NULL ELSE attention_notified_at END, lease_until = NULL, updated_at = ? WHERE id = ?")
      .bind(found.id, found.status, cost, REFUND_REASON, now, order.id)
      .run();
    console.error("prints: order", order.id, "reached artelo after it left paid: artelo's id is kept, and a refunded order is flagged for george");
    await mailNow(deps);
    return;
  }
  if (status === "needs_attention") await mailNow(deps);
}

/** The order left paid while this attempt held the lease (a refund landed): its status is left as it is, and only the lease goes */
async function leftPaid(deps: PrintDeps, id: string): Promise<PlaceOutcome> {
  await deps.db.prepare("UPDATE print_orders SET lease_until = NULL WHERE id = ?").bind(id).run();
  console.error("prints: order", id, "left paid while it was being placed, so its status was left as it is");
  return "not-due";
}

/**
 * A failed attempt: retried after its backoff while that falls inside the window, otherwise needs_attention. Each move is
 * from paid only, so a refund that lands during the attempt is never overwritten (and never retried into a print)
 */
async function failed(deps: PrintDeps, order: OrderRow, error: unknown): Promise<PlaceOutcome> {
  const now = deps.now();
  let reason: string;
  if (error instanceof Permanent) {
    reason = error.message;
  } else {
    if (!(error instanceof Retryable)) console.error("prints: placing order", order.id, "threw", error instanceof Error ? error.name : typeof error);
    const cause = error instanceof Retryable ? error.message : "something went wrong placing it";
    const next = now + nextDelay(order.attempts);
    if (next <= (order.retry_until ?? now)) {
      const retried = await deps.db.prepare("UPDATE print_orders SET next_attempt_at = ?, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'paid'").bind(next, now, order.id).run();
      if (retried.meta.changes === 0) return leftPaid(deps, order.id);
      console.error("prints: order", order.id, "will be retried:", cause);
      return "retry";
    }
    reason = `artelo didn't take the order within a day: ${cause}`;
  }
  if (!(await toAttention(deps.db, order.id, reason, now, "paid"))) return leftPaid(deps, order.id);
  console.error("prints: order", order.id, error instanceof Permanent ? "needs attention after a permanent failure" : "needs attention: artelo didn't take it in time");
  await mailNow(deps);
  return "attention";
}

export async function placeOrder(deps: PrintDeps, orderId: string): Promise<PlaceOutcome> {
  const now = deps.now();
  // The claim: a lease and the attempt count in one statement, so two runs never place one order (step 1)
  const claimed = await deps.db
    .prepare("UPDATE print_orders SET lease_until = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'paid' AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until < ?)")
    .bind(now + LEASE_SECONDS, now, orderId, now, now)
    .run();
  if (claimed.meta.changes === 0) return "not-due";
  const order = (await getOrder(deps.db, orderId))!;
  try {
    // Look before creating, every attempt: an earlier answer may have been lost after Artelo made the order (step 2)
    const existing = await lookUp(deps, orderId);
    if (existing) {
      await succeed(deps, order, existing);
      console.log("prints: order", orderId, "was already at artelo, so it was adopted");
      return "adopted";
    }
    const address = await quotedAddress(deps, order);
    const items = (await deps.db.prepare("SELECT line, photo_id, size, frame, quantity, unit_amount FROM print_order_items WHERE order_id = ? ORDER BY line").bind(orderId).all()).results as unknown as Item[];
    const links = await masterLinks(deps, orderId, items);
    const result = await artelo(deps, "POST", "/orders/create", createBody(order, items, links, address, deps.config));
    if (!result.ok) throw refusal(result, address);
    const created = readArteloOrder(result.body);
    if (!created) throw new Retryable("artelo's answer had no order id");
    await succeed(deps, order, created);
    console.log("prints: order", orderId, "placed with artelo");
    return "placed";
  } catch (error) {
    return failed(deps, order, error);
  }
}

/** The cron's first step: due paid orders, oldest first, at most ten, one at a time (spec 18.6). One that throws doesn't stop the rest */
export async function placeDue(deps: PrintDeps): Promise<void> {
  const { results } = await deps.db.prepare("SELECT id FROM print_orders WHERE status = 'paid' AND next_attempt_at <= ? ORDER BY paid_at, id LIMIT 10").bind(deps.now()).all();
  let threw = 0;
  for (const { id } of results as unknown as { id: string }[]) {
    try {
      await placeOrder(deps, id);
    } catch (error) {
      threw += 1;
      console.error("prints: placing order", id, "failed outright", error instanceof Error ? error.name : typeof error);
    }
  }
  // Still the cron's failure to log, once the others have had their turn
  if (threw > 0) throw new Error(`${threw} of the due orders threw while being placed`);
}
