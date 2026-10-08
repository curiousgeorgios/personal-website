import { frameLabel } from "./catalogue";
import type { PrintDeps } from "./config";
import { getOrder, orderLines, shipmentsOf, type OrderLine, type Shipment } from "./store";
import { getSession } from "./stripe";
import { orderPageUrl } from "./view-key";

// Emails (spec 18.4), driven by the orders' state: whatever is due goes out from the cron and right after a change. The
// buyer's address is read from Stripe at send time and never stored; logs name what an email was about, never who.

export const REPLY_TO = "hello@curiousgeorge.dev";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A plain html twin of a text email: a paragraph per blank-line block, a line break per line */
export const mailHtml = (text: string) => text.split(/\n{2,}/).map((block) => `<p>${block.split("\n").map(escapeHtml).join("<br>")}</p>`).join("\n");

/** A header value on one line: a stray CR or LF could otherwise start a header of its own */
const oneLine = (text: string) => text.replace(/[\r\n]+/g, " ");

/** Any email-shaped token, in any case and with its @ percent-encoded or not: a provider's error may quote the recipient back */
const EMAIL_TOKEN = /[^\s<>"'(),;:]+(?:@|%40)[^\s<>"'(),;:]+/gi;

export async function sendMail(deps: PrintDeps, mail: Mail, about: string): Promise<boolean> {
  const message = {
    from: { email: deps.config.fromEmail, name: deps.config.sellerName },
    to: oneLine(mail.to),
    replyTo: REPLY_TO,
    subject: oneLine(mail.subject),
    text: mail.text,
    html: mailHtml(mail.text),
  };
  try {
    if (deps.config.emailSink) {
      const response = await deps.fetch(deps.config.emailSink, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message) });
      if (!response.ok) throw new Error(`the sink answered ${response.status}`);
      return true;
    }
    if (!deps.email) throw new Error("there is no EMAIL binding");
    await deps.email.send(message);
    return true;
  } catch (error) {
    // The log must never hold a buyer's address, however the provider's error spells it
    const reason = (error instanceof Error ? error.message : String(error)).replace(EMAIL_TOKEN, "the recipient");
    console.error(`prints: couldn't send the ${about}`, reason);
    return false;
  }
}

export const mailAdmin = (deps: PrintDeps, subject: string, text: string, about: string) => sendMail(deps, { to: deps.config.adminEmail, subject, text }, about);

/** One print in all, so the shipped email reads in the singular */
const isSingle = (lines: readonly OrderLine[]) => lines.reduce((sum, line) => sum + line.quantity, 0) === 1;

/** Artelo's carrier and number are text from outside: one line each, and only an https link is passed on */
const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const trackingLine = (shipment: Shipment) => {
  const link = /^https:\/\/\S+$/i.test(shipment.url.trim()) ? shipment.url.trim() : "";
  const parts = [flat(shipment.carrier), flat(shipment.number), link].filter(Boolean);
  return parts.length > 0 ? `tracking: ${parts.join(" ")}` : "";
};

/** The shipped email's body (spec 18.4), singular for one print */
export function shippedText(lines: readonly OrderLine[], shipments: readonly Shipment[], pageUrl: string): string {
  const one = isSingle(lines);
  const prints = lines.map((line) => `${line.name} · ${line.tier} · ${frameLabel(line.frame)}${line.quantity > 1 ? ` × ${line.quantity}` : ""}`).join("\n");
  const tracking = shipments.map(trackingLine).filter(Boolean).join("\n");
  return [
    one ? "hi, your print has left the printer:" : "hi, your prints have left the printer:",
    prints,
    ...(tracking ? [tracking] : []),
    one ? `you can check on it here: ${pageUrl}. thanks for buying it. - george` : `you can check on them here: ${pageUrl}. thanks for buying them. - george`,
  ].join("\n\n");
}

// A guard column says where an email is: empty (NULL, or 0 for admin_notified_at) while due, minus the time of the claim
// while a send is in flight, and the time it went once sent. An in-flight claim older than 15 minutes is due again, so a
// Worker that dies mid-send costs a rare duplicate, never a lost email (spec 18.4).
type Guard = "attention_notified_at" | "shipped_email_at" | "admin_notified_at";

/** In-flight claims older than this many seconds are retried */
export const IN_FLIGHT_SECONDS = 900;

const emptyOf = (column: Guard) => (column === "admin_notified_at" ? "= 0" : "IS NULL");
/** True of a guard that is empty or stuck in flight (the SQL's `?` is the cut-off time) */
const dueSql = (column: Guard) => `(${column} ${emptyOf(column)} OR (${column} < 0 AND -${column} < ?))`;

/** Claims an email with one conditional statement that marks it in flight, so two runs never send it twice */
async function claim(db: D1Database, id: string, column: Guard, statuses: readonly string[], now: number): Promise<boolean> {
  const marks = statuses.map(() => "?").join(", ");
  return (await db.prepare(`UPDATE print_orders SET ${column} = ? WHERE id = ? AND status IN (${marks}) AND ${dueSql(column)}`).bind(-now, id, ...statuses, now - IN_FLIGHT_SECONDS).run()).meta.changes > 0;
}

/** Marks a claimed email sent, or gives the claim back so the next cron run tries again */
async function settle(db: D1Database, id: string, column: Guard, at: number, sent: boolean): Promise<void> {
  await db.prepare(`UPDATE print_orders SET ${column} = ? WHERE id = ? AND ${column} = ?`).bind(sent ? at : column === "admin_notified_at" ? 0 : null, id, -at).run();
}

/** George's email, once each time an order enters needs_attention (spec 18.4) */
export async function sendAttention(deps: PrintDeps, id: string): Promise<void> {
  const now = deps.now();
  if (!(await claim(deps.db, id, "attention_notified_at", ["needs_attention"], now))) return;
  let sent = false;
  try {
    const order = await getOrder(deps.db, id);
    sent = await mailAdmin(deps, `print order ${id} needs attention`, `${order?.attention_reason ?? "no reason was recorded."}\n\n${deps.config.siteOrigin}/admin/#orders`, `attention email for order ${id}`);
  } finally {
    await settle(deps.db, id, "attention_notified_at", now, sent);
  }
}

/** The buyer's email, once, when their order ships (spec 18.4); still due if the order has moved on to delivered */
export async function sendShipped(deps: PrintDeps, id: string): Promise<void> {
  const now = deps.now();
  if (!(await claim(deps.db, id, "shipped_email_at", ["shipped", "delivered"], now))) return;
  let sent = false;
  try {
    const order = await getOrder(deps.db, id);
    const session = order?.stripe_session_id ? await getSession(deps, order.stripe_session_id) : null;
    const email = session?.ok ? (session.body.customer_details as { email?: unknown } | null | undefined)?.email : null;
    if (order && typeof email === "string" && email) {
      const lines = (await orderLines(deps.db, [id])).get(id) ?? [];
      const subject = isSingle(lines) ? "your print is on its way" : "your prints are on their way";
      sent = await sendMail(deps, { to: email, subject, text: shippedText(lines, shipmentsOf(order), await orderPageUrl(deps.config, id)) }, `shipped email for order ${id}`);
    } else if (!order?.stripe_session_id) {
      console.error("prints: no stripe session recorded for order", id);
    } else {
      console.error("prints: no buyer email from stripe for order", id, session && !session.ok ? (session.status ?? "no answer") : "none in the session");
    }
  } finally {
    await settle(deps.db, id, "shipped_email_at", now, sent);
  }
}

/**
 * George's email about an Artelo cancellation (refund the buyer) or a paid order Stripe's webhook missed: due while
 * admin_notified_at is 0, claimed by marking it in flight and given back on failure so the cron tries again (spec 18.4)
 */
export async function sendAdminNote(deps: PrintDeps, id: string): Promise<void> {
  const now = deps.now();
  const claimed = (await deps.db.prepare(`UPDATE print_orders SET admin_notified_at = ? WHERE id = ? AND ${dueSql("admin_notified_at")}`).bind(-now, id, now - IN_FLIGHT_SECONDS).run()).meta.changes > 0;
  if (!claimed) return;
  let sent = false;
  try {
    const order = await getOrder(deps.db, id);
    sent = order?.status === "cancelled"
      ? await mailAdmin(deps, `print order ${id} was cancelled by artelo`, `artelo cancelled order ${id}. refund it in stripe.`, `cancellation email for order ${id}`)
      : await mailAdmin(deps, `print order ${id}: stripe's webhook never arrived`, `print order ${id} was paid but stripe's webhook never arrived. check the webhook in stripe.`, `missed-webhook email for order ${id}`);
  } finally {
    await settle(deps.db, id, "admin_notified_at", now, sent);
  }
}

/** One email's send, on its own so a throw (a D1 hiccup, say) is logged by order id and the rest still go */
async function attempt(id: string, send: () => Promise<void>): Promise<void> {
  try {
    await send();
  } catch {
    console.error("prints: couldn't finish sending the due email for order", id);
  }
}

/** Every email that is due: from the cron's third step and right after any change that makes one due */
export async function sendDueMail(deps: PrintDeps): Promise<void> {
  const cutoff = deps.now() - IN_FLIGHT_SECONDS;
  const { results } = await deps.db
    .prepare(`SELECT id, status, admin_notified_at FROM print_orders WHERE (status = 'needs_attention' AND ${dueSql("attention_notified_at")}) OR (status IN ('shipped', 'delivered') AND ${dueSql("shipped_email_at")}) OR ${dueSql("admin_notified_at")} ORDER BY updated_at LIMIT 20`)
    .bind(cutoff, cutoff, cutoff)
    .all();
  for (const row of results as unknown as { id: string; status: string; admin_notified_at: number | null }[]) {
    // Each send claims its own email, so one that isn't due after all (or went in the meantime) does nothing
    if (row.status === "shipped" || row.status === "delivered") await attempt(row.id, () => sendShipped(deps, row.id));
    if (row.status === "needs_attention") await attempt(row.id, () => sendAttention(deps, row.id));
    if (row.admin_notified_at !== null && row.admin_notified_at <= 0) await attempt(row.id, () => sendAdminNote(deps, row.id));
  }
}
