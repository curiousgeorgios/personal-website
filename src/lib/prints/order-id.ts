/**
 * A print order's id: a lowercase ULID, as checkout makes it (`ulid()` in src/lib/admin/ulid.ts). The one definition of
 * the shape, used wherever an id arrives from outside: the order page, /admin's retry and Stripe's events (ADR-0027)
 */
export const ORDER_ID = /^[0-9a-hjkmnp-tv-z]{26}$/;

/** Whether a value has a print order id's shape */
export const isOrderId = (value: unknown): value is string => typeof value === "string" && ORDER_ID.test(value);
