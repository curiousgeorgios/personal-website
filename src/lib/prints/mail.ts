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

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A plain html twin of a text email: a paragraph per blank-line block, a line break per line */
export const mailHtml = (text: string) => text.split(/\n{2,}/).map((block) => `<p>${block.split("\n").map(escape).join("<br>")}</p>`).join("\n");

export async function sendMail(deps: PrintDeps, mail: Mail, about: string): Promise<boolean> {
  const message = {
    from: { email: deps.config.fromEmail, name: deps.config.sellerName },
    to: mail.to,
    replyTo: REPLY_TO,
    subject: mail.subject,
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
    // A provider's error may quote the recipient back; the log must never hold a buyer's address
    const reason = (error instanceof Error ? error.message : String(error)).split(mail.to).join("the recipient");
    console.error(`prints: couldn't send the ${about}`, reason);
    return false;
  }
}

export const mailAdmin = (deps: PrintDeps, subject: string, text: string, about: string) => sendMail(deps, { to: deps.config.adminEmail, subject, text }, about);

/** The shipped email's body (spec 18.4), singular for one print */
export function shippedText(lines: readonly OrderLine[], shipments: readonly Shipment[], pageUrl: string): string {
  const one = lines.reduce((sum, line) => sum + line.quantity, 0) === 1;
  const prints = lines.map((line) => `${line.name} · ${line.tier} · ${frameLabel(line.frame)}${line.quantity > 1 ? ` × ${line.quantity}` : ""}`).join("\n");
  const tracking = shipments.map((shipment) => `tracking: ${[shipment.carrier, shipment.number, shipment.url].filter(Boolean).join(" ")}`).join("\n");
  return [
    one ? "hi, your print has left the printer:" : "hi, your prints have left the printer:",
    prints,
    ...(tracking ? [tracking] : []),
    one ? `you can check on it here: ${pageUrl}. thanks for buying it. - george` : `you can check on them here: ${pageUrl}. thanks for buying them. - george`,
  ].join("\n\n");
}

type Guard = "attention_notified_at" | "shipped_email_at";

/** Claims an email in the statement that marks it sent, so two runs never send it twice */
async function claim(db: D1Database, id: string, column: Guard, status: string, now: number): Promise<boolean> {
  return (await db.prepare(`UPDATE print_orders SET ${column} = ? WHERE id = ? AND status = ? AND ${column} IS NULL`).bind(now, id, status).run()).meta.changes > 0;
}

/** A failed send gives the claim back, so the next cron run tries again */
async function release(db: D1Database, id: string, column: Guard, at: number): Promise<void> {
  await db.prepare(`UPDATE print_orders SET ${column} = NULL WHERE id = ? AND ${column} = ?`).bind(id, at).run();
}

/** George's email, once each time an order enters needs_attention (spec 18.4) */
export async function sendAttention(deps: PrintDeps, id: string): Promise<void> {
  const now = deps.now();
  if (!(await claim(deps.db, id, "attention_notified_at", "needs_attention", now))) return;
  const order = await getOrder(deps.db, id);
  const sent = await mailAdmin(deps, `print order ${id} needs attention`, `${order?.attention_reason ?? "no reason was recorded."}\n\n${deps.config.siteOrigin}/admin/#orders`, `attention email for order ${id}`);
  if (!sent) await release(deps.db, id, "attention_notified_at", now);
}

/** The buyer's email, once, when their order ships (spec 18.4) */
export async function sendShipped(deps: PrintDeps, id: string): Promise<void> {
  const now = deps.now();
  if (!(await claim(deps.db, id, "shipped_email_at", "shipped", now))) return;
  let sent = false;
  const order = await getOrder(deps.db, id);
  const session = order?.stripe_session_id ? await getSession(deps, order.stripe_session_id) : null;
  const email = session?.ok ? (session.body.customer_details as { email?: unknown } | null | undefined)?.email : null;
  if (order && typeof email === "string" && email) {
    const lines = (await orderLines(deps.db, [id])).get(id) ?? [];
    const one = lines.reduce((sum, line) => sum + line.quantity, 0) === 1;
    sent = await sendMail(deps, { to: email, subject: one ? "your print is on its way" : "your prints are on their way", text: shippedText(lines, shipmentsOf(order), await orderPageUrl(deps.config, id)) }, `shipped email for order ${id}`);
  } else {
    console.error("prints: no buyer email from stripe for order", id, session && !session.ok ? (session.status ?? "no answer") : "none in the session");
  }
  if (!sent) await release(deps.db, id, "shipped_email_at", now);
}

/**
 * George's email about an Artelo cancellation (refund the buyer) or a paid order Stripe's webhook missed: due while
 * admin_notified_at is 0, claimed by setting the time and given back on failure so the cron tries again (spec 18.4)
 */
export async function sendAdminNote(deps: PrintDeps, id: string): Promise<void> {
  const now = deps.now();
  if ((await deps.db.prepare("UPDATE print_orders SET admin_notified_at = ? WHERE id = ? AND admin_notified_at = 0").bind(now, id).run()).meta.changes === 0) return;
  const order = await getOrder(deps.db, id);
  const sent = order?.status === "cancelled"
    ? await mailAdmin(deps, `print order ${id} was cancelled by artelo`, `artelo cancelled order ${id}. refund it in stripe.`, `cancellation email for order ${id}`)
    : await mailAdmin(deps, `print order ${id}: stripe's webhook never arrived`, `print order ${id} was paid but stripe's webhook never arrived. check the webhook in stripe.`, `missed-webhook email for order ${id}`);
  if (!sent) await deps.db.prepare("UPDATE print_orders SET admin_notified_at = 0 WHERE id = ? AND admin_notified_at = ?").bind(id, now).run();
}

/** Every email that is due: from the cron's third step and right after any change that makes one due */
export async function sendDueMail(deps: PrintDeps): Promise<void> {
  const { results } = await deps.db
    .prepare("SELECT id, status, attention_notified_at, shipped_email_at, admin_notified_at FROM print_orders WHERE (status = 'needs_attention' AND attention_notified_at IS NULL) OR (status = 'shipped' AND shipped_email_at IS NULL) OR admin_notified_at = 0 ORDER BY updated_at LIMIT 20")
    .all();
  for (const row of results as unknown as { id: string; status: string; attention_notified_at: number | null; shipped_email_at: number | null; admin_notified_at: number | null }[]) {
    if (row.status === "shipped" && row.shipped_email_at === null) await sendShipped(deps, row.id);
    if (row.status === "needs_attention" && row.attention_notified_at === null) await sendAttention(deps, row.id);
    if (row.admin_notified_at === 0) await sendAdminNote(deps, row.id);
  }
}
