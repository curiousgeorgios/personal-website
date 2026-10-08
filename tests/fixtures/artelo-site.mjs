// A stand-in for every provider the print code calls (spec 23.3), so no print spec reaches a real service. It starts as
// the exchange rate (Frankfurter's shape); later tasks add Artelo's API, Stripe's three endpoints and the mail sink with
// route(), above the last line. Everything it receives is kept in memory for the specs: GET /__requests.
import { createHmac, createHash } from "node:crypto";
import { createServer } from "node:http";
import sharp from "sharp";
import { FIXTURE_SECRETS, FIXTURE_STRIPE_KEY, STAND_IN } from "../e2e/prints-site.ts";

const PORT = 4401;
/** What arrived, for the specs to read */
const received = { fx: 0, priceChecks: [], orders: [], webhooks: [], mail: [] };
const routes = [];

/** A handler for a method and an exact path or a pattern: it gets { url, body, headers, match } and returns [status, value, headers?] */
function route(method, path, handler) {
  routes.push({ method, path, handler });
}
const today = () => new Date().toISOString().slice(0, 10);
const keyed = (headers, key) => headers.authorization === `Bearer ${key}`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sign = (secret, text) => createHmac("sha256", secret).update(text).digest("hex");

route("GET", "/fx", () => {
  received.fx += 1;
  return [200, { amount: 1, base: "USD", date: today(), rates: { AUD: 1.5 } }];
});
route("GET", "/__requests", () => [200, received]);

function start() {
  createServer(async (request, response) => {
    const url = new URL(request.url, STAND_IN);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    for (const { method, path, handler } of routes) {
      if (method !== request.method) continue;
      const match = typeof path === "string" ? (path === url.pathname ? [url.pathname] : null) : path.exec(url.pathname);
      if (!match) continue;
      try {
        const [status, value, headers = {}] = await handler({ url, body, headers: request.headers, match });
        const plain = typeof value === "string";
        response.writeHead(status, { "content-type": plain ? "text/html; charset=utf-8" : "application/json", "cache-control": "no-store", ...headers });
        response.end(plain ? value : JSON.stringify(value));
      } catch (error) {
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end(String(error?.stack ?? error));
      }
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "nothing here" }));
  }).listen(PORT, "127.0.0.1", () => console.log(`print stand-in on ${STAND_IN}`));
}

// Price Check (spec 23.3): US$30.00 freight for any basket, US$40.00 production a print, US$4.20 sales tax for a US
// address and nothing elsewhere, and a refusal with a message for Antarctica
route("POST", "/orders/price-check", ({ body, headers }) => {
  if (!keyed(headers, FIXTURE_SECRETS.ARTELO_API_KEY)) return [401, { message: "invalid api key" }];
  const order = JSON.parse(body);
  received.priceChecks.push(order);
  const country = order.customerAddress?.country;
  if (country === "AQ") return [400, { message: "artelo doesn't deliver to antarctica" }];
  const prints = order.items.reduce((count, item) => count + item.quantity, 0);
  const tax = country === "US" ? 4.2 : 0;
  return [200, { orderCosts: { productionCost: 40 * prints, arteloShipping: 30, usSalesTax: tax, gst: 0, hst: 0, pst: 0, total: 40 * prints + 30 + tax } }];
});

// Stripe's three endpoints (spec 23.3, "Decisions"): sessions are kept with the form that made them, so the specs can
// read what the site sent. /__stripe/pay completes one as Checkout would and answers its checkout.session.completed
// event, which the spec signs and delivers itself
const stripe = { sessions: new Map(), intents: new Map(), charges: new Map(), keys: new Map(), count: 0, refunds: 0 };
const stripeAuth = (headers) => keyed(headers, FIXTURE_STRIPE_KEY) && headers["stripe-version"] === "2025-09-30.clover";
route("POST", "/stripe/v1/checkout/sessions", ({ body, headers }) => {
  if (!stripeAuth(headers)) return [401, { error: { message: "invalid api key or version" } }];
  const idempotency = headers["idempotency-key"];
  if (idempotency && stripe.keys.has(idempotency)) return [200, stripe.sessions.get(stripe.keys.get(idempotency)).session];
  const form = Object.fromEntries(new URLSearchParams(body));
  const id = `cs_test_standin_${++stripe.count}`;
  let total = 0;
  for (let i = 0; form[`line_items[${i}][quantity]`] !== undefined; i++) total += Number(form[`line_items[${i}][price_data][unit_amount]`]) * Number(form[`line_items[${i}][quantity]`]);
  const metadata = Object.fromEntries(Object.entries(form).flatMap(([name, value]) => (/^metadata\[(.+)\]$/.test(name) ? [[/^metadata\[(.+)\]$/.exec(name)[1], value]] : [])));
  const session = {
    id, object: "checkout.session", url: `${STAND_IN}/stripe/pay/${id}`, status: "open", payment_status: "unpaid", client_reference_id: form.client_reference_id,
    livemode: false, currency: "aud", amount_total: total, payment_intent: null, metadata, customer_details: null,
  };
  stripe.sessions.set(id, { session, form });
  if (idempotency) stripe.keys.set(idempotency, id);
  return [200, session];
});
route("GET", /^\/stripe\/v1\/checkout\/sessions\/([^/]+)$/, ({ headers, match }) => {
  if (!stripeAuth(headers)) return [401, { error: { message: "invalid api key or version" } }];
  const found = stripe.sessions.get(match[1]);
  return found ? [200, found.session] : [404, { error: { message: "no such session" } }];
});
route("POST", /^\/stripe\/v1\/checkout\/sessions\/([^/]+)\/expire$/, ({ headers, match }) => {
  if (!stripeAuth(headers)) return [401, { error: { message: "invalid api key or version" } }];
  const found = stripe.sessions.get(match[1]);
  if (!found || found.session.status !== "open") return [400, { error: { message: "only an open session can be expired" } }];
  found.session.status = "expired";
  return [200, found.session];
});
route("GET", /^\/stripe\/v1\/payment_intents\/([^/]+)$/, ({ headers, match }) => {
  if (!stripeAuth(headers)) return [401, { error: { message: "invalid api key or version" } }];
  const intent = stripe.intents.get(match[1]);
  return intent ? [200, intent] : [404, { error: { message: "no such payment intent" } }];
});
// Completes a session as Checkout would: { session, email?, amount?, conversion? } (amount and conversion make a mismatch)
route("POST", "/__stripe/pay", ({ body }) => {
  const { session: id, email = "buyer@example.com", amount, conversion = false } = JSON.parse(body);
  const found = stripe.sessions.get(id);
  if (!found) return [404, { message: "no such session" }];
  const { session, form } = found;
  const intent = `pi_test_standin_${stripe.count}_${id.split("_").at(-1)}`;
  const field = (name) => form[`payment_intent_data[shipping]${name}`] ?? null;
  const metadata = Object.fromEntries(Object.entries(form).flatMap(([name, value]) => (/^payment_intent_data\[metadata\]\[(.+)\]$/.test(name) ? [[/^payment_intent_data\[metadata\]\[(.+)\]$/.exec(name)[1], value]] : [])));
  stripe.intents.set(intent, {
    id: intent, object: "payment_intent", metadata,
    shipping: { name: field("[name]"), phone: field("[phone]"), address: { line1: field("[address][line1]"), line2: field("[address][line2]"), city: field("[address][city]"), state: field("[address][state]"), postal_code: field("[address][postal_code]"), country: field("[address][country]") } },
  });
  // The payment's charge, which takes a copy of the intent's metadata once, when it is made, as Stripe's does
  stripe.charges.set(intent, { id: `ch_test_standin_${id.split("_").at(-1)}`, object: "charge", payment_intent: intent, amount: amount ?? session.amount_total, amount_refunded: 0, refunded: false, metadata: { ...metadata } });
  Object.assign(session, { status: "complete", payment_status: "paid", payment_intent: intent, customer_details: { email }, ...(amount === undefined ? {} : { amount_total: amount }), ...(conversion ? { currency_conversion: { amount_total: 12345, source_currency: "usd" } } : {}) });
  return [200, { event: { id: `evt_test_standin_${id.split("_").at(-1)}`, object: "event", type: "checkout.session.completed", livemode: false, created: Math.floor(Date.now() / 1000), data: { object: session } } }];
});
route("GET", "/__stripe/sessions", () => [200, [...stripe.sessions.values()]]);
// Refunds a paid session's charge as the dashboard would: { session, amount? } (the whole charge by default). Answers its
// charge.refunded event, for the spec to sign and deliver
route("POST", "/__stripe/refund", ({ body }) => {
  const { session: id, amount } = JSON.parse(body);
  const charge = stripe.charges.get(stripe.sessions.get(id)?.session.payment_intent);
  if (!charge) return [404, { message: "no charge for that session" }];
  charge.amount_refunded = Math.min(charge.amount, charge.amount_refunded + (amount ?? charge.amount));
  charge.refunded = charge.amount_refunded === charge.amount;
  return [200, { event: { id: `evt_test_standin_refund_${++stripe.refunds}`, object: "event", type: "charge.refunded", livemode: false, created: Math.floor(Date.now() / 1000), data: { object: { ...charge, metadata: { ...charge.metadata } } } } }];
});

// The email sink: test builds post here instead of using the EMAIL binding (spec 23.3)
route("POST", "/__mail", ({ body }) => {
  received.mail.push(JSON.parse(body));
  return [204, ""];
});
route("GET", "/__mail", () => [200, received.mail]);

// Orders (spec 23.3). Creation fetches every design URL and records each file's status, type, SHA-256 and size, as
// Artelo would fetch the masters. Its mode is set per order, so parallel specs never share one: "ok", "down" (a 503
// html page) or { refuse: photoId } (a 400 naming that photo's item). Lookups find orders by our orderId
const artelo = { orders: [], modes: new Map(), count: 0 };
async function fetchDesign(url) {
  try {
    const response = await fetch(url);
    const bytes = Buffer.from(await response.arrayBuffer());
    const { width, height, format } = response.ok ? await sharp(bytes).metadata() : {};
    return { url, status: response.status, type: response.headers.get("content-type"), sha256: sha256(bytes), width, height, format };
  } catch (error) {
    return { url, status: 0, error: String(error) };
  }
}
route("POST", "/orders/create", async ({ body, headers }) => {
  if (!keyed(headers, FIXTURE_SECRETS.ARTELO_API_KEY)) return [401, { message: "invalid api key" }];
  const order = JSON.parse(body);
  const mode = artelo.modes.get(order.orderId) ?? "ok";
  received.orders.push({ orderId: order.orderId, mode });
  // Artelo refuses a design under 150 dpi unless dangerouslySkipDPICheck is set; the only png here is the margin check's share card
  if (order.items.some((item) => item.productInfo.designs?.[0]?.sourceImage?.url.endsWith(".png")) && !order.dangerouslySkipDPICheck) return [400, { message: "the dpi of one or more designs falls below the 150 threshold" }];
  if (mode === "down") return [503, "<html><body>service unavailable</body></html>"];
  if (mode && typeof mode === "object" && mode.refuse) {
    const item = order.items.find((entry) => entry.productInfo.designs?.[0]?.sourceImage?.url.includes(`/photos/downloads/${mode.refuse}?`));
    if (item) return [400, { message: `item ${item.orderItemId}: the design for ${mode.refuse} can't be printed` }];
  }
  // The margin check's lookup order (Task 14) has a public image that isn't fetched
  const designs = order.orderId.startsWith("check-") ? [] : await Promise.all(order.items.map((item) => fetchDesign(item.productInfo.designs[0].sourceImage.url)));
  const placed = { id: `artelo-${++artelo.count}`, orderId: order.orderId, status: "Received", order, designs, shipments: [] };
  artelo.orders.push(placed);
  const prints = order.items.reduce((count, item) => count + item.quantity, 0);
  return [200, { id: placed.id, orderId: placed.orderId, status: placed.status, details: { productionCost: 40 * prints, arteloShipping: 30, usSalesTax: 0 } }];
});
route("GET", "/orders/get", ({ url, headers }) => {
  if (!keyed(headers, FIXTURE_SECRETS.ARTELO_API_KEY)) return [401, { message: "invalid api key" }];
  const name = url.searchParams.get("name");
  return [200, artelo.orders.filter((entry) => entry.orderId === name).slice(0, Number(url.searchParams.get("limit") ?? 5)).map(({ id, orderId, status }) => ({ id, orderId, status }))];
});
route("POST", "/__mode", ({ body }) => {
  const { order, mode } = JSON.parse(body);
  artelo.modes.set(order, mode);
  return [204, ""];
});
route("GET", "/__orders", () => [200, artelo.orders]);

// Routes added by later tasks go above this line
start();
