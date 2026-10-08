import type { Address } from "./address";
import type { Frame, Orientation, PrintSize } from "./catalogue";
import type { PrintDeps } from "./config";
// With its extension: bun run prints:check (Task 14) runs this file under plain Node, which resolves no bare relative paths
import { DELIVERY_CEILING_CENTS, deliveryAmount, MAX_BUFFER, readOrderCosts, type OrderCosts } from "./quote.ts";
import type { Shipment } from "./store";

// Artelo's open API (spec 16.1, 18.2, 18.3), through fetch with the key and a 15-second timeout. Nothing here throws:
// every call answers ok with a body, or not ok with a status (null for a network error, a timeout or an unreadable 2xx).

export const ARTELO_TIMEOUT_MS = 15_000;

export type ArteloResult = { ok: true; status: number; body: unknown } | { ok: false; status: number | null; message: string };

/** Artelo's message on its way to someone: a buyer's refusal line, or a needs_attention reason once scrubbed of the address */
export const SHOWN_MESSAGE = 200;
/** A bound for memory only: the order path scrubs the whole message before it cuts it, so no address is cut in half */
export const MESSAGE_LIMIT = 2_000;

/** Artelo's own message from an error body, whitespace collapsed, at most MESSAGE_LIMIT characters; "" when it has none (a proxy's html page, say) */
export function messageOf(body: unknown, text: string): string {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const first = Array.isArray(record.errors) ? record.errors[0] : undefined;
  const candidates = [record.message, record.error, record.title, first, first && typeof first === "object" ? (first as Record<string, unknown>).message : undefined];
  const found = candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "");
  const plain = body === null && text && !/<[a-z!/]/i.test(text) ? text : "";
  return (found ?? plain).replace(/\s+/g, " ").trim().slice(0, MESSAGE_LIMIT);
}

export async function artelo(deps: PrintDeps, method: "GET" | "POST", path: string, body?: unknown): Promise<ArteloResult> {
  let response: Response;
  try {
    response = await deps.fetch(`${deps.config.arteloBase}${path}`, {
      method,
      headers: { Authorization: `Bearer ${deps.config.secrets.ARTELO_API_KEY}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(ARTELO_TIMEOUT_MS),
      // A redirect is never followed: the key goes to the configured host and nowhere else, and a 3xx is unavailable
      redirect: "manual",
    });
  } catch {
    return { ok: false, status: null, message: "" };
  }
  const text = await response.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (response.ok) return parsed === null ? { ok: false, status: null, message: "" } : { ok: true, status: response.status, body: parsed };
  return { ok: false, status: response.status, message: messageOf(parsed, text) };
}

/** The address as Artelo takes it, the same for a quote and an order (spec 16.1, 18.2 step 5) */
export function arteloAddress(address: Address) {
  return {
    name: address.name,
    street1: address.line1,
    ...(address.line2 ? { street2: address.line2 } : {}),
    city: address.city || address.state,
    state: address.state || address.city,
    zipcode: address.postcode,
    country: address.country,
    // Artelo needs a phone only outside the US
    ...(address.country === "US" ? {} : { phone: address.phone }),
  };
}

export interface ProductLine {
  size: PrintSize;
  frame: Frame;
  orientation: Orientation;
}

/** One print as Artelo makes it (spec 14.1): its size, oak or no frame, the paper, its orientation; designs only at order time */
export function productInfo(line: ProductLine, design?: string) {
  return {
    catalogProductId: "IndividualArtPrint",
    size: line.size.size,
    frameColor: line.frame === "oak" ? "NaturalOak" : null,
    paperType: "ArchivalMatteFineArt",
    orientation: line.orientation,
    canvasDesignedFor: null,
    canvasBorderStyle: null,
    includeFramingService: false,
    includeHangingPins: false,
    includeMats: false,
    ...(design ? { designs: [{ sourceImage: { url: design }, fitOptions: { canvas: "Paper", style: "Outside" } }] } : {}),
  };
}

export interface QuoteLine extends ProductLine {
  line: number;
  quantity: number;
  /** AUD cents */
  unitAmount: number;
}

export function priceCheckBody(lines: readonly QuoteLine[], address: Address, rate: number, quoteId: string) {
  return {
    orderId: quoteId,
    currency: "USD",
    customerAddress: arteloAddress(address),
    // unitPrice is informational: the tier price converted to US dollars at the current rate
    items: lines.map((line) => ({ orderItemId: String(line.line), quantity: line.quantity, unitPrice: Math.round(line.unitAmount / rate) / 100, productInfo: productInfo(line) })),
  };
}

const hex = (count: number) => [...crypto.getRandomValues(new Uint8Array(count))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** refused is Artelo's message (possibly "") when it won't quote this basket or address; null when it couldn't be asked */
export type PriceCheck = { ok: true; costs: OrderCosts } | { ok: false; refused: string | null };

/** Artelo's quote for the whole basket to this address (spec 16.1). Its refusals are logged only as a status code */
export async function priceCheck(deps: PrintDeps, lines: readonly QuoteLine[], address: Address, rate: number): Promise<PriceCheck> {
  const result = await artelo(deps, "POST", "/orders/price-check", priceCheckBody(lines, address, rate, `quote-${hex(8)}`));
  if (!result.ok) {
    if (result.status === 400 || result.status === 422) {
      console.error("prints: artelo refused a price check", result.status);
      return { ok: false, refused: result.message.slice(0, SHOWN_MESSAGE) };
    }
    console.error("prints: artelo's price check is unavailable", result.status ?? "no answer");
    return { ok: false, refused: null };
  }
  const costs = readOrderCosts((result.body as { orderCosts?: unknown } | null)?.orderCosts);
  if (!costs) {
    console.error("prints: artelo's price check answer couldn't be read");
    return { ok: false, refused: null };
  }
  // Spec 16.1's sanity ceiling, at the largest buffer the settings allow: a figure this high is a misread, not a price
  if (deliveryAmount(costs.freightCents, costs.taxes, rate, MAX_BUFFER) > DELIVERY_CEILING_CENTS) {
    console.error("prints: ignored an artelo price check whose delivery is over the ceiling");
    return { ok: false, refused: null };
  }
  return { ok: true, costs };
}

/** An order as Artelo's Create Order, Get Orders and Get Order by Id answer it */
export interface ArteloOrder {
  /** Artelo's own id */
  id: string;
  /** Ours, the orderId we sent */
  orderId: string | null;
  status: string | null;
  /** US cents: production, freight and any tax, from its details */
  costCents: number | null;
  shipments: Shipment[] | null;
}

/** An object, or the object inside its top-level data, which Artelo's webhook example uses */
export function unwrap(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return record.data && typeof record.data === "object" && !Array.isArray(record.data) ? (record.data as Record<string, unknown>) : record;
}

/** Bounds on Artelo's tracking, which is text from outside: the carrier and number are cut, a longer link is dropped */
export const TRACKING_LIMITS = { carrier: 40, number: 64, url: 500, shipments: 10 } as const;

/**
 * One line: invisible formatting characters (bidi overrides, zero-width characters and the rest of Unicode's Cf, which
 * could reorder or hide what the buyer reads) go, and any run of whitespace or control characters (newlines included)
 * becomes one space
 */
const oneLine = (text: string, limit: number) => text.replace(/\p{Cf}+/gu, "").replace(/[\s\p{Cc}]+/gu, " ").trim().slice(0, limit);
const textOf = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "");

/**
 * A parcel's tracking as it may be stored and shown: the carrier (lowercase) and number on one line each and capped, and
 * the link only when it is a whole https URL with nothing invisible in it, because it becomes a link (the rule mail.ts's shippedText applies again at
 * send time). Null when neither a number nor a link is left
 */
export function cleanShipment(carrier: unknown, number: unknown, url: unknown): Shipment | null {
  const link = textOf(url).trim();
  const shipment = {
    carrier: oneLine(textOf(carrier), TRACKING_LIMITS.carrier).toLowerCase(),
    number: oneLine(textOf(number), TRACKING_LIMITS.number),
    url: /^https:\/\/\S+$/i.test(link) && !/[\p{Cc}\p{Cf}]/u.test(link) && link.length <= TRACKING_LIMITS.url ? link : "",
  };
  return shipment.number || shipment.url ? shipment : null;
}

/** Artelo's shipments (carrierCode, trackingNumber, trackingUrl), each cleaned, at most ten */
export function readShipments(value: unknown): Shipment[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .flatMap((entry): Shipment[] => {
      if (!entry || typeof entry !== "object") return [];
      const { carrierCode, trackingNumber, trackingUrl } = entry as Record<string, unknown>;
      const shipment = cleanShipment(carrierCode, trackingNumber, trackingUrl);
      return shipment ? [shipment] : [];
    })
    .slice(0, TRACKING_LIMITS.shipments);
}

/** The shipments column's value, cleaned again where it is written whatever the caller passed; null when none are left */
export function shipmentsColumn(shipments: readonly Shipment[] | null): string | null {
  const clean = (shipments ?? []).flatMap((shipment): Shipment[] => {
    const cleaned = shipment && typeof shipment === "object" ? cleanShipment(shipment.carrier, shipment.number, shipment.url) : null;
    return cleaned ? [cleaned] : [];
  });
  return clean.length > 0 ? JSON.stringify(clean.slice(0, TRACKING_LIMITS.shipments)) : null;
}

export function readArteloOrder(value: unknown): ArteloOrder | null {
  const record = unwrap(value);
  if (!record) return null;
  const id = typeof record.id === "string" || typeof record.id === "number" ? String(record.id) : "";
  if (!id) return null;
  const costs = readOrderCosts(record.details, "order's costs");
  return {
    id,
    orderId: typeof record.orderId === "string" ? record.orderId : null,
    status: typeof record.status === "string" ? record.status : null,
    costCents: costs && costs.productionCents !== null ? costs.productionCents + costs.freightCents + costs.taxes.reduce((sum, tax) => sum + tax.cents, 0) : null,
    shipments: readShipments(record.shipments),
  };
}

/** Get Orders' list: an array, or one under orders, data or items; null for anything else, which is a failed lookup */
export function ordersList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["orders", "data", "items"]) if (Array.isArray(record[key])) return record[key] as unknown[];
  return null;
}
