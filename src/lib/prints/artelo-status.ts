import type { OrderStatus } from "./store";

// Artelo's order statuses and what each means for an order here (spec 18.3)

export const PENDING_REASON = "artelo needs something before it can print: open the order in artelo.";
/** A full refund of an order Artelo has (spec 18.1), or reaches while it is being placed: George cancels it there */
export const REFUND_REASON = "refunded in stripe: cancel it in artelo if it hasn't printed.";

export const STATUS_MAP: Record<string, OrderStatus> = {
  ImagesProcessing: "placed",
  Received: "placed",
  // Test orders (isTestOrder) end here
  Ignored: "placed",
  PendingFulfillmentAction: "needs_attention",
  InProduction: "in_production",
  Shipped: "shipped",
  Delivered: "delivered",
  Canceled: "cancelled",
};

/** Every status the webhook asks to hear about (bun run prints:webhook) */
export const ARTELO_STATUSES = Object.keys(STATUS_MAP);

export const mapStatus = (status: unknown): OrderStatus | null => (typeof status === "string" && Object.hasOwn(STATUS_MAP, status) ? STATUS_MAP[status] : null);
