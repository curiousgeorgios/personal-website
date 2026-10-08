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
  /** Numeric fields that are neither a known cost nor a tax, by name, so a new Artelo charge is noticed */
  unknown: string[];
}

const KNOWN_COSTS = new Set(["productionCost", "arteloShipping", "branding", "customPricingAdjustment", "holidayFees", "wholesaleDiscount", "amountRefunded", "total"]);
const TAX_ORDER = ["usSalesTax", "gst", "hst", "pst"];
const TAX_LABELS: Record<string, string> = { usSalesTax: "us sales tax", gst: "canadian gst", hst: "canadian hst", pst: "canadian pst" };
const TAX_LIKE = /tax|vat|gst|hst|pst|duty/i;
const rank = (field: string) => (TAX_ORDER.includes(field) ? TAX_ORDER.indexOf(field) : TAX_ORDER.length);

export const cents = (dollars: number) => Math.round(dollars * 100);

/** Reads Price Check's orderCosts (or an order's details); null when there is no usable arteloShipping */
export function readOrderCosts(value: unknown): OrderCosts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const costs = value as Record<string, unknown>;
  const freight = costs.arteloShipping;
  if (typeof freight !== "number" || !Number.isFinite(freight) || freight < 0) return null;
  const taxes: TaxLine[] = [];
  const unknown: string[] = [];
  for (const [field, amount] of Object.entries(costs)) {
    if (typeof amount !== "number" || !Number.isFinite(amount) || KNOWN_COSTS.has(field)) continue;
    if (TAX_ORDER.includes(field) || TAX_LIKE.test(field)) {
      if (amount !== 0) taxes.push({ field, label: TAX_LABELS[field] ?? field.toLowerCase(), cents: cents(amount) });
    } else unknown.push(field);
  }
  taxes.sort((a, b) => rank(a.field) - rank(b.field) || a.field.localeCompare(b.field));
  const production = costs.productionCost;
  return { freightCents: cents(freight), productionCents: typeof production === "number" && Number.isFinite(production) ? cents(production) : null, taxes, unknown };
}

/** AUD cents, a whole number of dollars: ceil((freight + tax) × rate × (1 + buffer)) */
export function deliveryAmount(freightCents: number, taxes: readonly TaxLine[], rate: number, buffer: number): number {
  const usdCents = freightCents + taxes.reduce((sum, tax) => sum + tax.cents, 0);
  const dollars = (usdCents / 100) * rate * (1 + buffer);
  // Six decimals first, so a product like 25 × 1.6 = 40.000000000000004 stays 40
  return Math.ceil(Number(dollars.toFixed(6))) * 100;
}

export const hasTax = (taxes: readonly TaxLine[]) => taxes.some((tax) => tax.cents > 0);

/** The line's name on the basket, Stripe's page, the order page and the admin (spec 16.1) */
export const deliveryLabel = (taxes: readonly TaxLine[]): "delivery" | "delivery and destination taxes" => (hasTax(taxes) ? "delivery and destination taxes" : "delivery");

/** How the delivery line was reached, from the sealed figures (spec 16.3) */
export function breakdown(quote: { freightCents: number; taxes: readonly TaxLine[]; rate: number; buffer: number }): string {
  const parts = [`artelo's freight ${usd(quote.freightCents)}`, ...quote.taxes.map((tax) => `${tax.label} ${usd(tax.cents)}`)];
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  const buffer = Math.round(quote.buffer * 100);
  let text = `${list} for this address, converted at ${rateText(quote.rate)} per us$1${buffer > 0 ? `, plus ${buffer}% in case the exchange rate moves` : ""}, rounded up to the dollar.`;
  if (quote.taxes.length === 1) text += " artelo charges me that tax for posting to this address, so it's passed on at cost.";
  if (quote.taxes.length > 1) text += " artelo charges me those taxes for posting to this address, so they're passed on at cost.";
  return text;
}
