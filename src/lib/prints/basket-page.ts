import { checkAddress, EMPTY_ADDRESS, readAddress, type Address, type AddressErrors } from "./address";
import { priceCheck } from "./artelo";
import { basketHref, CAP_NOTE, changeLines, droppedNotes, itemsValue, parseItems, readOp } from "./basket";
import { startCheckout } from "./checkout";
import type { PrintDeps } from "./config";
import { freshRate } from "./fx";
import { arteloKey, clientKey, underLimit, type PrintLimits } from "./limits";
import { gstSentence } from "./money";
import { canOpen } from "./open";
import { breakdown, deliveryAmount, deliveryLabel } from "./quote";
import { openQuote, QUOTE_SECONDS, sameQuote, sealQuote, type QuotePayload } from "./seal";
import { loadBasket, type PrintSettings, type ResolvedBasket } from "./store";

// /basket (spec 15.2 to 16.3): the basket from its query string, the address form and the quote. A POST render can't be
// redirected without putting the address in a URL or storing it, so the quote answers 200, not post, redirect, get.

export interface QuoteView {
  printTotal: number;
  deliveryAmount: number;
  label: string;
  breakdown: string;
  /** The sealed quote, for the pay form's hidden field */
  token: string;
}

export interface BasketView {
  basket: ResolvedBasket;
  /** Lines about prints taken out or refused */
  notes: string[];
  open: boolean;
  /** False while the stored rate is missing or over a week old: the basket shows RATE_DOWN in place of the address form */
  quotable: boolean;
  /** What the address form shows: empty on a GET, as posted on a POST */
  address: Address;
  errors: AddressErrors & { form?: string };
  quote: QuoteView | null;
  gst: string;
}

export type BasketOutcome = { redirect: string } | { status: number; view: BasketView; beacon: boolean };

export const FORM_UNREADABLE = "that form couldn't be read. try again.";
export const QUOTE_CHANGED = "that quote has changed or run out. quote delivery again.";
/** No rate, or one over a week old: nothing can be quoted until the daily job stores a fresh one (ADR-0021 as amended) */
export const RATE_DOWN = "delivery prices can't be checked right now. try again later.";

// Open is the switch and the secrets alone (spec 16.5): a closed basket is the page's 404. A missing or stale rate leaves the
// basket open, editable and unquotable, so a buyer's basket survives until the daily job stores a fresh rate
function viewOf(deps: PrintDeps, basket: ResolvedBasket, settings: PrintSettings, over: Partial<BasketView> = {}): BasketView {
  return {
    basket, notes: droppedNotes(basket.unavailable, basket.overCap), open: canOpen(deps.config), quotable: freshRate(settings, deps.now()) !== null,
    address: { ...EMPTY_ADDRESS }, errors: {}, quote: null, gst: gstSentence(deps.config.gst), ...over,
  };
}

/**
 * The basket, or a change to it answered with 303 to the canonical URL; a change that can't apply renders with its line.
 * A closed basket changes nothing, so the page can answer it with a 404 rather than a redirect.
 */
export async function basketGet(deps: PrintDeps, url: URL): Promise<BasketOutcome> {
  const op = readOp(url.searchParams);
  const raw = parseItems(url.searchParams.get("items"));
  const { basket, settings } = await loadBasket(deps.db, op?.kind === "add" ? [...raw, op.entry] : raw);
  const view = viewOf(deps, basket, settings);
  if (!view.open) return { status: 200, view, beacon: true };
  if (op && view.notes.length === 0) {
    if (op.kind === "add") return { redirect: basketHref(basket.items) };
    const changed = changeLines(basket.lines, op);
    if (!changed.refused) return { redirect: basketHref(itemsValue(changed.lines)) };
    view.notes.push(CAP_NOTE);
  }
  return { status: 200, view, beacon: true };
}

export async function quoteView(secret: string, payload: QuotePayload): Promise<QuoteView> {
  return { printTotal: payload.printTotal, deliveryAmount: payload.deliveryAmount, label: deliveryLabel(payload.taxes), breakdown: breakdown(payload), token: await sealQuote(secret, payload) };
}

/** intent=quote (spec 16.1) or intent=checkout (spec 17.2), both posted by the one address form. A POST render carries no beacon */
export async function basketPost(deps: PrintDeps, request: Request, url: URL, limits: PrintLimits): Promise<BasketOutcome> {
  const form = await request.formData().catch(() => null);
  const { basket, settings } = await loadBasket(deps.db, parseItems(url.searchParams.get("items")));
  const address = form ? readAddress(form) : { ...EMPTY_ADDRESS };
  const render = (status: number, over: Partial<BasketView> = {}): BasketOutcome => ({ status, beacon: false, view: viewOf(deps, basket, settings, { address, ...over }) });
  const intent = form?.get("intent");
  if (intent === "checkout") return checkout(deps, request, form?.get("quote"), basket, address, limits, render);
  if (intent !== "quote") return render(422, { errors: { form: FORM_UNREADABLE } });

  // What can be refused without any work counts against no limit: a closed basket (the page's 404), an empty one, and no
  // rate the daily job stored in the last week (settings.rate alone could be a month old: spec 16.4, tightened)
  if (!canOpen(deps.config) || basket.count === 0) return render(200);
  const rate = freshRate(settings, deps.now());
  if (rate === null) return render(503);
  const { testClients } = deps.config;
  const tooMany = () => render(429, { errors: { form: "too many quotes - wait a minute and try again." } });
  // The visitor's limit before any checking; the shared Artelo bucket only for a quote that will reach Artelo (spec 16.1, 21.3)
  if (!(await underLimit(limits.quote, clientKey(request, testClients)))) return tooMany();
  if (basket.unavailable > 0 || basket.overCap > 0) return render(422);
  const checked = checkAddress(address);
  if (!checked.ok) return render(422, { errors: checked.errors });
  if (!(await underLimit(limits.artelo, arteloKey(request, testClients)))) return tooMany();
  const result = await priceCheck(deps, basket.lines, checked.address, rate);
  if (!result.ok) {
    if (result.refused === null) return render(503, { errors: { form: "delivery prices aren't loading right now. try again in a minute." } });
    return render(422, { errors: { form: result.refused ? `artelo couldn't quote delivery to this address: ${result.refused}` : "artelo couldn't quote delivery to this address." } });
  }
  const payload: QuotePayload = {
    items: basket.items, address: checked.address, printTotal: basket.printTotal,
    deliveryAmount: deliveryAmount(result.costs.freightCents, result.costs.taxes, rate, settings.buffer),
    freightCents: result.costs.freightCents, taxes: result.costs.taxes, buffer: settings.buffer, rate, expires: deps.now() + QUOTE_SECONDS,
  };
  return render(200, { address: checked.address, quote: await quoteView(deps.config.secrets.PRINT_VIEW_SECRET, payload) });
}

type Render = (status: number, over?: Partial<BasketView>) => BasketOutcome;

/**
 * intent=checkout (spec 17.2): the visible address fields, as posted, against the sealed quote, exactly, or nothing is
 * created and nothing is charged. Once sameQuote holds, the seal's address is the posted one, so Stripe gets payload.address
 */
async function checkout(deps: PrintDeps, request: Request, token: FormDataEntryValue | null | undefined, basket: ResolvedBasket, address: Address, limits: PrintLimits, render: Render): Promise<BasketOutcome> {
  // A closed basket (the page's 404) or an empty one creates nothing and counts against no limit
  if (!canOpen(deps.config) || basket.count === 0) return render(200);
  if (!(await underLimit(limits.checkout, clientKey(request, deps.config.testClients)))) return render(429, { errors: { form: "too many tries - wait a minute and try again." } });
  // Every photo still published and every size still offered (15.2); a dropped entry shows its line
  if (basket.unavailable > 0 || basket.overCap > 0) return render(422);
  const payload = typeof token === "string" ? await openQuote(deps.config.secrets.PRINT_VIEW_SECRET, token, deps.now()) : null;
  // An edited address, an edited basket, a quote past its 30 minutes or a price list changed since: quote again
  if (!payload || !sameQuote(payload, basket.items, address) || payload.printTotal !== basket.printTotal) return render(422, { errors: { form: QUOTE_CHANGED } });
  const outcome = await startCheckout(deps, basket, payload);
  if ("url" in outcome) return { redirect: outcome.url };
  if (outcome.failure === "long") return render(422, { errors: { form: "that address is too long for the payment page. shorten it and quote again." } });
  return render(503, { errors: { form: "couldn't reach the payment page. nothing was charged - try again in a minute." } });
}
