import type { OrderStatus } from "./store";
import { isCanonicalViewKey, viewKeyMatches } from "./view-key";

/** The order page's status line by status, [several prints, one print] (spec 18.5). Buyer words only: never Artelo's message or an internal reason */
export const ORDER_STATUS_LINES: Record<OrderStatus, [string, string]> = {
  checkout: ["your payment's on its way through. this page updates when it lands.", "your payment's on its way through. this page updates when it lands."],
  expired: ["this checkout wasn't finished, so nothing was charged.", "this checkout wasn't finished, so nothing was charged."],
  paid: ["paid. your prints are being sent to the printer.", "paid. your print is being sent to the printer."],
  needs_attention: ["paid. something needs sorting before they print. george knows and will email you.", "paid. something needs sorting before it prints. george knows and will email you."],
  placed: ["they're with the printer.", "it's with the printer."],
  in_production: ["they're being printed and packed.", "it's being printed and packed."],
  shipped: ["they're on their way:", "it's on its way:"],
  delivered: ["delivered. enjoy them.", "delivered. enjoy it."],
  cancelled: ["this order was cancelled. george will be in touch about a refund.", "this order was cancelled. george will be in touch about a refund."],
  refunded: ["refunded.", "refunded."],
};

/** An order id's shape (a lowercase ULID) */
const ORDER_ID = /^[0-9a-hjkmnp-tv-z]{26}$/;

/** A canonical key (43 characters, 32 bytes, one spelling) that no order has: stands in for any key that isn't one */
const DECOY_KEY = "A".repeat(43);

/**
 * Whether a request may see an order's page (spec 18.5). One HMAC verification runs whatever arrives: a missing key, a
 * malformed key, a malformed order id, an unknown order id and a wrong key all cost the same, so how long the 404 takes
 * says nothing about whether an order exists. The order is read only after this says yes
 */
export async function canViewOrder(secret: string, id: string, key: string | null): Promise<boolean> {
  const canonical = isCanonicalViewKey(key);
  const matches = await viewKeyMatches(secret, id, canonical ? key : DECOY_KEY);
  return matches && canonical && ORDER_ID.test(id);
}
