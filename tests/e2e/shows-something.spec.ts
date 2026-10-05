import { expect, test } from "@playwright/test";
import { SHOWS_SOMETHING } from "../../workers/snapshots/src/capture";

// The snapshots Worker asks each page whether it shows anything before taking the shot (spec 9), because a blank 2x
// screenshot is too big for the size floor to catch. The question runs here in a real browser, against a page per case.
test.skip(({ browserName }) => browserName !== "chromium", "the Worker's browser is Chromium");

const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const cases: [string, string, boolean][] = [
  ["text", "<p>hello</p>", true],
  ["an image", `<img src="${GIF}" width="40" height="40" alt="">`, true],
  ["only a background image on the page", "<style>body{margin:0;min-height:100vh;background:linear-gradient(#f4efe6,#d9e4f5)}</style>", true],
  ["only a background image on an element", "<style>div{width:200px;height:200px;background-image:linear-gradient(red,blue)}</style><div></div>", true],
  ["a background image on an element with no box", "<style>div{background-image:linear-gradient(red,blue)}</style><div></div>", false],
  ["nothing at all", "", false],
  ["only spaces", "<p>   </p>", false],
];

for (const [name, html, expected] of cases) {
  test(`a page with ${name} ${expected ? "shows something" : "is blank"}`, async ({ page }) => {
    await page.setContent(`<!doctype html><html><head><title>a case</title></head><body>${html}</body></html>`);
    expect(await page.evaluate(SHOWS_SOMETHING)).toBe(expected);
  });
}
