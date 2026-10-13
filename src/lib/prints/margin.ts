// The margin check's arithmetic and addresses (spec 17.5). Value imports carry their .ts extension: bun run prints:check
// runs this file under plain Node
import type { Address } from "./address";
import { FAMILIES, FRAMES, TIERS, type Frame, type PrintSize, type Tier } from "./catalogue.ts";
import { deliveryAmount, type TaxLine } from "./quote.ts";

/** Stripe's international card rate in Australia, the worse of its two (assumption 15) */
export const CARD_RATE = 0.035;
export const CARD_FIXED = 30;
/** Production is converted at the rate plus 3%: deliberately conservative, though George's card has no foreign fee */
export const FX_MARGIN = 0.03;
export const FAIL_BELOW = 0.15;
export const WARN_BELOW = 0.3;
export const TOTAL_DRIFT = 0.05;

export interface Combination {
  family: string;
  tier: Tier;
  size: PrintSize;
  frame: Frame;
}

/** Every size in the table, unframed and oak */
export const COMBINATIONS: Combination[] = FAMILIES.flatMap((family) => TIERS.flatMap((tier) => FRAMES.map((frame) => ({ family: family.name, tier, size: family.tiers[tier], frame }))));

export interface Margin {
  /** AUD cents, at the rate plus 3% */
  productionAud: number;
  cardFee: number;
  /** What the buyer pays for delivery at this rate and buffer */
  deliveryAud: number;
  /** What the delivery line fails to cover of the freight, any destination tax and its card fee, worst case */
  shortfall: number;
  margin: number;
  /** The margin as a share of the price */
  share: number;
}

/** taxes are the destination taxes Price Check quoted, which the delivery line passes on at cost like the freight */
export function marginFor(input: { priceCents: number; productionUsdCents: number; freightUsdCents: number; taxes?: readonly TaxLine[]; rate: number; buffer: number }): Margin {
  const worst = input.rate * (1 + FX_MARGIN);
  const taxes = input.taxes ?? [];
  const productionAud = Math.round(input.productionUsdCents * worst);
  const cardFee = Math.round(input.priceCents * CARD_RATE) + CARD_FIXED;
  const deliveryAud = deliveryAmount(input.freightUsdCents, taxes, input.rate, input.buffer);
  const passedOn = input.freightUsdCents + taxes.reduce((sum, tax) => sum + tax.cents, 0);
  const shortfall = Math.max(0, Math.round(passedOn * worst) + Math.round(deliveryAud * CARD_RATE) - deliveryAud);
  const margin = input.priceCents - productionAud - cardFee - shortfall;
  return { productionAud, cardFee, deliveryAud, shortfall, margin, share: margin / input.priceCents };
}

export const verdict = (share: number): "fail" | "warn" | "ok" => (share < FAIL_BELOW ? "fail" : share < WARN_BELOW ? "warn" : "ok");

export const drifted = (quotedCents: number, catalogueCents: number) => Math.abs(quotedCents - catalogueCents) / catalogueCents > TOTAL_DRIFT;

const place = (name: string, line1: string, city: string, state: string, postcode: string, country: string, phone: string): Address => ({ name, line1, line2: "", city, state, postcode, country, phone });

/** Public landmark addresses, sent only to Artelo's Price Check by George's own run */
export const LANDMARKS: { label: string; address: Address }[] = [
  { label: "sydney opera house", address: place("price check", "Bennelong Point", "Sydney", "NSW", "2000", "AU", "+61 2 0000 0000") },
  { label: "parliament house darwin", address: place("price check", "State Square", "Darwin", "NT", "0800", "AU", "+61 8 0000 0000") },
  { label: "the white house", address: place("price check", "1600 Pennsylvania Avenue NW", "Washington", "DC", "20500", "US", "") },
  { label: "iolani palace", address: place("price check", "364 South King Street", "Honolulu", "HI", "96813", "US", "") },
  { label: "10 downing street", address: place("price check", "10 Downing Street", "London", "", "SW1A 2AA", "GB", "+44 20 0000 0000") },
];

/** Stripe accepts Antarctica as a shipping country; Artelo's real answer there is printed for the refusal handling (16.1) */
export const ANTARCTICA: Address = place("price check", "McMurdo Station", "McMurdo Station", "", "", "AQ", "+1 000 000 0000");
