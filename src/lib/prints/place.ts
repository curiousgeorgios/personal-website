import { issueOrderGrant, photoMaster, revokeOrderGrants } from "../photos/store";
import { verifyPhotoToken } from "../photos/tokens";
import type { Address } from "./address";
import { artelo, arteloAddress, ordersList, productInfo, readArteloOrder, shipmentsColumn, SHOWN_MESSAGE, type ArteloOrder, type ArteloResult } from "./artelo";
import { applyArteloUpdate, statusWord } from "./artelo-updates";
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
/** Artelo has the order but recording that failed: nothing may be cleared, so it propagates and the lease is left to lapse */
class Unrecorded extends Error {}

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
 * inside another, or inside "[address]", is never half replaced. It runs on Artelo's whole message, before the cut.
 *
 * Its limits: it matches what the buyer typed, so a value Artelo rewrites slips through. A phone reformatted to another
 * national form ("0400 000 000" for "+61 400 000 000"), a name or street with its diacritics folded ("Zoe" for "Zoë"),
 * an abbreviation ("St" for "Street") and a number under four digits standing alone (a house number) all stay as written
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
  // Only an empty list means Artelo hasn't got it. A search for our id that finds something we can't match (another
  // field name, no id to adopt by) is almost certainly ours: creating could make it twice, so the lookup counts as failed
  if (list.length === 0) return null;
  for (const entry of list) {
    const found = readArteloOrder(entry);
    if (found && found.orderId === orderId) return found;
  }
  throw new Retryable("the lookup at artelo answered orders it couldn't match to this one");
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

interface MasterLinks {
  links: Map<string, { url: string; orientation: Orientation }>;
  /** The grants this attempt issued, so the others can be revoked once the create is fenced, or these if it isn't */
  grantIds: string[];
}

/**
 * A 72-hour order grant for each photograph's master, after checking the master is there (spec 18.2 step 4). Earlier
 * attempts' links are revoked only once the fence holds: until then another run may own the order and its links
 */
async function masterLinks(deps: PrintDeps, orderId: string, items: readonly Item[]): Promise<MasterLinks> {
  const secret = deps.config.secrets.PHOTO_LINK_SECRET;
  if (!secret) throw new Permanent("PHOTO_LINK_SECRET isn't set.");
  const links = new Map<string, { url: string; orientation: Orientation }>();
  const grantIds: string[] = [];
  for (const photoId of new Set(items.map((item) => item.photo_id))) {
    const photo = await photoMaster(deps.db, photoId);
    const object = photo ? await deps.photoPrints.head(photo.print_key) : null;
    if (!photo || !object) throw new Permanent(`the print file for ${photoId} is missing. import it again, then retry.`);
    const url = await issueOrderGrant(deps.db, secret, orderId, photoId, LINK_SECONDS, deps.config.siteOrigin, deps.now());
    const grant = await verifyPhotoToken(secret, new URL(url).searchParams.get("token") ?? "", deps.now());
    if (!grant) throw new Error("an order link didn't verify");
    grantIds.push(grant.grantId);
    links.set(photoId, { url, orientation: photo.print_width > photo.print_height ? "Horizontal" : "Vertical" });
  }
  return { links, grantIds };
}

/** Revokes the order's working links: only `ids`, or (with `except`) every one but them */
async function revokeLinks(deps: PrintDeps, orderId: string, ids: readonly string[], except: boolean): Promise<void> {
  await deps.db
    .prepare(`UPDATE photo_download_grants SET revoked_at = ? WHERE order_id = ? AND revoked_at IS NULL AND id ${except ? "NOT IN" : "IN"} (SELECT value FROM json_each(?))`)
    .bind(deps.now(), orderId, JSON.stringify(ids))
    .run();
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
  // Scrubbed whole, then cut: cutting first could leave half a name or street that no longer matches the address
  return new Permanent(message ? `artelo refused the order: ${scrub(message, address).slice(0, SHOWN_MESSAGE)}` : `artelo refused the order (${status}).`);
}

/** Sends whatever just became due. A failure here leaves it to the cron's unsent emails step and never changes the outcome */
export async function mailNow(deps: PrintDeps): Promise<void> {
  try {
    await sendDueMail(deps);
  } catch (error) {
    console.error("prints: couldn't send the due emails straight away; the cron will", error instanceof Error ? error.name : typeof error);
  }
}

/** Statuses past placed: an order adopted in one of these moves on through Artelo's status rules (spec 18.3) */
const MOVED_ON: ReadonlySet<string> = new Set(["in_production", "shipped", "delivered", "cancelled"]);

/**
 * An adopted order Artelo has already moved on gets the same rules as the webhook: its grants revoked, its tracking
 * stored, the buyer's or George's email made due. The order is recorded first, so a failure here only leaves the status
 * for the webhook or the poll; it never undoes the placement or reaches the attempt's failure handling
 */
async function applyAdopted(deps: PrintDeps, order: OrderRow, found: ArteloOrder): Promise<void> {
  if (!found.status || !MOVED_ON.has(mapStatus(found.status) ?? "")) return;
  try {
    await applyArteloUpdate(deps, { orderId: found.id, status: found.status, shipments: found.shipments });
  } catch (error) {
    console.error("prints: order", order.id, "was recorded as artelo's but its status wasn't applied; the poll will", error instanceof Error ? error.name : typeof error);
  }
}

/** The order is Artelo's now: its id, status, cost and the time, the lease let go (spec 18.2 step 6) */
async function succeed(deps: PrintDeps, order: OrderRow, found: ArteloOrder): Promise<void> {
  const now = deps.now();
  const mapped = mapStatus(found.status) ?? "placed";
  // Recorded as placed (or held by Artelo); a status past that is applied afterwards by the status rules
  const status = mapped === "needs_attention" ? "needs_attention" : "placed";
  // Whole US cents: artelo_cost holds only an integer, and a write it refused would leave a placed order looking unplaced
  const cost = found.costCents === null ? null : Math.round(found.costCents);
  const result = await deps.db
    .prepare("UPDATE print_orders SET status = ?, attention_reason = ?, attention_notified_at = NULL, artelo_order_id = ?, artelo_status = ?, artelo_cost = ?, shipments = COALESCE(?, shipments), placed_at = ?, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'paid'")
    .bind(status, status === "needs_attention" ? PENDING_REASON : null, found.id, statusWord(found.status), cost, shipmentsColumn(found.shipments), now, now, order.id)
    .run();
  if (result.meta.changes === 0) {
    // The order left paid while this attempt held the lease: a full refund landed. Artelo has it all the same, so it
    // keeps Artelo's id and needs George to cancel it there, never silently printed for a refunded buyer. An id already
    // recorded is never replaced: a second Artelo order is logged by both ids, so neither is lost. The id kept comes back
    // from the write itself (RETURNING), so the two-orders line never hangs on a read afterwards
    let recorded: string | null = null;
    try {
      const kept = await deps.db
        .prepare("UPDATE print_orders SET artelo_order_id = COALESCE(artelo_order_id, ?), artelo_status = CASE WHEN artelo_order_id IS NULL OR artelo_order_id = ? THEN ? ELSE artelo_status END, artelo_cost = CASE WHEN artelo_order_id IS NULL OR artelo_order_id = ? THEN ? ELSE artelo_cost END, status = CASE WHEN status = 'refunded' THEN 'needs_attention' ELSE status END, attention_reason = CASE WHEN status = 'refunded' THEN ? ELSE attention_reason END, attention_notified_at = CASE WHEN status = 'refunded' THEN NULL ELSE attention_notified_at END, lease_until = NULL, updated_at = ? WHERE id = ? RETURNING artelo_order_id")
        .bind(found.id, found.id, statusWord(found.status), found.id, cost, REFUND_REASON, now, order.id)
        .first<{ artelo_order_id: string | null }>();
      recorded = kept?.artelo_order_id ?? null;
    } catch (error) {
      throw new Unrecorded(error instanceof Error ? error.name : typeof error);
    }
    if (recorded && recorded !== found.id) console.error("prints: order", order.id, "has two artelo orders,", recorded, "and", `${found.id}: cancel one in artelo`);
    else console.error("prints: order", order.id, "reached artelo after it left paid: artelo's id is kept, and a refunded order is flagged for george");
    // The order holds this Artelo id: its status still counts (a cancellation ends the refund's needs_attention, say)
    if (recorded === found.id) await applyAdopted(deps, order, found);
    await mailNow(deps);
    return;
  }
  if (status === "needs_attention") await mailNow(deps);
  await applyAdopted(deps, order, found);
}

/** What a failure may touch: the lease this attempt holds now (the claim's, then the fence's), and whether a create went */
interface Attempt {
  lease: number;
  sent: boolean;
}

/**
 * A failure's guarded write found the order no longer this attempt's: another run holds the lease, or it left paid (a
 * refund landed). Another run's order is left exactly as it is. An order that left paid under this attempt's lease keeps
 * its status; its lease goes only when Artelo can't have it (no create was sent, or Artelo refused it), because a
 * refunded order with a lease and no Artelo id is the marker Task 14's daily job looks up at Artelo. A refunded order's
 * links go, as the refund webhook revokes them: this attempt may have issued them after it did
 */
async function leftPaid(deps: PrintDeps, id: string, attempt: Attempt, arteloMayHaveIt: boolean): Promise<PlaceOutcome> {
  const row = await getOrder(deps.db, id);
  if (!row || row.lease_until !== attempt.lease) {
    console.error("prints: order", id, "is no longer this attempt's, so it was left as it is");
    return "not-due";
  }
  if (!arteloMayHaveIt) await deps.db.prepare("UPDATE print_orders SET lease_until = NULL WHERE id = ? AND lease_until = ?").bind(id, attempt.lease).run();
  if (row.status === "refunded") await revokeOrderGrants(deps.db, id, deps.now());
  console.error("prints: order", id, "left paid while it was being placed, so its status was left as it is");
  return "not-due";
}

async function revokeIfRefunded(deps: PrintDeps, id: string): Promise<void> {
  if ((await getOrder(deps.db, id))?.status === "refunded") await revokeOrderGrants(deps.db, id, deps.now());
}

/**
 * A failed attempt: retried after its backoff while that falls inside the window, otherwise needs_attention. Each move is
 * from paid only and under this attempt's own lease, so a refund that lands during the attempt is never overwritten (and
 * never retried into a print), and an attempt that stalled past its lease can't move an order another run is placing
 */
async function failed(deps: PrintDeps, order: OrderRow, error: unknown, attempt: Attempt): Promise<PlaceOutcome> {
  const now = deps.now();
  // After a create went out, only Artelo refusing it (the one permanent failure that follows a create) says it hasn't the order
  const arteloMayHaveIt = attempt.sent && !(error instanceof Permanent);
  let reason: string;
  if (error instanceof Permanent) {
    reason = error.message;
  } else {
    if (!(error instanceof Retryable)) console.error("prints: placing order", order.id, "threw", error instanceof Error ? error.name : typeof error);
    const cause = error instanceof Retryable ? error.message : "something went wrong placing it";
    const next = now + nextDelay(order.attempts);
    if (next <= (order.retry_until ?? now)) {
      const retried = await deps.db.prepare("UPDATE print_orders SET next_attempt_at = ?, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'paid' AND lease_until = ?").bind(next, now, order.id, attempt.lease).run();
      if (retried.meta.changes === 0) return leftPaid(deps, order.id, attempt, arteloMayHaveIt);
      console.error("prints: order", order.id, "will be retried:", cause);
      return "retry";
    }
    reason = `artelo didn't take the order within a day: ${cause}`;
  }
  if (!(await toAttention(deps.db, order.id, reason, now, "paid", attempt.lease))) return leftPaid(deps, order.id, attempt, arteloMayHaveIt);
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
  const attempt: Attempt = { lease: now + LEASE_SECONDS, sent: false };
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
    const { links, grantIds } = await masterLinks(deps, orderId, items);
    // The fence: the create goes only while this attempt's own lease still holds and the order is still paid, and the
    // lease is renewed to cover it. A run that took over a lapsed lease, or a refund, stops this one creating a second
    // order. The lease isn't released, because it is no longer this attempt's to release
    const renewed = deps.now() + LEASE_SECONDS;
    const fenced = await deps.db
      .prepare("UPDATE print_orders SET lease_until = ? WHERE id = ? AND status = 'paid' AND lease_until = ?")
      .bind(renewed, orderId, attempt.lease)
      .run();
    if (fenced.meta.changes === 0) {
      // Only this attempt's own links, which nothing has: the run that took over may be using its own. A refunded
      // order keeps whatever lease it has here: Task 14's daily job looks for refunded orders with a lapsed lease and no
      // Artelo id (an attempt that stopped after it may have created), so this lease must stay as it is
      await revokeLinks(deps, orderId, grantIds, false);
      await revokeIfRefunded(deps, orderId);
      console.error("prints: order", orderId, "wasn't created: its lease was taken over or it left paid");
      return "not-due";
    }
    attempt.lease = renewed;
    // Nothing but building the body sits between the fence and the request: any wait there would reopen the takeover
    const body = createBody(order, items, links, address, deps.config);
    attempt.sent = true;
    const result = await artelo(deps, "POST", "/orders/create", body);
    // Then, whatever Artelo answered, the last attempts' links go: the lookup found nothing at Artelo and the fence
    // held, so nothing needs them. A failure here only leaves them for the next attempt to revoke
    try {
      await revokeLinks(deps, orderId, grantIds, true);
    } catch (error) {
      console.error("prints: order", orderId, "kept its earlier links for now: revoking them failed", error instanceof Error ? error.name : typeof error);
    }
    if (!result.ok) throw refusal(result, address);
    const created = readArteloOrder(result.body);
    if (!created) throw new Retryable("artelo's answer had no order id");
    await succeed(deps, order, created);
    console.log("prints: order", orderId, "placed with artelo");
    return "placed";
  } catch (error) {
    if (error instanceof Unrecorded) {
      // Nothing is cleared, and the lease above all stays: a refunded order with a lapsed lease and no Artelo id is what
      // Task 14's daily job looks for, to find the order at Artelo and flag it for George
      console.error("prints: order", orderId, "is at artelo but recording that failed, so nothing was cleared and its lease is left to lapse", error.message);
      throw error;
    }
    return failed(deps, order, error, attempt);
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
