import { expect, test } from "@playwright/test";
import { asTestClient, auAddress, postPayForm, printsD1, quoteDelivery, sessionsFor, TWO_PRINTS, unique } from "./prints";
import { PRINTS, STAND_IN } from "./prints-site";

// Checkout (spec 17.2) on the prints server (4337), Stripe stood in. The print specs run in Chromium (spec 23.2)
test.use({ baseURL: PRINTS });
test.skip(({ browserName }) => browserName !== "chromium", "the print specs run in chromium");

test("continue to payment writes the order first, then answers 303 to a session holding the quoted address", async ({ page }) => {
  await asTestClient(page);
  const name = `Ada ${unique()}`;
  await page.goto(`/basket?items=${TWO_PRINTS}`);
  await quoteDelivery(page, auAddress(name));
  const response = await postPayForm(page);
  expect(response.status()).toBe(303);
  const location = response.headers()["location"];
  expect(location).toMatch(new RegExp(`^${STAND_IN}/stripe/pay/cs_test_standin_\\d+$`));
  const [{ session, form }] = await sessionsFor(name);
  expect(location.endsWith(session.id)).toBe(true);
  expect(form).toMatchObject({
    "adaptive_pricing[enabled]": "false", "payment_method_types[0]": "card", "line_items[0][price_data][currency]": "aud",
    "line_items[0][price_data][unit_amount]": "17900", "line_items[1][price_data][unit_amount]": "5900", "line_items[2][price_data][unit_amount]": "4900",
    "line_items[2][price_data][product_data][name]": "delivery to australia, 2 prints",
    "payment_intent_data[shipping][name]": name, "payment_intent_data[shipping][address][line1]": "12 Example Street", "payment_intent_data[shipping][address][country]": "AU",
    client_reference_id: session.client_reference_id,
  });
  expect(session.amount_total).toBe(28700);
  expect(form["custom_text[submit][message]"]).toBe(`posting to: ${name}, 12 Example Street, Unit 3, Bondi Beach NSW 2026, australia. to change it, go back and quote again. prints are made and posted by artelo in the us. prices include no gst; the seller isn't registered for gst.`);
  expect(form).not.toHaveProperty(["line_items[0][price_data][product_data][images][0]"]);
  expect(form).not.toHaveProperty(["shipping_address_collection[allowed_countries][0]"]);
  expect(form).not.toHaveProperty(["phone_number_collection[enabled]"]);
  for (const [field, value] of Object.entries(form)) {
    if (field.startsWith("payment_intent_data[shipping]") || field === "custom_text[submit][message]") continue;
    expect(value, field).not.toContain("Example Street");
    expect(value, field).not.toContain(name);
  }
  // The order page's key is in the success url and nowhere in the store
  const key = new URL(form.success_url).searchParams.get("key");
  expect(form.success_url).toBe(`${PRINTS}/prints/${session.client_reference_id}?key=${key}`);
  expect(key).toMatch(/^[\w-]{43}$/);
  const [order] = printsD1<Record<string, unknown>>(`SELECT * FROM print_orders WHERE id = '${session.client_reference_id}'`);
  expect(order).toMatchObject({ status: "checkout", country: "AU", print_total: 23800, delivery_amount: 4900, delivery_taxed: 0, stripe_session_id: session.id, livemode: 0 });
  expect(JSON.stringify(order)).not.toMatch(/Example Street|Bondi|Ada/);
  expect(JSON.stringify(order)).not.toContain(key);
  expect(printsD1(`SELECT line, photo_id, size, unit_amount FROM print_order_items WHERE order_id = '${session.client_reference_id}' ORDER BY line`)).toEqual([
    { line: 1, photo_id: "fixture-b-01", size: "x12x18", unit_amount: 17900 }, { line: 2, photo_id: "fixture-b-02", size: "x8x12", unit_amount: 5900 },
  ]);
});

test("the page's policy lets a form's redirect reach stripe's checkout and nowhere else", async ({ page }) => {
  const response = await page.goto(`/basket?items=${TWO_PRINTS}`);
  expect(response?.headers()["content-security-policy"]).toContain("form-action 'self' https://checkout.stripe.com;");
});

test.describe("without javascript", () => {
  test.use({ javaScriptEnabled: false });

  test("an address edited after the quote is refused at checkout, and nothing reaches stripe", async ({ page }) => {
    await asTestClient(page);
    const name = `Ada ${unique()}`;
    await page.goto(`/basket?items=${TWO_PRINTS}`);
    await quoteDelivery(page, auAddress(name));
    // The buyer edits the street they can see after quoting, then pays: the browser posts the edited field with the seal
    await page.locator('#deliver [name="line1"]').fill("13 Example Street");
    const [response] = await Promise.all([page.waitForResponse((answer) => answer.request().method() === "POST"), page.getByRole("button", { name: "continue to payment" }).click()]);
    expect(response.status()).toBe(422);
    await expect(page.locator("#deliver .basket-error[role=alert]")).toHaveText("that quote has changed or run out. quote delivery again.");
    await expect(page.locator('#deliver [name="line1"]')).toHaveValue("13 Example Street");
    await expect(page.locator("#pay")).toHaveCount(0);
    expect(await sessionsFor(name)).toEqual([]);
    // Quoting the edited address again gives a fresh quote
    await quoteDelivery(page, { ...auAddress(name), line1: "13 Example Street" });
    await expect(page.locator(".quote-line")).toHaveText("prints $238 + delivery $49 = $287");
  });
});
