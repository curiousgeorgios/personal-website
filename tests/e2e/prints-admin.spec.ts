import { expect, test } from "@playwright/test";
import { arteloOrdersFor, asTestClient, checkoutOrder, deliverStripe, mailFor, payAtStandIn, postPayForm, quoteDelivery, sessionsFor, setMode, TWO_PRINTS, unique, usAddress, waitForStatus } from "./prints";
import { PRINTS } from "./prints-site";

// The orders section on the prints server's admin (the test build's local bypass, R7)
test.use({ baseURL: PRINTS });
test.skip(({ browserName }) => browserName !== "chromium", "the print specs run in chromium");

test("the section opens with the state of prints and the rate", async ({ page }) => {
  await page.goto("/admin/#orders");
  await expect(page.locator("#orders .orders-status li").nth(0)).toHaveText("prints are open");
  // Dated the day the store was seeded, or the day the cron's first refresh fetched the stand-in's 1.50
  await expect(page.locator("#orders .orders-status li").nth(1)).toHaveText(/^us\$1 = a\$1\.50 · ecb rate of \d\d\.\d\d\.\d\d$/);
});

test("the buffer saves a whole percent and refuses anything else", async ({ page }) => {
  await page.goto("/admin/#orders");
  // Saving the value it already has: other specs quote on this server at the same time
  await page.locator("#buffer-buffer").fill("8");
  await page.locator("#buffer").getByRole("button", { name: "save" }).click();
  await expect(page).toHaveURL(/\/admin\/\?saved=orders#orders$/);
  await expect(page.locator("#orders .notice")).toHaveText("saved - it applies to the next quote.");
  await page.locator("#buffer-buffer").fill("25");
  const [response] = await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator("#buffer").getByRole("button", { name: "save" }).click()]);
  expect(response.status()).toBe(422);
  await expect(page.locator("#buffer-buffer-error")).toHaveText("a whole number from 0 to 20");
});

test("an order artelo won't take shows first with its reason and george is emailed; retry now places it once", async ({ page }) => {
  await asTestClient(page);
  const { orderId, sessionId } = await checkoutOrder(page, `Ada ${unique()}`);
  await setMode(orderId, "down");
  const { event } = await payAtStandIn(sessionId);
  expect(await deliverStripe(PRINTS, event)).toBe(200);
  // PRINT_RETRY_WINDOW=0 on this server: the first retryable failure is the last (spec 19)
  await waitForStatus(orderId, "needs_attention");
  await expect.poll(async () => (await mailFor(`print order ${orderId} needs attention`)).length).toBe(1);
  await page.goto("/admin/#orders");
  const entry = page.locator(`#order-${orderId}`);
  await expect(entry).toHaveClass(/attention/);
  await expect(entry.locator(".reason")).toHaveText("artelo didn't take the order within a day: artelo answered 503");
  await expect(entry.locator(".order-sums")).toHaveText("to au · $238 + delivery $49 = $287 · needs attention · test");
  // Every needs-attention entry comes before every other
  const classes = await page.locator("#orders .orders-admin > li").evaluateAll((items) => items.map((item) => item.classList.contains("attention")));
  expect(classes.indexOf(false) === -1 || classes.slice(classes.indexOf(false)).every((attention) => !attention)).toBe(true);
  await setMode(orderId, "ok");
  await entry.getByRole("button", { name: "retry now" }).click();
  await expect(page).toHaveURL(/\/admin\/\?saved=orders&note=retry#orders$/);
  await expect(page.locator("#orders .notice")).toHaveText("retrying - refresh in a minute to see how it went.");
  await waitForStatus(orderId, "placed");
  expect(await arteloOrdersFor(orderId)).toHaveLength(1);
});

test("the new intents need the site's own origin, like every admin write", async ({ request }) => {
  const forms: Record<string, string>[] = [{ intent: "prints.buffer", buffer: "8" }, { intent: "order.retry", id: "01k6x00000000000000000000a" }];
  for (const form of forms) {
    const response = await request.post("/admin/", { form, headers: { Origin: "https://example.com" }, maxRedirects: 0 });
    expect(response.status()).toBe(403);
  }
});

test("an order whose quote carried destination tax says so, as the buyer saw it (spec 16.1)", async ({ page }) => {
  await asTestClient(page);
  // A us address: the stand-in quotes us$4.20 sales tax, so the delivery line carries destination taxes
  const name = `Grace ${unique()}`;
  await page.goto(`/basket?items=${TWO_PRINTS}`);
  await quoteDelivery(page, usAddress(name));
  const response = await postPayForm(page, PRINTS);
  expect(response.status()).toBe(303);
  const sessionId = response.headers()["location"].split("/").at(-1)!;
  const orderId = (await sessionsFor(name)).find((entry) => entry.session.id === sessionId)!.session.client_reference_id;
  const { event } = await payAtStandIn(sessionId);
  expect(await deliverStripe(PRINTS, event)).toBe(200);
  await waitForStatus(orderId, "placed");
  await page.goto("/admin/#orders");
  await expect(page.locator(`#order-${orderId} .order-sums`)).toContainText("to us · $238 + delivery and destination taxes $56 = $294 · with artelo · test");
});
