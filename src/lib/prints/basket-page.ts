import { checkAddress, EMPTY_ADDRESS, readAddress, type Address, type AddressErrors } from "./address";
import { priceCheck } from "./artelo";
import { basketHref, CAP_NOTE, changeLines, droppedNotes, itemsValue, parseItems, readOp } from "./basket";
import type { PrintDeps } from "./config";
import { freshRate } from "./fx";
import { arteloKey, clientKey, underLimit, type PrintLimits } from "./limits";
import { gstSentence } from "./money";
import { printsStatus } from "./open";
import { breakdown, deliveryAmount, deliveryLabel } from "./quote";
import { QUOTE_SECONDS, sealQuote, type QuotePayload } from "./seal";
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
  /** What the address form shows: empty on a GET, as posted on a POST */
  address: Address;
  errors: AddressErrors & { form?: string };
  quote: QuoteView | null;
  gst: string;
}

export type BasketOutcome = { redirect: string } | { status: number; view: BasketView; beacon: boolean };

export const FORM_UNREADABLE = "that form couldn't be read. try again.";
/** No rate, or one over a week old: nothing can be quoted until the daily job stores a fresh one (ADR-0021 as amended) */
export const RATE_DOWN = "delivery prices can't be checked right now. try again later.";

function viewOf(deps: PrintDeps, basket: ResolvedBasket, settings: PrintSettings, over: Partial<BasketView> = {}): BasketView {
  return {
    basket, notes: droppedNotes(basket.unavailable, basket.overCap), open: printsStatus(deps.config, settings.rate).open,
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
  // The form says so before anyone types an address it can't quote
  const view = viewOf(deps, basket, settings, freshRate(settings, deps.now()) === null ? { errors: { form: RATE_DOWN } } : {});
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

/** intent=quote (spec 16.1); Task 7 adds intent=checkout. A POST render carries no beacon */
export async function basketPost(deps: PrintDeps, request: Request, url: URL, limits: PrintLimits): Promise<BasketOutcome> {
  const form = await request.formData().catch(() => null);
  const { basket, settings } = await loadBasket(deps.db, parseItems(url.searchParams.get("items")));
  const address = form ? readAddress(form) : { ...EMPTY_ADDRESS };
  const render = (status: number, over: Partial<BasketView> = {}): BasketOutcome => ({ status, beacon: false, view: viewOf(deps, basket, settings, { address, ...over }) });
  const intent = form?.get("intent");
  if (intent !== "quote") return render(422, { errors: { form: FORM_UNREADABLE } });

  // A closed basket takes no quote and counts against no limit; the page answers it with a 404
  if (!printsStatus(deps.config, settings.rate).open) return render(200);
  const { testClients } = deps.config;
  // Both limits before anything that could reach Artelo, so a flood never does (spec 16.1, 21.3)
  if (!(await underLimit(limits.quote, clientKey(request, testClients))) || !(await underLimit(limits.artelo, arteloKey(request, testClients)))) {
    return render(429, { errors: { form: "too many quotes - wait a minute and try again." } });
  }
  if (basket.count === 0) return render(200);
  // Only a rate the daily job stored in the last week quotes: settings.rate alone could be a month old (spec 16.4, tightened)
  const rate = freshRate(settings, deps.now());
  if (rate === null) return render(503, { errors: { form: RATE_DOWN } });
  if (basket.unavailable > 0 || basket.overCap > 0) return render(422);
  const checked = checkAddress(address);
  if (!checked.ok) return render(422, { errors: checked.errors });
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
