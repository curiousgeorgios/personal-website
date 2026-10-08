import { expect, test } from "@playwright/test";
import { arteloOrdersFor, asTestClient, checkoutOrder, deliverStripe, mailFor, payAtStandIn, printsD1, runCron, setMode, unique, waitForStatus } from "./prints";
import { PRINTS } from "./prints-site";

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
  printsD1(`UPDATE print_orders SET created_at = unixepoch() - 4000 WHERE id = '${orderId}'`);
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

test("an unsigned or wrongly signed event is refused before anything is read", async () => {
  expect((await fetch(`${PRINTS}/api/prints/stripe`, { method: "POST", body: "{}" })).status).toBe(400);
  expect(await deliverStripe(PRINTS, { id: "evt_forged", type: "checkout.session.completed", data: { object: {} } }, "whsec_wrong")).toBe(400);
});
