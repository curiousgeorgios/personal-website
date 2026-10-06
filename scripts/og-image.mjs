// Renders the 1200 × 630 Open Graph image from the running site (bun run serve in another terminal).
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
// A fixed, unremarkable morning time so the image doesn't show whenever it happened to be rendered
await page.clock.setFixedTime(new Date("2026-10-02T23:00:00Z"));
await page.goto(process.env.OG_URL ?? "http://localhost:4331/");
await page.evaluate(() => document.fonts.ready);
// Never bake in a degraded render: the "now" row only exists when the database answered
await page.locator("#now").waitFor();
// The meta line changes with where George is and when; keep it out of a long-lived image.
// The page CSP blocks injected style tags, so set the property through the CSSOM instead.
await page.locator(".where").evaluate((el) => (el.style.visibility = "hidden"));
await page.screenshot({ path: "public/og.png" });
await browser.close();
console.log("wrote public/og.png");
