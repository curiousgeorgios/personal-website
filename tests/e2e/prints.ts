import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { FIXTURE_SECRETS, PRINTS, STAND_IN } from "./prints-site";

// Helpers for the print specs. They write only to the prints servers' own stores and read the stand-in.

/** A suffix unique to this attempt, so parallel and retried tests never collide */
export const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;

/**
 * SQL on a prints server's own local store: reading a row, or setting test data (spec 11.2's rule). Two of these at once
 * on one store can fail with wrangler's "internal error" (parallel specs poll it). That failure, and no other, is tried
 * again after a short random wait, and only for a SELECT or a write the caller marks idempotent (one that sets a value,
 * never adds to one): a write that committed before wrangler failed must not apply twice
 */
export function printsD1<T = Record<string, unknown>>(sql: string, store = ".wrangler/prints", { idempotent = false } = {}): T[] {
  const retryable = idempotent || /^\s*select\b/i.test(sql);
  for (let attempt = 1; ; attempt++) {
    try {
      const output = execFileSync("bunx", ["wrangler", "d1", "execute", "curiousgeorge-logbook", "--local", "--persist-to", store, "--json", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return (JSON.parse(output) as { results: T[] }[])[0]?.results ?? [];
    } catch (error) {
      const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
      if (!retryable || attempt >= 6 || !/internal error/i.test(`${stdout}${stderr}`)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 + Math.floor(Math.random() * 600));
    }
  }
}

/** JSON from the stand-in */
export async function standIn<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${STAND_IN}${path}`, init);
  if (!response.ok) throw new Error(`the stand-in answered ${response.status} on ${path}`);
  return (await response.json()) as T;
}

/** fixture-b-01 medium oak and fixture-b-02 small unframed: $179 + $59 = $238 */
export const TWO_PRINTS = "fixture-b-01:medium:oak,fixture-b-02:small:unframed";

export interface TestAddress {
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  phone: string;
}

/** A test address in Australia; the name makes it findable among the stand-in's requests */
export const auAddress = (name: string): TestAddress => ({ name, line1: "12 Example Street", line2: "Unit 3", city: "Bondi Beach", state: "NSW", postcode: "2026", country: "AU", phone: "+61 400 000 000" });
export const usAddress = (name: string): TestAddress => ({ name, line1: "1600 Example Avenue", line2: "", city: "Arlington", state: "VA", postcode: "22201", country: "US", phone: "+1 202 555 0100" });

/** Its own rate-limit bucket for this test (spec 21.3): the context's page and request both send it */
export async function asTestClient(page: Page): Promise<string> {
  const client = `spec-${unique()}`;
  await page.context().setExtraHTTPHeaders({ "X-Test-Client": client });
  return client;
}

export async function fillAddress(page: Page, address: TestAddress) {
  for (const name of ["name", "line1", "line2", "city", "state", "postcode", "phone"] as const) await page.locator(`#deliver [name="${name}"]`).fill(address[name]);
  await page.locator('#deliver [name="country"]').selectOption(address.country);
}

export async function quoteDelivery(page: Page, address: TestAddress) {
  await fillAddress(page, address);
  await Promise.all([page.waitForNavigation(), page.getByRole("button", { name: "quote delivery" }).click()]);
}

/** The Price Checks the stand-in received for this address name */
export async function priceChecksFor(name: string) {
  const { priceChecks } = await standIn<{ priceChecks: { customerAddress: Record<string, string>; items: { quantity: number; productInfo: Record<string, unknown> }[] }[] }>("/__requests");
  return priceChecks.filter((check) => check.customerAddress.name === name);
}

/**
 * Continue to payment, posted as the browser would but without following the 303: the CSP rightly blocks a redirect to
 * the stand-in. The fields are read, never written: the one address form's visible fields, the sealed quote and the
 * button's intent=checkout, exactly the set the browser builds for #pay
 */
export async function postPayForm(page: Page, site = PRINTS) {
  const form = page.locator("form#deliver");
  const action = new URL((await form.getAttribute("action"))!, site);
  action.hash = "";
  const fields = await form.evaluate((element) => [...new FormData(element as HTMLFormElement, document.querySelector<HTMLButtonElement>("#pay"))].map(([name, value]) => [name, String(value)]));
  return page.request.post(action.href, { form: Object.fromEntries(fields), headers: { Origin: site }, maxRedirects: 0 });
}

export interface StandInSession {
  session: { id: string; client_reference_id: string; status: string; payment_intent: string | null; amount_total: number };
  form: Record<string, string>;
}

/** The stand-in's Checkout Sessions made for this shipping name */
export async function sessionsFor(name: string): Promise<StandInSession[]> {
  return (await standIn<StandInSession[]>("/__stripe/sessions")).filter((entry) => entry.form["payment_intent_data[shipping][name]"] === name);
}

/** A basket quoted for an Australian test address and sent to checkout; the order and its session at the stand-in */
export async function checkoutOrder(page: Page, name: string, items = TWO_PRINTS, site = PRINTS): Promise<{ orderId: string; sessionId: string }> {
  await page.goto(`${site}/basket?items=${items}`);
  await quoteDelivery(page, auAddress(name));
  const response = await postPayForm(page, site);
  if (response.status() !== 303) throw new Error(`checkout answered ${response.status()}`);
  const sessionId = response.headers()["location"].split("/").at(-1)!;
  const [found] = (await sessionsFor(name)).filter((entry) => entry.session.id === sessionId);
  return { orderId: found.session.client_reference_id, sessionId };
}

/** Completes a session at the stand-in as Checkout would; its checkout.session.completed event, for the spec to deliver */
export async function payAtStandIn(sessionId: string, extra: Record<string, unknown> = {}) {
  return standIn<{ event: { id: string } & Record<string, unknown> }>("/__stripe/pay", { method: "POST", body: JSON.stringify({ session: sessionId, ...extra }) });
}

/** Refunds a paid session's charge at the stand-in (the whole of it unless an amount is given); its charge.refunded event */
export async function refundAtStandIn(sessionId: string, amount?: number) {
  return standIn<{ event: { id: string; data: { object: Record<string, unknown> } } & Record<string, unknown> }>("/__stripe/refund", { method: "POST", body: JSON.stringify({ session: sessionId, amount }) });
}

export function stripeSignature(body: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** Delivers an event to a prints server as Stripe would: signed, and with no Origin */
export async function deliverStripe(site: string, event: unknown, secret: string = FIXTURE_SECRETS.STRIPE_WEBHOOK_SECRET): Promise<number> {
  const body = JSON.stringify(event);
  return (await fetch(`${site}/api/prints/stripe`, { method: "POST", body, headers: { "Content-Type": "application/json", "Stripe-Signature": stripeSignature(body, secret) } })).status;
}

export async function waitForStatus(orderId: string, status: string, store = ".wrangler/prints") {
  await expect.poll(() => printsD1<{ status: string }>(`SELECT status FROM print_orders WHERE id = '${orderId}'`, store)[0]?.status, { timeout: 30_000 }).toBe(status);
}

/** How the stand-in answers this order's creation: "ok", "down" or { refuse: photoId } */
export async function setMode(orderId: string, mode: "ok" | "down" | { refuse: string }) {
  await fetch(`${STAND_IN}/__mode`, { method: "POST", body: JSON.stringify({ order: orderId, mode }) });
}

export interface StandInOrder {
  id: string;
  orderId: string;
  status: string;
  order: { customerAddress: Record<string, string>; isTestOrder: boolean; items: { orderItemId: string; quantity: number; productInfo: Record<string, unknown> & { designs: { sourceImage: { url: string } }[] } }[] };
  designs: { url: string; status: number; type: string; sha256: string; width: number; height: number }[];
}

export async function arteloOrdersFor(orderId: string): Promise<StandInOrder[]> {
  return (await standIn<StandInOrder[]>("/__orders")).filter((entry) => entry.orderId === orderId);
}

/** The sink's emails whose subject or text contains this */
export async function mailFor(match: string) {
  return (await standIn<{ to: string; subject: string; text: string; html: string; replyTo: string; from: { email: string; name: string } }[]>("/__mail")).filter((mail) => mail.subject.includes(match) || mail.text.includes(match));
}

/**
 * Runs the prints cron once through wrangler's local explorer, as snapshots-live.spec.ts does: GET /__scheduled can't
 * reach a Worker built with no_bundle
 */
export async function runCron(site = PRINTS) {
  const response = await fetch(`${site}/cdn-cgi/local/explorer/api/local/scheduled?worker=personal-website`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cron: "*/5 * * * *" }) });
  const answer = (await response.json().catch(() => null)) as { success?: boolean } | null;
  if (!response.ok || !answer?.success) throw new Error(`the cron answered ${response.status}`);
}
