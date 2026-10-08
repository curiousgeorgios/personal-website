import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { parseHTML } from "linkedom";
import { expect, test } from "vitest";
import Notebook from "../../src/layouts/Notebook.astro";

// The layout renders a whole document, so it is parsed as one rather than inside render()'s body
async function page(props: Record<string, unknown>) {
  const container = await AstroContainer.create();
  return parseHTML(await container.renderToString(Notebook, { props, slots: { default: "<main>hi</main>" } })).document;
}
const meta = (doc: Document, selector: string) => doc.querySelector(selector)?.getAttribute("content") ?? null;

test("pages share /og.png unless they bring their own image, absolute and with its size", async () => {
  let doc = await page({});
  expect([meta(doc, 'meta[property="og:image"]'), meta(doc, 'meta[property="og:image:width"]'), meta(doc, 'meta[property="og:image:height"]')]).toEqual(["https://curiousgeorge.dev/og.png", "1200", "630"]);
  doc = await page({ ogImage: { url: "https://curiousgeorge.dev/media/photos/previews/x-01/s/1600.webp", width: 1067, height: 1600 } });
  expect([meta(doc, 'meta[property="og:image"]'), meta(doc, 'meta[property="og:image:width"]'), meta(doc, 'meta[property="og:image:height"]')]).toEqual([
    "https://curiousgeorge.dev/media/photos/previews/x-01/s/1600.webp", "1067", "1600",
  ]);
});

test("a referrer policy is the head's second tag (before anything is fetched) and absent otherwise", async () => {
  let doc = await page({ referrer: "no-referrer", noindex: true });
  expect(meta(doc, 'meta[name="referrer"]')).toBe("no-referrer");
  expect(doc.head.children[1].getAttribute("name")).toBe("referrer");
  expect(doc.querySelector('link[rel="canonical"]')).toBeNull();
  doc = await page({});
  expect(doc.querySelector('meta[name="referrer"]')).toBeNull();
});

test("a title with markup stays text", async () => {
  const doc = await page({ title: '<b>dawn</b> & "co" · photos · george vlachos' });
  expect(doc.querySelector("title")!.textContent).toBe('<b>dawn</b> & "co" · photos · george vlachos');
  expect(doc.querySelector("head b")).toBeNull();
  expect(meta(doc, 'meta[property="og:title"]')).toBe('<b>dawn</b> & "co" · photos · george vlachos');
});
