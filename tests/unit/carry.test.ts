import { afterEach, describe, expect, test, vi } from "vitest";
import { parseItems } from "../../src/lib/prints/basket";
import { carried, carryLabel, readCarry } from "../../src/lib/prints/carry";
import { loadBasket } from "../../src/lib/prints/store";
import { printDb } from "./prints-fakes";

const at = (query: string) => new URL(`https://curiousgeorge.dev/photos${query}`);

afterEach(() => vi.restoreAllMocks());

describe("loadBasket", () => {
  test("prices each line from the list, names its photo and keeps its 240 and 480 previews", async () => {
    const { basket, settings } = await loadBasket(await printDb(), parseItems("fixture-b-01:medium:oak,fixture-b-02:small:unframed,fixture-b-01:medium:oak"));
    expect(settings.rate).toBe(1.5);
    expect(basket).toMatchObject({ items: "fixture-b-01:medium:oak,fixture-b-01:medium:oak,fixture-b-02:small:unframed", count: 3, printTotal: 41700, unavailable: 0, overCap: 0 });
    expect(basket.lines.map((line) => [line.line, line.name, line.size.size, line.orientation, line.unitAmount, line.quantity])).toEqual([
      [1, "photo 1 of 2 from 14.06.26", "x12x18", "Vertical", 17900, 2],
      [2, "photo 2 of 2 from 14.06.26", "x8x12", "Horizontal", 5900, 1],
    ]);
    expect(basket.lines[0].thumb).toMatchObject({ url: expect.stringMatching(/\/media\/photos\/previews\/fixture-b-01\/.+\/240\.webp$/), width: 160, height: 240 });
    expect(basket.lines[0].image?.url).toMatch(/\/480\.webp$/);
  });

  test("a hidden photo, a size it doesn't get and an unknown photo are dropped and counted", async () => {
    const { basket } = await loadBasket(await printDb(), parseItems("fixture-03:small:oak,fixture-01:medium:oak,nobody-01:small:oak,fixture-01:small:oak"));
    expect(basket.lines.map((line) => `${line.photoId}:${line.tier}`)).toEqual(["fixture-01:small"]);
    expect(basket.lines[0].name).toBe('"a test photograph"');
    expect(basket.unavailable).toBe(3);
  });
});

describe("the carried basket", () => {
  test("a valid items parameter is carried in its canonical form, with its count", async () => {
    expect(await readCarry(await printDb(), at("?items=fixture-b-02:small:oak,fixture-b-01:large:unframed,fixture-b-02:small:oak"))).toEqual({
      items: "fixture-b-02:small:oak,fixture-b-02:small:oak,fixture-b-01:large:unframed", count: 3,
    });
  });

  test("no items, nothing valid or a failed read carries nothing", async () => {
    const db = await printDb();
    expect(await readCarry(db, at(""))).toBeNull();
    expect(await readCarry(db, at("?items=nobody-01:small:oak"))).toBeNull();
    expect(await readCarry(db, at("?items=garbage"))).toBeNull();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readCarry({ batch: () => Promise.reject(new Error("down")), prepare: () => ({ bind: () => ({}) }) } as unknown as D1Database, at("?items=fixture-01:small:oak"))).toBeNull();
  });

  test("links carry it after any query and before any fragment; the label counts prints", () => {
    const carry = { items: "fixture-01:small:oak", count: 1 };
    expect(carried("/photos", carry)).toBe("/photos?items=fixture-01:small:oak");
    expect(carried("/photos?before=12#post-x", carry)).toBe("/photos?before=12&items=fixture-01:small:oak#post-x");
    expect(carried("/photos", null)).toBe("/photos");
    expect(carryLabel(carry)).toBe("basket · 1 print");
    expect(carryLabel({ items: "x", count: 3 })).toBe("basket · 3 prints");
  });
});
