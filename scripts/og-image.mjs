// Renders the 1200 × 630 Open Graph image from the running site (bun run serve in another terminal).
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
// A fixed, unremarkable morning time so the image doesn't show whenever it happened to be rendered
await page.clock.setFixedTime(new Date("2026-10-02T23:00:00Z"));
await page.goto(process.env.OG_URL ?? "http://localhost:4331/");
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: "public/og.png" });
await browser.close();
console.log("wrote public/og.png");
