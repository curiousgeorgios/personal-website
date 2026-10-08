import { expect, test } from "@playwright/test";
import { arteloOrdersFor, auAddress, deliverStripe, mailFor, priceChecksFor, printsD1, quoteDelivery, ship, TWO_PRINTS, unique, waitForStatus } from "./prints";
import { PRINTS_STRIPE } from "./prints-site";

// The full test order (spec 23.2) on 4338, which talks to Stripe's real test mode. Artelo is still the stand-in. Stripe's
// webhooks can't reach a local server, so the spec fetches the real event from Stripe's API and delivers it itself
test.use({ baseURL: PRINTS_STRIPE });
test.skip(!process.env.STRIPE_TEST_SECRET_KEY, "needs STRIPE_TEST_SECRET_KEY, a key for stripe's test mode");
// A live key is never used here: the server blanks one (spec 21.4), and this spec's own calls to Stripe's API would use it
test.skip(!!process.env.STRIPE_TEST_SECRET_KEY && !/^(sk|rk)_test_/.test(process.env.STRIPE_TEST_SECRET_KEY), "STRIPE_TEST_SECRET_KEY isn't a test-mode key");
test.skip(({ browserName }) => browserName !== "chromium", "the print specs run in chromium");

const STORE = ".wrangler/stripe";
const stripeApi = async (path: string) =>
  (await (await fetch(`https://api.stripe.com${path}`, { headers: { Authorization: `Bearer ${process.env.STRIPE_TEST_SECRET_KEY}`, "Stripe-Version": "2025-09-30.clover" } })).json()) as Record<string, unknown>;

test("two prints, one exact total, paid on stripe's page in test mode, one artelo order from the masters, shipped", async ({ page }) => {
  test.setTimeout(240_000);
  const name = `Ada ${unique()}`;
  await page.goto("/photos/fixture-b-01");
  await page.getByLabel("medium · 12 × 18 in (30 × 46 cm) · $79, or $179 framed").check();
  await page.getByLabel("oak frame").check();
  await page.getByRole("button", { name: "add to basket" }).click();
  // keep looking carries the basket to the next photo, whose print row adds to it
  await page.getByRole("link", { name: "keep looking" }).click();
  await page.locator('a.frame-link[href^="/photos/fixture-b-02"]').click();
  await page.getByRole("button", { name: "add to basket" }).click();
  await expect(page).toHaveURL(new RegExp(`/basket\\?items=${TWO_PRINTS}$`));
  await quoteDelivery(page, auAddress(name));
  await expect(page.locator(".quote-line")).toHaveText("prints $238 + delivery $49 = $287");
  const [check] = await priceChecksFor(name);
  expect(check.items).toHaveLength(2);

  await page.getByRole("button", { name: "continue to payment" }).click();
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//, { timeout: 60_000 });
  // Stripe's page: the address read-only in the custom text, two print lines and one delivery line, no shipping form.
  // Stripe may render a line twice (a collapsed summary and the full list), so each needs only its first visible copy
  await expect(page.getByText(`posting to: ${name}, 12 Example Street, Unit 3, Bondi Beach NSW 2026, australia.`).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("delivery to australia, 2 prints").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/print of photo 1 of 2 from 14\.06\.26 · medium, 12 × 18 in · oak frame/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/print of photo 2 of 2 from 14\.06\.26 · small, 8 × 12 in · unframed/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator("#shippingName, #shippingAddressLine1")).toHaveCount(0);
  await page.locator("#email").fill("buyer@example.com");
  await page.locator("#cardNumber").fill("4242 4242 4242 4242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill(name);
  const country = page.locator("#billingCountry");
  if (await country.count()) await country.selectOption("AU");
  const postal = page.locator("#billingPostalCode");
  if (await postal.isVisible().catch(() => false)) await postal.fill("2026");
  // Events from a minute before paying on: the test account may be shared with other runs
  const started = Math.floor(Date.now() / 1000) - 60;
  // The pay button by its words (submit_type=pay), not any submit button: the page may hold another, for a wallet or a sign-in
  await page.locator("button[type=submit]").filter({ hasText: /^\s*pay\b/i, visible: true }).first().click();
  await page.waitForURL(new RegExp(`^${PRINTS_STRIPE}/prints/[0-9a-z]{26}\\?key=`), { timeout: 90_000 });
  const orderId = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(page.locator("h1")).toHaveText("your prints");

  // Stripe's own record: paid in aud with no conversion (adaptive pricing off), the quoted address on the payment
  const [{ stripe_session_id: sessionId }] = printsD1<{ stripe_session_id: string }>(`SELECT stripe_session_id FROM print_orders WHERE id = '${orderId}'`, STORE);
  let event: { id: string; data: { object: { id: string } } } | undefined;
  await expect.poll(async () => {
    event = ((await stripeApi(`/v1/events?type=checkout.session.completed&created%5Bgte%5D=${started}&limit=100`)).data as (typeof event)[]).find((entry) => entry?.data.object.id === sessionId);
    return !!event;
  }, { timeout: 60_000 }).toBe(true);
  const session = await stripeApi(`/v1/checkout/sessions/${sessionId}`);
  expect(session).toMatchObject({ currency: "aud", amount_total: 28700, payment_status: "paid", client_reference_id: orderId });
  expect(session.currency_conversion ?? null).toBeNull();
  const intent = await stripeApi(`/v1/payment_intents/${session.payment_intent}`);
  expect(intent.shipping).toMatchObject({ name, phone: "+61 400 000 000", address: { line1: "12 Example Street", line2: "Unit 3", city: "Bondi Beach", state: "NSW", postal_code: "2026", country: "AU" } });

  // The event, twice, signed with the local test webhook secret: one artelo order
  expect(await deliverStripe(PRINTS_STRIPE, event)).toBe(200);
  expect(await deliverStripe(PRINTS_STRIPE, event)).toBe(200);
  await waitForStatus(orderId, "placed", STORE);
  const orders = await arteloOrdersFor(orderId);
  expect(orders).toHaveLength(1);
  const [{ order, designs }] = orders;
  expect(order.isTestOrder).toBe(true);
  expect(order.customerAddress).toMatchObject({ name, street1: "12 Example Street", country: "AU" });
  expect(order.items.map((item) => [item.productInfo.size, item.productInfo.frameColor, item.productInfo.orientation, item.productInfo.paperType])).toEqual([
    ["x12x18", "NaturalOak", "Vertical", "ArchivalMatteFineArt"], ["x8x12", null, "Horizontal", "ArchivalMatteFineArt"],
  ]);
  const masters = Object.fromEntries(printsD1<{ id: string; print_sha256: string }>("SELECT id, print_sha256 FROM photos WHERE id IN ('fixture-b-01', 'fixture-b-02')", STORE).map((row) => [row.id, row.print_sha256]));
  expect(designs.map((design) => [design.width, design.height, design.sha256])).toEqual([[4000, 6000, masters["fixture-b-01"]], [6000, 4000, masters["fixture-b-02"]]]);

  // Artelo ships it: the tracking on the order page, the links revoked, one email to the buyer
  expect(await ship(PRINTS_STRIPE, orderId)).toBe(200);
  await waitForStatus(orderId, "shipped", STORE);
  await page.reload();
  await expect(page.locator(".order-status")).toHaveText("they're on their way:");
  await expect(page.getByRole("link", { name: "1Z999AA10123456784" })).toHaveAttribute("href", "https://www.ups.com/track?tracknum=1Z999AA10123456784");
  expect(printsD1(`SELECT COUNT(*) AS n FROM photo_download_grants WHERE order_id = '${orderId}' AND revoked_at IS NULL`, STORE)).toEqual([{ n: 0 }]);
  await expect.poll(async () => (await mailFor(orderId)).filter((mail) => mail.subject === "your prints are on their way" && mail.to === "buyer@example.com").length).toBe(1);
});
