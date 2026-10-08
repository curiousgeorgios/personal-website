import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { PRINTS, STAND_IN } from "./prints-site";

// Helpers for the print specs. They write only to the prints servers' own stores and read the stand-in.

/** A suffix unique to this attempt, so parallel and retried tests never collide */
export const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;

/** SQL on a prints server's own local store: reading a row, or setting test data (spec 11.2's rule) */
export function printsD1<T = Record<string, unknown>>(sql: string, store = ".wrangler/prints"): T[] {
  const output = execFileSync("bunx", ["wrangler", "d1", "execute", "curiousgeorge-logbook", "--local", "--persist-to", store, "--json", "--command", sql], { encoding: "utf8" });
  return (JSON.parse(output) as { results: T[] }[])[0]?.results ?? [];
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
