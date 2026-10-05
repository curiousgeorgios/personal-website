// Renders the posters the deck shows until (or instead of) the 3D scene (spec 5.2): no record on the platter and one
// plain, unprinted sleeve in the crate's front slot, which is true whenever the corner shows (it only shows with at least
// one active record). A day pair and a night pair (the scene is candlelit from 19:00 to 06:00 in Sydney), each in desktop
// and phone framing. Rerun whenever the scene changes, and look at all four before committing them.
//   bun run build:test && bun run serve    (leave it running)
//   bun run poster
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const BASE = process.env.POSTER_URL ?? "http://localhost:4331";
const LIMIT = 60 * 1024;
const MIDDAY = new Date("2026-10-05T02:00:00Z"); // 13:00 in Sydney: daylight
const NIGHT = new Date("2026-10-05T11:00:00Z"); // 22:00 in Sydney: candlelight
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 375, height: 812 };

async function render(name, viewport, time) {
  const browser = await chromium.launch();
  let png;
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2, reducedMotion: "reduce" });
    await page.clock.setFixedTime(time);
    await page.goto(BASE);
    await page.locator("[data-deck]").scrollIntoViewIfNeeded();
    await page.locator("[data-deck].live").waitFor({ timeout: 60_000 });
    await page.evaluate(() => {
      window.__deckScene.poster();
      // Transparent around the room, so the page's own dot grid shows through the poster
      document.documentElement.style.background = "transparent";
      document.body.style.background = "transparent";
      // The full-bleed phone canvas sits over the margin rule; keep the rule out of the poster
      for (const el of document.querySelectorAll(".row > .label, .row > .body")) el.style.borderLeftColor = "transparent";
    });
    await page.waitForTimeout(500);
    png = await page.locator("[data-deck] canvas").screenshot({ omitBackground: true });
  } finally {
    await browser.close();
  }
  let quality = 80;
  let out = await sharp(png).webp({ quality, alphaQuality: 80, effort: 6 }).toBuffer();
  while (out.length >= LIMIT && quality > 30) out = await sharp(png).webp({ quality: (quality -= 5), alphaQuality: 70, effort: 6 }).toBuffer();
  if (out.length >= LIMIT) throw new Error(`${name}: still ${out.length} bytes at quality ${quality}`);
  writeFileSync(`public/posters/${name}.webp`, out);
  console.log(`public/posters/${name}.webp: ${out.length} bytes at quality ${quality}`);
}

mkdirSync("public/posters", { recursive: true });
for (const [suffix, time] of [["", MIDDAY], ["-night", NIGHT]]) {
  await render(`deck-desktop${suffix}`, DESKTOP, time);
  await render(`deck-phone${suffix}`, PHONE, time);
}
