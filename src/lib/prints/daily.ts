import { artelo, shipmentsColumn, type ArteloOrder } from "./artelo";
import { REFUND_REASON } from "./artelo-status";
import { applyArteloUpdate, statusWord } from "./artelo-updates";
import type { PrintConfig, PrintDeps } from "./config";
import { mailAdmin } from "./mail";
import { lookUp, mailNow } from "./place";
import { writeSetting } from "./store";

// The cron's daily jobs beside the exchange rate (spec 18.6 step 5), and the stranded-refund lookup (ADR-0026)

export const webhookUrl = (config: PrintConfig) => `${config.siteOrigin}/api/prints/artelo`;

/** Get Webhooks' list: an array, or one under webhooks, data or items; null for anything else */
export function webhooksList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["webhooks", "data", "items"]) if (Array.isArray(record[key])) return record[key] as unknown[];
  return null;
}

/** Artelo lists a webhook with our URL and topic, or /admin and an email say it's missing; true once it has decided */
export async function checkArteloWebhook(deps: PrintDeps): Promise<boolean> {
  // Before launch there is no key: decided for the day, rather than a refused call every five minutes
  if (!deps.config.secrets.ARTELO_API_KEY) return true;
  const result = await artelo(deps, "GET", "/webhooks/get");
  if (!result.ok) {
    console.error("prints: couldn't list artelo's webhooks", result.status ?? "no answer");
    return false;
  }
  const list = webhooksList(result.body);
  if (!list) {
    console.error("prints: artelo's webhook list couldn't be read");
    return false;
  }
  const url = webhookUrl(deps.config);
  const found = list.some((hook) => !!hook && typeof hook === "object" && (hook as Record<string, unknown>).url === url && (hook as Record<string, unknown>).topic === "OrderStatusChange");
  await writeSetting(deps.db, "artelo_webhook_missing", found ? "0" : "1", deps.now());
  if (!found) {
    // At most once a day: the check itself runs at most every 20 hours
    await mailAdmin(deps, "the artelo webhook is missing", `artelo has no OrderStatusChange webhook for ${url}, so order updates only arrive through the twelve-hourly check. run bun run prints:webhook --remote to save it again.`, "webhook-missing email");
  }
  return true;
}

/** Expired orders are kept 30 days, Stripe's event ledger 90 */
export const EXPIRED_KEEP = 30 * 86_400;
export const EVENTS_KEEP = 90 * 86_400;

export async function cleanUp(deps: PrintDeps): Promise<boolean> {
  const { db } = deps;
  const now = deps.now();
  await db.batch([
    db.prepare("DELETE FROM print_order_items WHERE order_id IN (SELECT id FROM print_orders WHERE status = 'expired' AND created_at < ?)").bind(now - EXPIRED_KEEP),
    db.prepare("DELETE FROM print_orders WHERE status = 'expired' AND created_at < ?").bind(now - EXPIRED_KEEP),
    db.prepare("DELETE FROM stripe_events WHERE received_at < ?").bind(now - EVENTS_KEEP),
  ]);
  return true;
}

/** A refunded order with no Artelo id is looked up while it was paid within this many seconds */
export const STRANDED_WINDOW = 30 * 86_400;
/** Lookups a run, 300ms apart like the poll's (Artelo allows 50 in 10 seconds) */
export const STRANDED_LIMIT = 20;
export const STRANDED_PAUSE_MS = 300;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Artelo has an order refunded here: it keeps Artelo's id and goes to needs_attention with the refund reason, so George's
 * email goes and he cancels it there. Only from refunded with no Artelo id, so a placement that recorded it meanwhile is
 * left as it is. Artelo's status then counts as placement's would (a cancellation already made there ends it)
 */
async function flagStranded(deps: PrintDeps, id: string, found: ArteloOrder): Promise<void> {
  const now = deps.now();
  // Whole US cents: artelo_cost holds only an integer
  const cost = found.costCents === null ? null : Math.round(found.costCents);
  const flagged = await deps.db
    .prepare("UPDATE print_orders SET status = 'needs_attention', attention_reason = ?, attention_notified_at = NULL, artelo_order_id = ?, artelo_status = ?, artelo_cost = ?, shipments = COALESCE(?, shipments), lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'refunded' AND artelo_order_id IS NULL")
    .bind(REFUND_REASON, found.id, statusWord(found.status), cost, shipmentsColumn(found.shipments), now, id)
    .run();
  if (flagged.meta.changes === 0) return;
  console.error("prints: refunded order", id, "is at artelo as", found.id, "so it needs attention: cancel it there");
  if (found.status) {
    try {
      await applyArteloUpdate(deps, { orderId: found.id, status: found.status, shipments: found.shipments });
    } catch (error) {
      console.error("prints: order", id, "was flagged but artelo's status wasn't applied; the poll will", error instanceof Error ? error.name : typeof error);
    }
  }
  await mailNow(deps);
}

/**
 * Artelo clearly hasn't got it: a lapsed lease is let go (a live one is an attempt still in flight, whose own outcome
 * handles the order), and the check time sends it to the back of the line, so a run's bound never hides the rest
 */
async function clearStranded(deps: PrintDeps, id: string): Promise<void> {
  const now = deps.now();
  await deps.db
    .prepare("UPDATE print_orders SET lease_until = CASE WHEN lease_until < ? THEN NULL ELSE lease_until END, status_checked_at = ? WHERE id = ? AND status = 'refunded' AND artelo_order_id IS NULL")
    .bind(now, now, id)
    .run();
}

/**
 * The daily stranded-refund lookup (ADR-0026): every refunded order with no Artelo id paid in the last 30 days is looked up
 * at Artelo with placement's own fail-closed lookup, at most twenty a run, the longest unchecked first. One Artelo has is
 * flagged for George; one it clearly hasn't loses a lapsed lease; an unreadable lookup changes nothing and is asked again
 * tomorrow. True once it has run; a write that throws still lets the rest go, then fails the step so the cron logs it
 */
export async function lookUpStrandedRefunds(deps: PrintDeps, pause: (ms: number) => Promise<void> = sleep): Promise<boolean> {
  if (!deps.config.secrets.ARTELO_API_KEY) return true;
  const { results } = await deps.db
    .prepare("SELECT id FROM print_orders WHERE status = 'refunded' AND artelo_order_id IS NULL AND paid_at >= ? ORDER BY COALESCE(status_checked_at, 0), paid_at, id LIMIT ?")
    .bind(deps.now() - STRANDED_WINDOW, STRANDED_LIMIT)
    .all();
  let threw = 0;
  for (const [index, { id }] of (results as unknown as { id: string }[]).entries()) {
    if (index > 0) await pause(STRANDED_PAUSE_MS);
    let found: ArteloOrder | null;
    try {
      found = await lookUp(deps, id);
    } catch (error) {
      // The lookup's own messages name a status, never anything personal
      console.error("prints: couldn't look up refunded order", id, "at artelo; tomorrow's check will ask again:", error instanceof Error ? error.message : typeof error);
      continue;
    }
    try {
      if (found) await flagStranded(deps, id, found);
      else await clearStranded(deps, id);
    } catch (error) {
      threw += 1;
      console.error("prints: couldn't record artelo's answer about refunded order", id, error instanceof Error ? error.name : typeof error);
    }
  }
  // Still the cron's failure to log, once the others have had their turn
  if (threw > 0) throw new Error(`${threw} of the refunded orders' lookups couldn't be recorded`);
  return true;
}
