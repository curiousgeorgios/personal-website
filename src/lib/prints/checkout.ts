import { ulid } from "../admin/ulid";
import { postingTo, type Address } from "./address";
import { itemsQuery } from "./basket";
import { frameLabel, sizeInches } from "./catalogue";
import type { PrintConfig, PrintDeps } from "./config";
import { countryName } from "./countries";
import { gstSentence, plural } from "./money";
import { deliveryLabel, hasTax } from "./quote";
import type { QuotePayload } from "./seal";
import { createOrder, markExpired, setSession, type PricedLine, type ResolvedBasket } from "./store";
import { livemodeOf, stripe } from "./stripe";
import { orderPageUrl } from "./view-key";

// Starting checkout (spec 17): the order first, then Stripe's hosted page. Shipping collection is off, so Checkout asks
// only for the email and card; the quoted address rides on the payment, where the buyer can't change it, and is shown
// read-only in the custom text (17.1).

/** Stripe allows 1,200 characters of custom text; the address form's limits keep it well under */
export const CUSTOM_TEXT_LIMIT = 1200;

export const customText = (address: Address, gst: string) =>
  `posting to: ${postingTo(address)}. to change it, go back and quote again. prints are made and posted by artelo in the us. ${gst}`;

export interface SessionInput {
  orderId: string;
  lines: readonly PricedLine[];
  payload: QuotePayload;
  config: PrintConfig;
  /** Where Stripe returns the buyer: orderPageUrl's, the same link the shipped email carries */
  orderPage: string;
  now: number;
}

export function sessionForm({ orderId, lines, payload, config, orderPage, now }: SessionInput): URLSearchParams {
  const form = new URLSearchParams();
  const set = (name: string, value: string | number) => form.append(name, String(value));
  const gst = gstSentence(config.gst);
  // GST later (17.3): an inclusive rate on every line of an order posted within Australia; exports carry none
  const taxRate = config.gst === "inclusive" && config.gstTaxRate && payload.address.country === "AU" ? config.gstTaxRate : null;
  set("mode", "payment");
  set("payment_method_types[0]", "card");
  set("submit_type", "pay");
  set("locale", "auto");
  set("expires_at", now + 3600);
  // The buyer always pays the AUD total the site showed
  set("adaptive_pricing[enabled]", "false");
  lines.forEach((line, i) => {
    const item = `line_items[${i}]`;
    set(`${item}[price_data][currency]`, "aud");
    set(`${item}[price_data][unit_amount]`, line.unitAmount);
    set(`${item}[price_data][product_data][name]`, `print of ${line.name} · ${line.tier}, ${sizeInches(line.size)} · ${frameLabel(line.frame)}`);
    set(`${item}[price_data][product_data][description]`, "archival matte paper, made and posted by artelo");
    // Stripe fetches the image itself, so a local http origin sends none
    if (config.siteOrigin.startsWith("https://") && line.image) set(`${item}[price_data][product_data][images][0]`, `${config.siteOrigin}${line.image.url}`);
    set(`${item}[quantity]`, line.quantity);
    if (taxRate) set(`${item}[tax_rates][0]`, taxRate);
  });
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const delivery = `line_items[${lines.length}]`;
  set(`${delivery}[price_data][currency]`, "aud");
  set(`${delivery}[price_data][unit_amount]`, payload.deliveryAmount);
  set(`${delivery}[price_data][product_data][name]`, `${deliveryLabel(payload.taxes)} to ${countryName(payload.address.country)}, ${plural(count, "print", "prints")}`);
  set(`${delivery}[quantity]`, 1);
  if (taxRate) set(`${delivery}[tax_rates][0]`, taxRate);
  const address = payload.address;
  const shipping = "payment_intent_data[shipping]";
  set(`${shipping}[name]`, address.name);
  set(`${shipping}[phone]`, address.phone);
  set(`${shipping}[address][line1]`, address.line1);
  if (address.line2) set(`${shipping}[address][line2]`, address.line2);
  set(`${shipping}[address][city]`, address.city);
  if (address.state) set(`${shipping}[address][state]`, address.state);
  if (address.postcode) set(`${shipping}[address][postal_code]`, address.postcode);
  set(`${shipping}[address][country]`, address.country);
  set("custom_text[submit][message]", customText(address, gst));
  // Stripe's free receipt shows the description, so the gst sentence reaches it (spec 17.1)
  set("payment_intent_data[description]", `print order ${orderId} · ${gst.replace(/\.$/, "")}`);
  set("client_reference_id", orderId);
  set("metadata[order_id]", orderId);
  set("metadata[country]", address.country);
  set("metadata[print_total]", payload.printTotal);
  set("metadata[delivery_amount]", payload.deliveryAmount);
  set("metadata[delivery_taxed]", hasTax(payload.taxes) ? "1" : "0");
  lines.forEach((line, i) => set(`metadata[line_${i + 1}]`, `${line.photoId}:${line.tier}:${line.frame}:${line.quantity}`));
  set("payment_intent_data[metadata][order_id]", orderId);
  set("success_url", orderPage);
  // Back to the basket, its address form empty
  set("cancel_url", `${config.siteOrigin}/basket${itemsQuery(payload.items)}`);
  return form;
}

export type CheckoutOutcome = { url: string } | { failure: "stripe" | "long" };

/** The sealed quote's amounts, charged exactly; never a posted number (spec 17.2) */
export async function startCheckout(deps: PrintDeps, basket: ResolvedBasket, payload: QuotePayload): Promise<CheckoutOutcome> {
  const { config, db } = deps;
  if (customText(payload.address, gstSentence(config.gst)).length > CUSTOM_TEXT_LIMIT) return { failure: "long" };
  const now = deps.now();
  const id = ulid(now * 1000);
  // The order first, so a payment can never arrive for an order the site doesn't know (spec 19)
  await createOrder(db, { id, country: payload.address.country, printTotal: payload.printTotal, deliveryAmount: payload.deliveryAmount, deliveryTaxed: hasTax(payload.taxes) ? 1 : 0, livemode: livemodeOf(config.secrets.STRIPE_SECRET_KEY), now }, basket.lines);
  const orderPage = await orderPageUrl(config, id);
  // The Idempotency-Key guards only a retried identical request; a double submit makes two orders by design (spec 17.2)
  const result = await stripe(deps, "POST", "/v1/checkout/sessions", sessionForm({ orderId: id, lines: basket.lines, payload, config, orderPage, now }), `checkout-${id}`);
  const session = result.ok && typeof result.body.id === "string" && typeof result.body.url === "string" ? { id: result.body.id, url: result.body.url } : null;
  if (!session) {
    console.error("prints: stripe didn't create a checkout for order", id, result.ok ? "an answer without a page" : (result.status ?? "no answer"));
    // Should the store fail too, the row stays checkout with no session: never paid, and nothing for the buyer to pay
    await markExpired(db, id, deps.now()).catch(() => false);
    return { failure: "stripe" };
  }
  try {
    await setSession(db, id, session.id, deps.now());
  } catch (error) {
    // The buyer never sees that session's page, so it can't be paid; say nothing was charged rather than a broken basket
    console.error("prints: couldn't record the session of order", id, error instanceof Error ? error.message : String(error));
    await markExpired(db, id, deps.now()).catch(() => false);
    return { failure: "stripe" };
  }
  return { url: session.url };
}
