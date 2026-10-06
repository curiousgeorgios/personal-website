import { expect, test } from "@playwright/test";
import { withGpc } from "./gpc";

// CI runs this after a deploy, against the live site (PLAYWRIGHT_BASE_URL), to catch a forgotten `seed:media --remote`:
// the records come from D1, so without the files in R2 every one of them would fail with "couldn't play". Locally it
// runs against the seeded store, once, in Chromium.
test.skip(({ browserName }) => browserName !== "chromium", "HTTP behaviour, checked once");

test("every record's audio streams with a range and its cover is WebP", async ({ page, request }) => {
  // Against the live site the beacon would count this check as a visit; Global Privacy Control switches it off
  if (process.env.PLAYWRIGHT_BASE_URL) await withGpc(page);
  // A unique query (set by CI after a deploy) bypasses the edge cache, so the new version's records are what gets checked
  await page.goto(process.env.PRIVACY_PATH ?? "/");
  const media = await page.locator(".tracks button").evaluateAll((buttons) =>
    buttons.map((button) => ({ audio: (button as HTMLElement).dataset.src ?? "", cover: (button as HTMLElement).dataset.cover ?? "" })),
  );
  test.skip(media.length === 0, "no records on the turntable");
  for (const { audio, cover } of media) {
    expect(audio, "a record with no audio").not.toBe("");
    expect(cover, "a record with no cover").not.toBe("");
    const part = await request.get(audio, { headers: { Range: "bytes=0-1023" } });
    expect(part.status(), `${audio} answers a range request`).toBe(206);
    expect(part.headers()["content-range"], `${audio} says where the range sits`).toMatch(/^bytes 0-1023\/\d+$/);
    expect((await part.body()).length, `${audio} sends the range`).toBe(1024);
    const image = await request.get(cover);
    expect(image.status(), `${cover} exists`).toBe(200);
    expect(image.headers()["content-type"], `${cover} is WebP`).toBe("image/webp");
  }
});
