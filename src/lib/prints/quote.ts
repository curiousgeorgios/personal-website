// Value imports here carry their .ts extension: bun run prints:check (Task 14) runs this file under plain Node
import { rateText, usd } from "./money.ts";

// Delivery is Artelo's exact quoted freight for the whole basket and address, plus any destination tax Artelo quotes,
// converted to dollars with a small buffer and rounded up (spec 16.1). George neither profits nor loses on it.

/** One destination tax from Price Check's orderCosts, in US cents, with its label for the breakdown */
export interface TaxLine {
  field: string;
  label: string;
  cents: number;
}

export interface OrderCosts {
  /** arteloShipping, in US cents */
  freightCents: number;
  /** productionCost, in US cents, when Artelo sent it */
  productionCents: number | null;
  /** Every non-zero tax field */
  taxes: TaxLine[];
}

// Only the tax fields in Artelo's Price Check reference count as tax: a name that merely looks like one (a total, a rate, a
// fee with "vat" inside it) must never set what a buyer pays. Anything else this site doesn't know refuses the quote.
const TAX_ORDER = ["usSalesTax", "gst", "hst", "pst"] as const;
const TAX_LABELS: Record<string, string> = { usSalesTax: "us sales tax", gst: "canadian gst", hst: "canadian hst", pst: "canadian pst" };
/** Charges that sit in Artelo's total beside production, freight and tax; wholesaleDiscount comes off it */
const ADDED_COSTS = ["productionCost", "branding", "customPricingAdjustment", "holidayFees"];
const RECOGNISED = new Set([...TAX_ORDER, ...ADDED_COSTS, "arteloShipping", "wholesaleDiscount", "amountRefunded", "total"]);

/** The largest delivery buffer print_settings accepts (spec 16.4) */
export const MAX_BUFFER = 0.2;
/** A sanity ceiling on the converted delivery, A$500 in cents: anything above it is a misread, not a price (spec 16.1) */
export const DELIVERY_CEILING_CENTS = 50_000;

export const cents = (dollars: number) => Math.round(dollars * 100);

/**
 * Reads Price Check's orderCosts (or an order's details). Null, unavailable, when it can't be trusted: no usable
 * arteloShipping, a negative or non-numeric amount, a charge field this site doesn't know, or parts that don't add up to
 * Artelo's total. The reason is logged, by field name and the source it came from, never with anything about the buyer.
 */
export function readOrderCosts(value: unknown, source = "price check"): OrderCosts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const costs = value as Record<string, unknown>;
  const freight = costs.arteloShipping;
  if (typeof freight !== "number" || !Number.isFinite(freight) || freight < 0) return null;
  const refuse = (reason: string) => {
    console.error(`prints: ignored an artelo ${source}:`, reason);
    return null;
  };
  const amounts = new Map<string, number>();
  for (const [field, amount] of Object.entries(costs)) {
    const recognised = RECOGNISED.has(field);
    if (typeof amount !== "number") {
      // A recognised charge that isn't a number can't be summed; anything else (a currency, a note) isn't a charge
      if (recognised && amount !== null && amount !== undefined) return refuse(`${field} is not an amount`);
      continue;
    }
    if (!Number.isFinite(amount) || amount < 0) return refuse(`${field} is not a usable amount`);
    if (!recognised) return refuse(`a charge this site doesn't know: ${field}`);
    amounts.set(field, amount);
  }
  const taxes: TaxLine[] = [];
  for (const field of TAX_ORDER) {
    const tax = cents(amounts.get(field) ?? 0);
    if (tax !== 0) taxes.push({ field, label: TAX_LABELS[field], cents: tax });
  }
  const total = amounts.get("total");
  if (total !== undefined) {
    const added = ADDED_COSTS.reduce((sum, field) => sum + cents(amounts.get(field) ?? 0), 0);
    const parts = added + cents(freight) + taxes.reduce((sum, tax) => sum + tax.cents, 0) - cents(amounts.get("wholesaleDiscount") ?? 0);
    if (Math.abs(cents(total) - parts) > 1) return refuse(`total ${cents(total)} against its parts ${parts} (cents)`);
  }
  const production = amounts.get("productionCost");
  return { freightCents: cents(freight), productionCents: production === undefined ? null : cents(production), taxes };
}

/** AUD cents, a whole number of dollars: ceil((freight + tax) × rate × (1 + buffer)). Refuses inputs the settings never allow */
export function deliveryAmount(freightCents: number, taxes: readonly TaxLine[], rate: number, buffer: number): number {
  const usdCents = freightCents + taxes.reduce((sum, tax) => sum + tax.cents, 0);
  if (!Number.isSafeInteger(usdCents) || usdCents < 0) throw new RangeError(`not an amount in cents: ${usdCents}`);
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError(`not a rate: ${rate}`);
  if (!(buffer >= 0 && buffer <= MAX_BUFFER)) throw new RangeError(`not a buffer: ${buffer}`);
  const dollars = (usdCents / 100) * rate * (1 + buffer);
  // Floating point leaves noise above a whole dollar (150 × 1.5 × 1.08 is 243.00000000000003); 1e-10 clears it and is far
  // below the smallest real fraction (a cent, times a four-decimal rate, times a whole-percent buffer: 1e-8)
  return Math.max(0, Math.ceil(dollars - 1e-10)) * 100;
}

export const hasTax = (taxes: readonly TaxLine[]) => taxes.some((tax) => tax.cents > 0);

/** The line's name on the basket, Stripe's page, the order page and the admin (spec 16.1) */
export const deliveryLabel = (taxes: readonly TaxLine[]): "delivery" | "delivery and destination taxes" => (hasTax(taxes) ? "delivery and destination taxes" : "delivery");

/** How the delivery line was reached, from the sealed figures (spec 16.3) */
export function breakdown(quote: { freightCents: number; taxes: readonly TaxLine[]; rate: number; buffer: number }): string {
  const parts = [`artelo's freight ${usd(quote.freightCents)}`, ...quote.taxes.map((tax) => `${tax.label} ${usd(tax.cents)}`)];
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  // One decimal, so a buffer that isn't a whole percent isn't misstated; none at all leaves the clause out
  const buffer = Number((quote.buffer * 100).toFixed(1));
  let text = `${list} for this address, converted at ${rateText(quote.rate)} per us$1${buffer > 0 ? `, plus ${buffer}% in case the exchange rate moves` : ""}, rounded up to the dollar.`;
  if (quote.taxes.length === 1) text += " artelo charges me that tax for posting to this address, so it's passed on at cost.";
  if (quote.taxes.length > 1) text += " artelo charges me those taxes for posting to this address, so they're passed on at cost.";
  return text;
}
