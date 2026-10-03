import { readdirSync, statSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, test } from "vitest";

const SLUGS = ["simple-things", "nyc-in-1940", "no-bad-feelings-today", "light-it-up"];

describe("the starting crate's media", () => {
  test("has exactly the four tracks", () => {
    expect(readdirSync("media/audio").sort()).toEqual(SLUGS.map((slug) => `${slug}.mp3`).sort());
  });

  test.each(SLUGS)("%s has a 512px WebP cover under 40KB", async (slug) => {
    const file = `media/covers/${slug}.webp`;
    expect(statSync(file).size).toBeLessThan(40 * 1024);
    const meta = await sharp(file).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 512, 512]);
  });
});
