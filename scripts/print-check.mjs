// bun run prints:check --local | --remote [--persist-to DIR] (spec 17.5): every size and frame against Artelo's costs and
// Price Check at five landmark addresses, two prints together to each, Antarctica's answer and the order lookup the
// duplicate guard depends on. George runs it before opening prints and whenever Artelo's prices or the rate move a lot;
// it is not part of CI (it needs the live key). The key comes from ARTELO_API_KEY and is never printed.
// Exit 1: a refused combination, a margin under 15% or a failed lookup. Warnings (exit 0): a margin under 30%, or a quote
// that differs from the catalogue's costs by more than 5%.
import { artelo, arteloAddress, ordersList, priceCheckBody, productInfo, readArteloOrder } from "../src/lib/prints/artelo.ts";
import { ANTARCTICA, COMBINATIONS, drifted, LANDMARKS, marginFor, verdict } from "../src/lib/prints/margin.ts";
import { aud, rateText, usd } from "../src/lib/prints/money.ts";
import { readOrderCosts } from "../src/lib/prints/quote.ts";
import { photoPlatform } from "./photo-platform.mjs";

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
if (args.includes("--local") === args.includes("--remote")) {
  console.error("usage: bun run prints:check --local | --remote [--persist-to DIR]");
  process.exit(2);
}
const key = process.env.ARTELO_API_KEY;
if (!key) {
  console.error("set ARTELO_API_KEY in the environment; it is never printed");
  process.exit(2);
}
const pace = Number(process.env.PRINTS_CHECK_PACE_MS ?? 250);
const deps = { config: { arteloBase: (process.env.ARTELO_API_BASE ?? "https://www.artelo.com/api/open").replace(/\/+$/, ""), secrets: { ARTELO_API_KEY: key } }, fetch: (input, init) => fetch(input, init) };
// 250ms apart keeps the run under Artelo's 50 requests in 10 seconds
const call = async (method, path, body) => {
  await new Promise((resolve) => setTimeout(resolve, pace));
  return artelo(deps, method, path, body);
};

let failures = 0;
let warnings = 0;
const fail = (text) => {
  failures += 1;
  console.log(`FAIL ${text}`);
};
const warn = (text) => {
  warnings += 1;
  console.log(process.env.CI ? `::warning::${text}` : `warn ${text}`);
};
const refused = (result) => `${result.status ?? "no answer"}${result.message ? `: ${result.message}` : ""}`;
const pct = (share) => `${Math.round(share * 100)}%`;
// A margin can be a loss, which aud() rightly refuses
const signed = (cents) => (cents < 0 ? `-${aud(-cents)}` : aud(cents));

// The prices, the buffer and the rate from the chosen D1. Reads only: with --local this can be a running test server's
// store (the scripts spec opens 4337's), so nothing here may ever write
const platform = await photoPlatform({ remote: args.includes("--remote"), persistTo: arg("--persist-to") ?? ".wrangler/state" });
let prices;
let settings;
try {
  prices = Object.fromEntries((await platform.env.DB.prepare("SELECT tier, frame, amount FROM print_prices").all()).results.map((row) => [`${row.tier}:${row.frame}`, row.amount]));
  settings = Object.fromEntries((await platform.env.DB.prepare("SELECT key, value FROM print_settings").all()).results.map((row) => [row.key, row.value]));
} finally {
  await platform.dispose();
}
const buffer = Number(settings.delivery_buffer ?? 0.08);
let rate = Number(settings.usd_aud);
if (!(rate >= 0.8 && rate <= 3)) {
  const answer = await fetch(process.env.FX_URL ?? "https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD").then((response) => response.json()).catch(() => null);
  rate = Number(answer?.rates?.AUD);
}
if (!(rate >= 0.8 && rate <= 3) || !(buffer >= 0 && buffer <= 0.2)) {
  console.error("no usable exchange rate or buffer: the store holds none and the rate couldn't be fetched");
  process.exit(2);
}
const missing = COMBINATIONS.filter((combination) => !Number.isSafeInteger(prices[`${combination.tier}:${combination.frame}`]));
if (missing.length > 0) {
  console.error(`the store has no price for ${[...new Set(missing.map((combination) => `${combination.tier} ${combination.frame}`))].join(", ")}: apply the migrations first`);
  process.exit(2);
}
console.log(`rate ${rateText(rate)} per us$1, buffer ${pct(buffer)}`);

const singles = new Map();
for (const combination of COMBINATIONS) {
  const name = `${combination.family} ${combination.tier} ${combination.size.size} ${combination.frame}`;
  const price = prices[`${combination.tier}:${combination.frame}`];
  const catalogue = {};
  for (const country of ["AU", "US"]) {
    // Get Catalog Product Costs' required fields: shippingDestination, the three booleans and a listed frameStyle
    const result = await call("POST", "/catalog/get-costs", { catalogProductId: "IndividualArtPrint", size: combination.size.size, frameStyle: combination.frame === "oak" ? "Oak" : "Unframed", includeMats: false, includeFramingService: false, includeHangingPins: false, paperType: "ArchivalMatteFineArt", shippingDestination: country, quantity: 1 });
    if (!result.ok) {
      fail(`${name}: artelo refused its catalogue costs to ${country} (${refused(result)})`);
      continue;
    }
    const { productionCost, shippingCost } = result.body ?? {};
    if (typeof productionCost !== "number" || typeof shippingCost !== "number") {
      fail(`${name}: artelo's catalogue costs to ${country} couldn't be read: ${JSON.stringify(result.body)}`);
      continue;
    }
    catalogue[country] = Math.round((productionCost + shippingCost) * 100);
  }
  for (const landmark of LANDMARKS) {
    const line = { line: 1, quantity: 1, unitAmount: price, size: combination.size, frame: combination.frame, orientation: "Vertical" };
    const result = await call("POST", "/orders/price-check", priceCheckBody([line], landmark.address, rate, `check-quote-${Date.now()}`));
    if (!result.ok) {
      fail(`${name} to ${landmark.label}: artelo refused the price check (${refused(result)})`);
      continue;
    }
    console.log(`  ${name} to ${landmark.label}: ${JSON.stringify(result.body?.orderCosts)}`);
    const quoted = readOrderCosts(result.body?.orderCosts);
    if (!quoted || quoted.productionCents === null) {
      fail(`${name} to ${landmark.label}: the price check couldn't be read`);
      continue;
    }
    singles.set(`${name}|${landmark.label}`, quoted.freightCents);
    const margin = marginFor({ priceCents: price, productionUsdCents: quoted.productionCents, freightUsdCents: quoted.freightCents, rate, buffer });
    console.log(`${name} to ${landmark.label}: production ${usd(quoted.productionCents)} (${aud(margin.productionAud)}), price ${aud(price)}, card fee ${aud(margin.cardFee)}, freight shortfall ${aud(margin.shortfall)}, margin ${signed(margin.margin)} (${pct(margin.share)}), delivery ${aud(margin.deliveryAud)}`);
    const judged = verdict(margin.share);
    if (judged === "fail") fail(`${name} to ${landmark.label}: the margin is ${pct(margin.share)}, under 15%`);
    if (judged === "warn") warn(`${name} to ${landmark.label}: the margin is ${pct(margin.share)}, under the 30% floor`);
    const total = quoted.productionCents + quoted.freightCents + quoted.taxes.reduce((sum, tax) => sum + tax.cents, 0);
    const expected = catalogue[landmark.address.country];
    if (expected && drifted(total, expected)) warn(`${name} to ${landmark.label}: price check's total ${usd(total)} differs from the catalogue's ${usd(expected)} by more than 5%`);
  }
}

// Two prints together, beside each alone, so George sees how Artelo prices combined delivery
const small = COMBINATIONS.find((combination) => combination.family === "2:3" && combination.tier === "small" && combination.frame === "unframed");
const large = COMBINATIONS.find((combination) => combination.family === "2:3" && combination.tier === "large" && combination.frame === "oak");
for (const landmark of LANDMARKS) {
  const lines = [small, large].map((combination, index) => ({ line: index + 1, quantity: 1, unitAmount: prices[`${combination.tier}:${combination.frame}`], size: combination.size, frame: combination.frame, orientation: "Vertical" }));
  const result = await call("POST", "/orders/price-check", priceCheckBody(lines, landmark.address, rate, `check-quote-${Date.now()}`));
  const quoted = result.ok ? readOrderCosts(result.body?.orderCosts) : null;
  if (!quoted) {
    fail(`two prints to ${landmark.label}: artelo refused or the answer couldn't be read (${result.ok ? "unreadable" : refused(result)})`);
    continue;
  }
  const alone = [small, large].map((combination) => singles.get(`${combination.family} ${combination.tier} ${combination.size.size} ${combination.frame}|${landmark.label}`));
  console.log(`two prints to ${landmark.label}: freight ${usd(quoted.freightCents)} together; alone ${alone.map((cents) => (cents === undefined ? "?" : usd(cents))).join(" and ")}`);
}

// Antarctica: Artelo's real refusal, to check the basket's handling of it against
const antarctic = await call("POST", "/orders/price-check", priceCheckBody([{ line: 1, quantity: 1, unitAmount: prices["small:unframed"], size: small.size, frame: "unframed", orientation: "Vertical" }], ANTARCTICA, rate, `check-quote-${Date.now()}`));
console.log(antarctic.ok ? `antarctica: artelo quoted ${JSON.stringify(antarctic.body?.orderCosts)}` : `antarctica: artelo answered ${antarctic.status ?? "nothing"} ${antarctic.message}`);

// The lookup check (spec 25 assumption 8): a test order, then Get Orders by its name, because placing depends on finding
// an order before creating it. It passes only as placement's lookup would: an entry with an id of Artelo's and ours under
// orderId. An order the name filter misses, or one listed without our id, means placing could create an order twice
const checkId = `check-${Date.now()}`;
const created = await call("POST", "/orders/create", {
  orderId: checkId, createdAt: new Date().toISOString(), currency: "AUD", total: prices["small:unframed"] / 100, shippingCost: 0, channelName: "curiousgeorge.dev",
  companyName: "george vlachos", isTestOrder: true, customerAddress: arteloAddress(LANDMARKS[0].address),
  // Only this test order skips the DPI check: its image is the 1200 × 630 share card, about 100 ppi at 8 × 12 in. Real
  // orders never send it (Task 9's test pins that)
  dangerouslySkipDPICheck: true,
  items: [{ orderItemId: `${checkId}-1`, quantity: 1, unitPrice: prices["small:unframed"] / 100, productInfo: productInfo({ size: small.size, frame: "unframed", orientation: "Vertical" }, "https://curiousgeorge.dev/og.png") }],
});
if (!created.ok) fail(`lookup check: artelo refused the test order (${refused(created)}), so the lookup wasn't proved: don't open prints`);
else {
  const lookup = await call("GET", `/orders/get?limit=5&name=${encodeURIComponent(checkId)}`);
  const list = lookup.ok ? ordersList(lookup.body) : null;
  const answer = lookup.ok ? JSON.stringify(lookup.body).slice(0, 300) : refused(lookup);
  if (!list) fail(`lookup check: get orders' answer for ${checkId} couldn't be read (${answer}), so every order would stall at its lookup: don't open prints`);
  else if (list.length === 0) fail(`lookup check: get orders' name filter didn't find ${checkId} just after it was created, so placing could create an order twice: don't open prints`);
  else if (!list.some((entry) => readArteloOrder(entry)?.orderId === checkId)) fail(`lookup check: get orders listed ${checkId} without its id under orderId (${answer}), so placing can't match it: don't open prints`);
  else console.log("lookup check: ok");
}

console.log(`${failures} failed, ${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
process.exit(failures > 0 ? 1 : 0);
