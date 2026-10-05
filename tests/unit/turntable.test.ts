import { describe, expect, test } from "vitest";
import Turntable from "../../src/components/Turntable.astro";
import type { Track } from "../../src/lib/logbook";
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
    const button = doc.querySelector(".tracks button")!;
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("data-index")).toBe("0");
    expect(button.getAttribute("data-id")).toBe("1");
    expect(button.getAttribute("data-src")).toBe("/media/audio/simple-things.mp3");
    expect(button.getAttribute("data-cover")).toBe("/media/covers/simple-things.webp");
    expect(button.getAttribute("data-title")).toBe("simple things");
    expect(button.getAttribute("data-artist")).toBe("loom room");
  });

  test("has the deck, the hint, a polite live region and one audio element that preloads nothing", async () => {
    const doc = await render(Turntable, { records });
    expect(doc.querySelector("[data-deck]")).not.toBeNull();
    expect(text(doc.querySelector(".hint"))).toBe("flip through the crate with ‹ ›, or pick a track. nothing plays until you do.");
    const status = doc.querySelector("[data-deck-status]")!;
    expect([status.getAttribute("role"), status.getAttribute("aria-live")]).toEqual(["status", "polite"]);
    expect([...doc.querySelectorAll("audio")].map((audio) => audio.getAttribute("preload"))).toEqual(["none"]);
    const poster = doc.querySelector("[data-deck] .poster img")!;
    expect([poster.getAttribute("src"), poster.getAttribute("alt"), poster.getAttribute("loading")]).toEqual(["/posters/deck-desktop.webp", "", "lazy"]);
    expect(doc.querySelector('[data-deck] .poster source[media="(max-width: 680px)"]')?.getAttribute("srcset")).toBe("/posters/deck-phone.webp");
  });

  test("shows only the empty line when there are no records", async () => {
    const doc = await render(Turntable, { records: [] });
    expect(text(doc.querySelector(".empty"))).toBe("nothing on the turntable right now.");
    expect(doc.querySelector("[data-deck]")).toBeNull();
    expect(doc.querySelector("audio")).toBeNull();
  });
});
