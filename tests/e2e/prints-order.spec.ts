import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { arteloOrdersFor, asTestClient, checkoutOrder, deliverStripe, mailFor, orderPageFor, payAtStandIn, placedOrder, printsD1, refundAtStandIn, runCron, setMode, ship, unique, waitForStatus } from "./prints";
import { FIXTURE_SECRETS, PRINTS, STAND_IN } from "./prints-site";

// Whole orders through the stand-ins on 4337: checkout, a paid session, Stripe's event, Artelo's order (spec 23.2)
test.use({ baseURL: PRINTS });
test.skip(({ browserName }) => browserName !== "chromium", "the print specs run in chromium");

test("a paid basket becomes one artelo order with every print, made from the masters, however often stripe's event arrives", async ({ page }) => {
  await asTestClient(page);
  const name = `Ada ${unique()}`;
  const { orderId, sessionId } = await checkoutOrder(page, name);
  const { event } = await payAtStandIn(sessionId);
  expect(await deliverStripe(PRINTS, event)).toBe(200);
  expect(await deliverStripe(PRINTS, event)).toBe(200);
  await waitForStatus(orderId, "placed");
  const orders = await arteloOrdersFor(orderId);
  expect(orders).toHaveLength(1);
  const [{ order, designs }] = orders;
  expect(order.isTestOrder).toBe(true);
  expect(order.customerAddress).toMatchObject({ name, street1: "12 Example Street", street2: "Unit 3", city: "Bondi Beach", state: "NSW", zipcode: "2026", country: "AU", phone: "+61 400 000 000" });
  expect(order.items.map((item) => [item.orderItemId, item.productInfo.size, item.productInfo.frameColor, item.productInfo.orientation, item.productInfo.paperType])).toEqual([
    [`${orderId}-1`, "x12x18", "NaturalOak", "Vertical", "ArchivalMatteFineArt"],
    [`${orderId}-2`, "x8x12", null, "Horizontal", "ArchivalMatteFineArt"],
  ]);
  const masters = Object.fromEntries(printsD1<{ id: string; print_sha256: string }>("SELECT id, print_sha256 FROM photos WHERE id IN ('fixture-b-01', 'fixture-b-02')").map((row) => [row.id, row.print_sha256]));
  expect(designs.map((design) => [new URL(design.url).pathname, design.status, design.type, design.width, design.height, design.sha256])).toEqual([
    ["/photos/downloads/fixture-b-01", 200, "image/jpeg", 4000, 6000, masters["fixture-b-01"]],
    ["/photos/downloads/fixture-b-02", 200, "image/jpeg", 6000, 4000, masters["fixture-b-02"]],
  ]);
  expect(printsD1(`SELECT COUNT(*) AS n FROM stripe_events WHERE id = '${event.id}'`)).toEqual([{ n: 1 }]);
  const [row] = printsD1<Record<string, unknown>>(`SELECT * FROM print_orders WHERE id = '${orderId}'`);
  expect(row).toMatchObject({ artelo_order_id: orders[0].id, artelo_status: "Received", artelo_cost: 11000 });
  // The buyer's name, address and email reach Artelo's order and nowhere in the store: not the order, its lines or the ledger
  const stored = JSON.stringify([row, printsD1(`SELECT * FROM print_order_items WHERE order_id = '${orderId}'`), printsD1("SELECT * FROM stripe_events"), printsD1(`SELECT * FROM photo_download_grants WHERE order_id = '${orderId}'`)]);
  for (const value of [name, "Example Street", "Unit 3", "Bondi", "+61 400 000 000", "buyer@example.com"]) expect(stored).not.toContain(value);
});

test("a refusal naming one print refuses the order: it needs attention and nothing is placed for the other", async ({ page }) => {
  await asTestClient(page);
  const { orderId, sessionId } = await checkoutOrder(page, `Ada ${unique()}`);
  await setMode(orderId, { refuse: "fixture-b-02" });
  const { event } = await payAtStandIn(sessionId);
  expect(await deliverStripe(PRINTS, event)).toBe(200);
  await waitForStatus(orderId, "needs_attention");
  const [{ attention_reason }] = printsD1<{ attention_reason: string }>(`SELECT attention_reason FROM print_orders WHERE id = '${orderId}'`);
  expect(attention_reason).toBe(`artelo refused the order: item ${orderId}-2: the design for fixture-b-02 can't be printed`);
  expect(await arteloOrdersFor(orderId)).toEqual([]);
  await expect.poll(async () => (await mailFor(`print order ${orderId} needs attention`)).length).toBe(1);
});

test("a paid order whose webhook never arrives is found by the cron and placed; george is told", async ({ page }) => {
  await asTestClient(page);
  const { orderId, sessionId } = await checkoutOrder(page, `Ada ${unique()}`);
  await payAtStandIn(sessionId);
  // Older than the hour a session lasts, plus five minutes
  printsD1(`UPDATE print_orders SET created_at = unixepoch() - 4000 WHERE id = '${orderId}'`, undefined, { idempotent: true });
  await runCron();
  await waitForStatus(orderId, "placed");
  expect(await arteloOrdersFor(orderId)).toHaveLength(1);
  const [mail] = await mailFor(`print order ${orderId}: stripe's webhook never arrived`);
  expect(mail).toMatchObject({ to: "hello@curiousgeorge.dev", text: `print order ${orderId} was paid but stripe's webhook never arrived. check the webhook in stripe.`, replyTo: "hello@curiousgeorge.dev", from: { email: "prints@curiousgeorge.dev", name: "george vlachos" } });
});

test("an amount that differs from the quote is paid but needs attention, and is never placed", async ({ page }) => {
  await asTestClient(page);
  const { orderId, sessionId } = await checkoutOrder(page, `Ada ${unique()}`);
  const { event } = await payAtStandIn(sessionId, { conversion: true });
  expect(await deliverStripe(PRINTS, event)).toBe(200);
  await waitForStatus(orderId, "needs_attention");
  expect(printsD1(`SELECT attention_reason FROM print_orders WHERE id = '${orderId}'`)).toEqual([{ attention_reason: "the amount paid differs from the quote" }]);
  expect(await arteloOrdersFor(orderId)).toEqual([]);
});

test("a full refund of a placed order needs attention to cancel it at artelo; a refund of a charge that isn't a print order's changes nothing", async ({ page }) => {
  await asTestClient(page);
  const { orderId, sessionId } = await checkoutOrder(page, `Ada ${unique()}`);
  const { event: paid } = await payAtStandIn(sessionId);
  expect(await deliverStripe(PRINTS, paid)).toBe(200);
  await waitForStatus(orderId, "placed");
  // The charge names its order: Stripe copied the payment intent's metadata to it
  const { event: partly } = await refundAtStandIn(sessionId, 4900);
  expect(partly.data.object.metadata).toEqual({ order_id: orderId });
  expect(await deliverStripe(PRINTS, partly)).toBe(200);
  expect(printsD1(`SELECT status, refunded_amount FROM print_orders WHERE id = '${orderId}'`)).toEqual([{ status: "placed", refunded_amount: 4900 }]);
  const { event: fully } = await refundAtStandIn(sessionId);
  expect(await deliverStripe(PRINTS, fully)).toBe(200);
  await waitForStatus(orderId, "needs_attention");
  expect(printsD1(`SELECT attention_reason, refunded_amount FROM print_orders WHERE id = '${orderId}'`)).toEqual([{ attention_reason: "refunded in stripe: cancel it in artelo if it hasn't printed.", refunded_amount: 28700 }]);
  await expect.poll(async () => (await mailFor(`print order ${orderId} needs attention`)).length).toBe(1);
  // Another integration's sale on the same account: answered, recorded and ignored, never retried
  const foreign = { id: `evt_test_shop_${unique()}`, object: "event", type: "charge.refunded", livemode: false, data: { object: { id: "ch_test_shop", object: "charge", payment_intent: "pi_test_shop", amount: 1000, amount_refunded: 1000, refunded: true, metadata: {} } } };
  expect(await deliverStripe(PRINTS, foreign)).toBe(200);
  expect(printsD1(`SELECT COUNT(*) AS n FROM stripe_events WHERE id = '${foreign.id}'`)).toEqual([{ n: 1 }]);
});

test("an unsigned or wrongly signed event is refused before anything is read", async () => {
  expect((await fetch(`${PRINTS}/api/prints/stripe`, { method: "POST", body: "{}" })).status).toBe(400);
  expect(await deliverStripe(PRINTS, { id: "evt_forged", type: "checkout.session.completed", data: { object: {} } }, "whsec_wrong")).toBe(400);
});

test("artelo's signed shipped status stores the tracking, revokes the master links and emails the buyer once", async ({ page }) => {
  await asTestClient(page);
  const orderId = await placedOrder(page, `Ada ${unique()}`);
  expect(printsD1(`SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = '${orderId}' AND revoked_at IS NULL`)).toEqual([{ n: 2 }]);
  expect(await ship(PRINTS, orderId, "Shipped", true)).toBe(200);
  await waitForStatus(orderId, "shipped");
  expect(printsD1<{ shipments: string }>(`SELECT shipments FROM print_orders WHERE id = '${orderId}'`)[0].shipments).toBe(JSON.stringify([{ carrier: "ups", number: "1Z999AA10123456784", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" }]));
  expect(printsD1(`SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = '${orderId}' AND revoked_at IS NULL`)).toEqual([{ n: 0 }]);
  // A replay of the same body changes nothing
  expect(await ship(PRINTS, orderId, "Shipped")).toBe(200);
  await expect.poll(async () => (await mailFor(orderId)).filter((mail) => mail.subject === "your prints are on their way").length).toBe(1);
  const [mail] = (await mailFor(orderId)).filter((entry) => entry.subject === "your prints are on their way");
  expect(mail.to).toBe("buyer@example.com");
  expect(mail.text).toContain("tracking: ups 1Z999AA10123456784 https://www.ups.com/track?tracknum=1Z999AA10123456784");
});

test("a status artelo's webhook never delivered is caught by the twelve-hourly poll", async ({ page }) => {
  await asTestClient(page);
  const orderId = await placedOrder(page, `Ada ${unique()}`);
  await fetch(`${STAND_IN}/__status`, { method: "POST", body: JSON.stringify({ order: orderId, status: "InProduction" }) });
  printsD1(`UPDATE print_orders SET placed_at = placed_at - 50000 WHERE id = '${orderId}'`);
  await runCron();
  await waitForStatus(orderId, "in_production");
});

test("the order page shows a buyer their order with private headers, and anyone else the notebook 404", async ({ page }) => {
  await asTestClient(page);
  const name = `Ada ${unique()}`;
  const { orderId, sessionId } = await checkoutOrder(page, name);
  const url = await orderPageFor(name);
  expect(url).toMatch(new RegExp(`^${PRINTS}/prints/${orderId}\\?key=[A-Za-z0-9_-]{43}$`));
  // Before the payment lands: the waiting line, and the page refreshes itself
  let response = await page.goto(url);
  expect(response?.status()).toBe(200);
  expect(response?.headers()).toMatchObject({ "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" });
  await expect(page.locator(".order-status")).toHaveText("your payment's on its way through. this page updates when it lands.");
  await expect(page.locator('meta[http-equiv="refresh"]')).toHaveAttribute("content", "10");
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.locator("script")).toHaveCount(0);
  const { event } = await payAtStandIn(sessionId);
  await deliverStripe(PRINTS, event);
  await waitForStatus(orderId, "placed");
  await page.goto(url);
  await expect(page.locator("h1")).toHaveText("your prints");
  await expect(page.locator(".order-facts p")).toHaveText(["to australia", "prints $238 + delivery $49 = $287", "prices include no gst; the seller isn't registered for gst.", /^paid \d\d\.\d\d\.\d\d$/]);
  await expect(page.locator(".order-status")).toHaveText("they're with the printer.");
  await expect(page.locator('meta[http-equiv="refresh"]')).toHaveCount(0);
  await ship(PRINTS, orderId);
  await waitForStatus(orderId, "shipped");
  await page.goto(url);
  await expect(page.locator(".order-status")).toHaveText("they're on their way:");
  await expect(page.getByRole("link", { name: "1Z999AA10123456784" })).toHaveAttribute("href", "https://www.ups.com/track?tracknum=1Z999AA10123456784");
  for (const wrong of [url.replace(/key=.+$/, "key=wrong"), url.replace(/key=.+$/, ""), url.replace(orderId, "01k6x0000000000000000000zz")]) {
    response = await page.goto(wrong);
    expect(response?.status()).toBe(404);
    expect(response?.headers()["cache-control"]).toBe("private, no-store");
    await expect(page.locator("#not-found")).toBeVisible();
  }
});

test("every way of being refused is the same notebook 404, so the page never says whether an order exists", async ({ page }) => {
  await asTestClient(page);
  const name = `Ada ${unique()}`;
  const { orderId } = await checkoutOrder(page, name);
  const url = await orderPageFor(name);
  const key = new URL(url).searchParams.get("key")!;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const unknownId = "01k6x0000000000000000000zz";
  const unknownKey = createHmac("sha256", FIXTURE_SECRETS.PRINT_VIEW_SECRET).update(`order-view:${unknownId}`).digest("base64url");
  // The right key is accepted, so the fixture secret above is the server's, and the unknown id's own key reaches no order
  expect((await page.request.get(url)).status()).toBe(200);
  const refused: [string, string][] = [
    ["a wrong key", `${PRINTS}/prints/${orderId}?key=${"w".repeat(43)}`],
    ["a wrong key of the wrong length", `${PRINTS}/prints/${orderId}?key=wrong`],
    ["no key", `${PRINTS}/prints/${orderId}`],
    ["an empty key", `${PRINTS}/prints/${orderId}?key=`],
    ["the key's other spelling", `${PRINTS}/prints/${orderId}?key=${key.slice(0, -1)}${alphabet[alphabet.indexOf(key.at(-1)!) ^ 1]}`],
    ["the key with its padding", `${PRINTS}/prints/${orderId}?key=${key}=`],
    ["an unknown order id with a wrong key", `${PRINTS}/prints/${unknownId}?key=${"w".repeat(43)}`],
    ["an unknown order id with this order's key", `${PRINTS}/prints/${unknownId}?key=${key}`],
    ["an unknown order id with its own valid key", `${PRINTS}/prints/${unknownId}?key=${unknownKey}`],
    ["a malformed order id", `${PRINTS}/prints/not-an-order?key=${key}`],
    ["an upper-case order id", `${PRINTS}/prints/${orderId.toUpperCase()}?key=${key}`],
  ];
  // Only what is inherently per request differs: the date, and the page's own path in its share address
  const answer = async (target: string) => {
    const response = await page.request.get(target, { maxRedirects: 0 });
    const headers = { ...response.headers() };
    delete headers["date"];
    const path = new URL(target).pathname;
    return { status: response.status(), headers, body: (await response.text()).split(path).join("/prints/ID") };
  };
  const [first, ...rest] = await Promise.all(refused.map(([, target]) => answer(target)));
  expect(first.status).toBe(404);
  expect(first.headers).toMatchObject({ "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" });
  expect(first.body).toContain('id="not-found"');
  for (const [index, other] of rest.entries()) expect(other, refused[index + 1][0]).toEqual(first);
  // Nothing of the order, the key or the id in the answer
  for (const secret of [key, orderId, name]) expect(JSON.stringify(first)).not.toContain(secret);
});
