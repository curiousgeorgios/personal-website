import { describe, expect, test } from "vitest";
import Turntable from "../../src/components/Turntable.astro";
import type { Track } from "../../src/lib/logbook";
import { NIGHT_POSTER } from "../../src/scripts/night-poster.mjs";
import { render, text } from "./render";

const records: Track[] = [
  { id: 1, title: "simple things", artist: "loom room", audioKey: "audio/simple-things.mp3", coverKey: "covers/simple-things.webp", side: "a1" },
  { id: 2, title: "nyc in 1940", artist: "berlioz, ted jasper", audioKey: "audio/nyc-in-1940.mp3", coverKey: "covers/nyc-in-1940.webp", side: "a2" },
];

describe("Turntable", () => {
  test("lists every record with its side, artist and a play state", async () => {
    const doc = await render(Turntable, { records });
    expect([...doc.querySelectorAll(".tracks li")].map((row) => text(row))).toEqual([
      "a1 simple things - loom room play",
      "a2 nyc in 1940 - berlioz, ted jasper play",
    ]);
    // A link to the MP3, so the row plays without JavaScript; the deck script makes it a button
    const link = doc.querySelector(".tracks a.pick")!;
    expect(link.getAttribute("href")).toBe("/media/audio/simple-things.mp3");
    expect(link.hasAttribute("type")).toBe(false);
    expect(link.hasAttribute("aria-pressed")).toBe(false);
    expect(link.getAttribute("data-index")).toBe("0");
    expect(link.getAttribute("data-id")).toBe("1");
    expect(link.getAttribute("data-src")).toBe("/media/audio/simple-things.mp3");
    expect(link.getAttribute("data-cover")).toBe("/media/covers/simple-things.webp");
    expect(link.getAttribute("data-title")).toBe("simple things");
    expect(link.getAttribute("data-artist")).toBe("loom room");
    expect(doc.querySelector(".tracks button")).toBeNull();
  });

  test("has the deck, the hint, a polite live region and one audio element that preloads nothing", async () => {
    const doc = await render(Turntable, { records });
    expect(doc.querySelector("[data-deck]")).not.toBeNull();
    expect(text(doc.querySelector(".hint .hint-scene"))).toBe("flip through the crate with ‹ ›, or pick a track. nothing plays until you do.");
    expect(text(doc.querySelector(".hint .hint-list"))).toBe("pick a track. nothing plays until you do.");
    const status = doc.querySelector("[data-deck-status]")!;
    expect([status.getAttribute("role"), status.getAttribute("aria-live")]).toEqual(["status", "polite"]);
    expect([...doc.querySelectorAll("audio")].map((audio) => audio.getAttribute("preload"))).toEqual(["none"]);
    const poster = doc.querySelector("[data-deck] .poster img")!;
    expect([poster.getAttribute("src"), poster.getAttribute("alt"), poster.getAttribute("loading")]).toEqual(["/posters/deck-desktop.webp", "", "lazy"]);
    expect(doc.querySelector('[data-deck] .poster source[media="(max-width: 680px)"]')?.getAttribute("srcset")).toBe("/posters/deck-phone.webp");
    // The night poster's script runs straight after the picture, before it paints, with exactly the text the CSP hashes
    expect(doc.querySelector("[data-deck] .poster + script")?.textContent).toBe(NIGHT_POSTER);
  });

  test("shows only the empty line when there are no records", async () => {
    const doc = await render(Turntable, { records: [] });
    expect(text(doc.querySelector(".empty"))).toBe("nothing on the turntable right now.");
    expect(doc.querySelector("[data-deck]")).toBeNull();
    expect(doc.querySelector("audio")).toBeNull();
  });
});
