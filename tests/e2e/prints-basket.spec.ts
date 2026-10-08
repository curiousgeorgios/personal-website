import { expect, test } from "@playwright/test";
import { GALLERY } from "./gallery-site";
import { PRINTS } from "./prints-site";
import { asTestClient, auAddress, priceChecksFor, quoteDelivery, TWO_PRINTS, unique, usAddress } from "./prints";

// The prints server (4337): prints open, every provider stood in. The print specs run in Chromium (spec 23.2)
test.use({ baseURL: PRINTS });
test.skip(({ browserName }) => browserName !== "chromium", "the print specs run in chromium");

const labels = (page: import("@playwright/test").Page) => page.locator(".row > .label");

test("a photograph's page offers the sizes it prints at, priced, with how delivery works; none while prints are closed", async ({ page }) => {
  const response = await page.goto("/photos/fixture-b-01");
  expect(response?.headers()["cache-control"]).toBe("no-cache");
  await expect(labels(page)).toHaveText(["photo", "prints", "say hi"]);
  const form = page.locator("form#prints");
  await expect(form).toHaveAttribute("action", "/basket");
  await expect(form.locator(".size-choice")).toHaveText([
    "small · 8 × 12 in (20 × 30 cm) · $59, or $139 framed",
    "medium · 12 × 18 in (30 × 46 cm) · $79, or $179 framed",
    "large · 16 × 24 in (41 × 61 cm) · $119, or $259 framed",
  ]);
  await expect(form.locator(".frame-choice")).toHaveText(["unframed", "oak frame"]);
  await expect(form.locator(".prints-hint")).toHaveText("delivery is quoted for your address in the basket. prices include no gst; the seller isn't registered for gst.");
  // The same photo on the gallery server, where prints are closed: no row, and the plain intro
  await page.goto(`${GALLERY}/photos/fixture-b-01`);
  await expect(page.locator("form#prints")).toHaveCount(0);
  await page.goto(`${GALLERY}/photos`);
  await expect(page.locator(".intro")).toHaveText("photos i've taken, one entry per instagram post, newest first.");
});

test("a square photo prints small only, and one too small or the wrong shape gets no row", async ({ page }) => {
  await page.goto("/photos/fixture-01");
  await expect(page.locator("form#prints .size-choice")).toHaveText(["small · 10 × 10 in (25 × 25 cm) · $59, or $139 framed"]);
  await page.goto("/photos/fixture-c-01");
  await expect(labels(page)).toHaveText(["photo", "say hi"]);
});

test("while prints are open the gallery's intro and the home page's line say some come as prints", async ({ page }) => {
  await page.goto("/photos");
  await expect(page.locator(".intro")).toHaveText("photos i've taken, one entry per instagram post, newest first. some come as prints.");
  await page.goto("/");
  await expect(page.locator("#photos .body")).toHaveText("photos i've taken, kept like this log. some come as prints.");
});

test("a basket rides through the gallery's links, and those pages are never cached or indexed", async ({ page }) => {
  const response = await page.goto("/photos?items=fixture-b-01:medium:oak");
  expect(response?.headers()["cache-control"]).toBe("no-store");
  expect(response?.headers()["cache-tag"]).toBeUndefined();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await expect(page.getByRole("link", { name: "basket · 1 print" })).toHaveAttribute("href", "/basket?items=fixture-b-01:medium:oak");
  await expect(page.locator("a.frame-link").first()).toHaveAttribute("href", "/photos/fixture-01?items=fixture-b-01:medium:oak");
  await page.locator('a.frame-link[href^="/photos/fixture-b-01"]').click();
  await expect(page).toHaveURL(/\/photos\/fixture-b-01\?items=fixture-b-01:medium:oak$/);
  await expect(page.locator('form#prints input[name="items"]')).toHaveValue("fixture-b-01:medium:oak");
  await expect(page.locator('a[rel="next"]')).toHaveAttribute("href", "/photos/fixture-b-02?items=fixture-b-01:medium:oak");
});

test("a basket of nothing valid carries nothing, and the page is still never cached", async ({ page }) => {
  const response = await page.goto("/photos/fixture-b-01?items=nobody-01:small:oak");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  await expect(page.locator(".basket-link")).toHaveCount(0);
  await expect(page.locator('form#prints input[name="items"]')).toHaveCount(0);
});

test("later batches of a carried basket's gallery keep it on their frames", async ({ page }) => {
  await page.goto("/photos?items=fixture-b-01:medium:oak");
  await expect(page.locator("ol.entries > li.entry")).toHaveCount(2);
  // The End key, so the script sees a visitor's scroll even where the fixture's short page can't move
  await page.keyboard.press("End");
  await expect(page.locator("ol.entries > li.entry")).toHaveCount(6);
  const links = await page.locator("a.frame-link").evaluateAll((all) => all.map((link) => link.getAttribute("href")));
  expect(links.length).toBeGreaterThan(2);
  for (const href of links) expect(href).toMatch(/^\/photos\/[\w-]+\?items=fixture-b-01:medium:oak$/);
});

// The prints-closed server (4335): a closed site ignores ?items= altogether (spec 16.5), so these are the plain, cached,
// indexable pages, with nothing about prints on them and no basket read
test("with prints closed an items parameter changes nothing: the plain cached gallery and photo pages", async ({ page }) => {
  const items = "?items=fixture-b-01:medium:oak";
  const gallery = await page.goto(`${GALLERY}/photos${items}`);
  expect(gallery?.headers()["cache-control"]).toBe("no-cache");
  expect(gallery?.headers()["cache-tag"]).toContain("photos");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator('a[href^="/basket"]')).toHaveCount(0);
  await expect(page.locator(".where")).toHaveText("back to the logbook");
  await expect(page.locator("ol.entries")).not.toHaveAttribute("data-items", /.*/);
  expect(await page.locator('a[href*="items="]').count()).toBe(0);
  const photo = await page.goto(`${GALLERY}/photos/fixture-b-01${items}`);
  expect(photo?.headers()["cache-control"]).toBe("no-cache");
  expect(photo?.headers()["cache-tag"]).toContain("photos");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator(".basket-link")).toHaveCount(0);
  await expect(page.locator("form#prints")).toHaveCount(0);
  expect(await page.locator('a[href*="items="]').count()).toBe(0);
  // Junk is no different
  const junk = await page.goto(`${GALLERY}/photos/fixture-b-01?items=garbage`);
  expect(junk?.headers()["cache-control"]).toBe("no-cache");
});

test.describe("the basket without javascript", () => {
  test.use({ javaScriptEnabled: false });

  test("adding from a photo's page, one more and remove one each land on the canonical basket", async ({ page }) => {
    await page.goto("/photos/fixture-b-01");
    await page.getByLabel("medium · 12 × 18 in (30 × 46 cm) · $79, or $179 framed").check();
    await page.getByLabel("oak frame").check();
    await page.getByRole("button", { name: "add to basket" }).click();
    await expect(page).toHaveURL(/\/basket\?items=fixture-b-01:medium:oak$/);
    await expect(page.locator(".line-what")).toHaveText(["medium · 12 × 18 in · oak frame · $179"]);
    await page.getByRole("link", { name: "one more" }).click();
    await expect(page).toHaveURL(/\/basket\?items=fixture-b-01:medium:oak,fixture-b-01:medium:oak$/);
    await expect(page.locator(".line-what")).toHaveText(["medium · 12 × 18 in · oak frame × 2 · $358"]);
    await page.getByRole("link", { name: "keep looking" }).click();
    await expect(page).toHaveURL(/\/photos\?items=fixture-b-01:medium:oak,fixture-b-01:medium:oak$/);
    await page.goBack();
    await page.getByRole("link", { name: "remove one" }).click();
    await expect(page.locator(".basket-total")).toHaveText("prints $179");
  });

  test("a basket holds ten prints, and an entry edited by hand is dropped with a line", async ({ page }) => {
    const ten = Array.from({ length: 10 }, () => "fixture-b-01:small:oak").join(",");
    await page.goto(`/basket?items=${ten}`);
    await expect(page.getByRole("link", { name: "one more" })).toHaveCount(0);
    const response = await page.goto(`/basket?items=${ten}&add=fixture-b-02&size=small&frame=unframed`);
    expect(response?.status()).toBe(200);
    await expect(page.locator(".basket-note")).toHaveText(["a basket holds up to 10 prints."]);
    await page.goto("/basket?items=fixture-b-01:medium:oak,fixture-c-01:small:oak");
    await expect(page.locator(".basket-note")).toHaveText(["1 print was taken out: that photo isn't available as a print any more."]);
    await expect(page.locator(".basket-line")).toHaveCount(1);
  });

  test("the basket is never cached or indexed, counts a page view and is disallowed to crawlers", async ({ page, request }) => {
    const response = await page.goto(`/basket?items=${TWO_PRINTS}`);
    expect(response?.headers()["cache-control"]).toBe("no-store");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    await expect(page.locator("script")).toHaveCount(1);
    expect(await (await request.get("/robots.txt")).text()).toMatch(/Disallow: \/prints\/\nDisallow: \/basket/);
  });

  test("an invalid address reopens with its values and messages", async ({ page }) => {
    await asTestClient(page);
    await page.goto(`/basket?items=${TWO_PRINTS}`);
    await quoteDelivery(page, { ...auAddress(`Ada ${unique()}`), phone: "12" });
    await expect(page.locator("#deliver-phone-error")).toHaveText("that phone number looks too short.");
    await expect(page.locator('#deliver [name="line1"]')).toHaveValue("12 Example Street");
    await expect(page.locator("#total")).toHaveCount(0);
  });

  test("an australian address is quoted once for the whole basket, exactly, and the address is in no url", async ({ page }) => {
    await asTestClient(page);
    const urls: string[] = [];
    page.on("request", (request) => urls.push(request.url()));
    const name = `Ada ${unique()}`;
    await page.goto(`/basket?items=${TWO_PRINTS}`);
    await quoteDelivery(page, auAddress(name));
    await expect(page.locator(".quote-line")).toHaveText("prints $238 + delivery $49 = $287");
    await expect(page.locator("#total .prints-hint").first()).toHaveText("artelo's freight us$30.00 for this address, converted at a$1.50 per us$1, plus 8% in case the exchange rate moves, rounded up to the dollar.");
    await expect(page.locator("script")).toHaveCount(0);
    const checks = await priceChecksFor(name);
    expect(checks).toHaveLength(1);
    expect(checks[0].customerAddress).toMatchObject({ street1: "12 Example Street", street2: "Unit 3", city: "Bondi Beach", state: "NSW", zipcode: "2026", country: "AU", phone: "+61 400 000 000" });
    expect(checks[0].items.map((item) => [item.quantity, item.productInfo.size, item.productInfo.frameColor, item.productInfo.orientation])).toEqual([[1, "x12x18", "NaturalOak", "Vertical"], [1, "x8x12", null, "Horizontal"]]);
    expect(urls.filter((url) => /Example|Bondi|Ada|400(%20|\+| )000/.test(decodeURIComponent(url)))).toEqual([]);
  });

  test("a us address passes on the sales tax as destination taxes; antarctica is refused beside the form", async ({ page }) => {
    await asTestClient(page);
    await page.goto(`/basket?items=${TWO_PRINTS}`);
    await quoteDelivery(page, usAddress(`Grace ${unique()}`));
    await expect(page.locator(".quote-line")).toHaveText("prints $238 + delivery and destination taxes $56 = $294");
    await expect(page.locator("#total .prints-hint").first()).toContainText("artelo's freight us$30.00 and us sales tax us$4.20 for this address");
    await page.goto(`/basket?items=${TWO_PRINTS}`);
    await quoteDelivery(page, { ...auAddress(`Ada ${unique()}`), country: "AQ" });
    await expect(page.locator("#deliver .basket-error[role=alert]")).toHaveText("artelo couldn't quote delivery to this address: artelo doesn't deliver to antarctica");
    await expect(page.locator("#total")).toHaveCount(0);
  });
});

test("the eleventh quote in a minute from one client answers 429 without reaching artelo", async ({ request }) => {
  test.setTimeout(90_000);
  // Miniflare's local limiter aligns its windows to the wall clock's minutes, so start well inside one
  const into = Date.now() % 60_000;
  if (into > 40_000) await new Promise((resolve) => setTimeout(resolve, 60_500 - into));
  const name = `Ada ${unique()}`;
  const client = `spec-${unique()}`;
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) {
    const response = await request.post(`/basket?items=${TWO_PRINTS}`, { form: { intent: "quote", ...auAddress(name) }, headers: { Origin: PRINTS, "X-Test-Client": client } });
    statuses.push(response.status());
  }
  expect(statuses).toEqual([...Array(10).fill(200), 429]);
  expect(await priceChecksFor(name)).toHaveLength(10);
});

test("with prints closed every basket route is the notebook 404, and none of them reads or quotes anything", async ({ page, request }) => {
  const name = `Ada ${unique()}`;
  for (const query of [`?items=${TWO_PRINTS}`, "?add=fixture-b-01&size=medium&frame=oak", `?items=${TWO_PRINTS}&more=1`, ""]) {
    const response = await page.goto(`${GALLERY}/basket${query}`);
    expect(response?.status()).toBe(404);
    await expect(page.locator("#not-found")).toBeVisible();
  }
  const posted = await request.post(`${GALLERY}/basket?items=${TWO_PRINTS}`, { form: { intent: "quote", ...auAddress(name) }, headers: { Origin: GALLERY }, maxRedirects: 0 });
  expect(posted.status()).toBe(404);
  expect(await priceChecksFor(name)).toHaveLength(0);
});
