import { describe, expect, test } from "vitest";
import Downloads from "../../src/components/photos/Downloads.astro";
import type { Entry, PublicPhoto } from "../../src/lib/photos/store";
import { render, text } from "./render";

const photo = (id: string, bytes: number): PublicPhoto => ({
  id, collection: "post", title: "", width: 4000, height: 6000, downloadBytes: bytes, date: "2025-02-02", place: "bondi, sydney",
  previews: (["webp", "avif"] as const).map((format) => ({ url: `/media/photos/previews/${id}/s/240.${format}`, width: 160, height: 240, format })),
});
const ENTRIES: Entry[] = [{ collection: "post", date: "2025-02-02", place: "bondi, sydney", publishedAt: 1738488468, photos: [photo("post-01", 12_400_000), photo("post-02", 960_000)] }];
const ok = (over: Record<string, unknown> = {}) => ({ view: { state: "ok", entries: ENTRIES, token: "a.b+c/d", expiresAt: 1792035000, ...over } });

describe("Downloads", () => {
  test("lists every photo under its entry's heading, each a download that carries the token", async () => {
    const doc = await render(Downloads, ok());
    expect([...doc.querySelectorAll(".row > .label")].map(text)).toEqual(["downloads", "entries"]);
    expect(text(doc.querySelector("h1"))).toBe("photos, full size");
    expect(text(doc.querySelector("#post-post .entry-head"))).toBe("02.02.25 · bondi, sydney");
    const links = [...doc.querySelectorAll(".download-list a")];
    expect(links.map((a) => [a.getAttribute("href"), a.getAttribute("download"), text(a)])).toEqual([
      ["/photos/downloads/post-01?token=a.b%2Bc%2Fd", "post-01.jpg", "download · 12.4 mb, photo 1 of 2 from 02.02.25"],
      ["/photos/downloads/post-02?token=a.b%2Bc%2Fd", "post-02.jpg", "download · 1.0 mb, photo 2 of 2 from 02.02.25"],
    ]);
    // Each link's name says which photograph, in text only a screen reader reads, so a list of links tells them apart
    expect(links[0].querySelector(".sr-only")!.textContent).toBe(", photo 1 of 2 from 02.02.25");
    expect(doc.querySelector("#download-post-01")!.getAttribute("alt")).toBe("photo 1 of 2 from 2 february 2025, bondi, sydney");
    const img = doc.querySelector(".download-list img")!;
    expect([img.getAttribute("loading"), img.getAttribute("alt"), img.getAttribute("src")]).toEqual(["lazy", "photo 1 of 2 from 2 february 2025, bondi, sydney", "/media/photos/previews/post-01/s/240.webp"]);
    expect(doc.querySelector("script")).toBeNull();
  });

  test("says until when the link works in sydney time, on either side of daylight saving", async () => {
    expect(text((await render(Downloads, ok())).querySelector(".intro"))).toBe(
      "every photo in the gallery as a full-resolution jpeg. this link works until 15.10.26, 2:30 pm sydney time. please keep it to yourself.",
    );
    // 04:30 UTC in June is 2:30 pm in Sydney's winter (AEST); 03:30 UTC in October is 2:30 pm in its summer (AEDT)
    expect(text((await render(Downloads, ok({ expiresAt: 1781497800 }))).querySelector(".intro"))).toContain("this link works until 15.06.26, 2:30 pm sydney time.");
  });

  test("a valid link with nothing published says so", async () => {
    const doc = await render(Downloads, ok({ entries: [] }));
    expect(text(doc.querySelector("#entries .empty"))).toBe("no photos up yet.");
  });

  test("a link that has run out says so the same way whatever the reason, with George's address", async () => {
    const doc = await render(Downloads, { view: { state: "gone" } });
    expect([...doc.querySelectorAll(".row > .label")].map(text)).toEqual(["downloads"]);
    expect(text(doc.querySelector("h1"))).toBe("this link has run out");
    expect(text(doc.querySelector(".intro"))).toBe("it may have expired or been switched off. if you were expecting photos, ask george for a fresh one: hello@curiousgeorge.dev.");
    expect(doc.querySelector('.intro a[href="mailto:hello@curiousgeorge.dev"]')).not.toBeNull();
  });

  test("when downloads aren't working it says so", async () => {
    const doc = await render(Downloads, { view: { state: "down" } });
    expect(text(doc.querySelector("h1"))).toBe("photos, full size");
    expect(text(doc.querySelector(".intro"))).toBe("downloads aren't working right now. try again in a bit.");
    expect(doc.querySelector(".download-list")).toBeNull();
  });
});
