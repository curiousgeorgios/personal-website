import { afterEach, expect, test, vi } from "vitest";
import { makeVariants, VARIANT_BUDGETS } from "../../workers/snapshots/src/variants";

// The Images binding: the size of each output comes from `size(width, format, quality)`
function fakeImages(size: (width: number, format: string, quality: number) => number) {
  const asked: string[] = [];
  return {
    asked,
    input: () => {
      let width = 0;
      return {
        transform(options: { width: number; fit: string }) {
          width = options.width;
          asked.push(`transform ${options.width} ${options.fit}`);
          return this;
        },
        async output({ format, quality }: { format: string; quality: number }) {
          asked.push(`output ${width} ${format} ${quality}`);
          const bytes = new Uint8Array(size(width, format, quality));
          return { image: () => new Blob([bytes]).stream(), contentType: () => format, response: () => new Response() };
        },
      };
    },
  };
}

afterEach(() => vi.restoreAllMocks());

const png = new Uint8Array(600_000);
const base = "snapshots/canberra-events-01k6d4x3n9e5r2q7w8y0z1a2b3";

test("makes AVIF and WebP at 480, 960 and 1920 wide, keeping the aspect ratio", async () => {
  const images = fakeImages(() => 5_000);
  const variants = await makeVariants(images as unknown as ImagesBinding, png, base);
  expect(variants.map((variant) => [variant.key, variant.type, variant.bytes.length])).toEqual([
    [`${base}-480.avif`, "image/avif", 5_000],
    [`${base}-480.webp`, "image/webp", 5_000],
    [`${base}-960.avif`, "image/avif", 5_000],
    [`${base}-960.webp`, "image/webp", 5_000],
    [`${base}-1920.avif`, "image/avif", 5_000],
    [`${base}-1920.webp`, "image/webp", 5_000],
  ]);
  expect(images.asked.filter((line) => line.startsWith("transform"))).toEqual(Array(6).fill("").map((_, i) => `transform ${[480, 480, 960, 960, 1920, 1920][i]} scale-down`));
});

test("steps the quality down until a variant fits its budget; the 1920 has none", async () => {
  // Over budget at quality 70 and 60, fits at 50
  const images = fakeImages((width, _format, quality) => (width === 1920 ? 400_000 : quality > 50 ? VARIANT_BUDGETS[width as 480 | 960]! + 1 : 1_000));
  const variants = await makeVariants(images as unknown as ImagesBinding, png, base);
  expect(images.asked.filter((line) => line.startsWith("output 480 image/avif"))).toEqual(["output 480 image/avif 70", "output 480 image/avif 60", "output 480 image/avif 50"]);
  expect(images.asked.filter((line) => line.startsWith("output 1920"))).toEqual(["output 1920 image/avif 70", "output 1920 image/webp 70"]);
  expect(variants.find((variant) => variant.key.endsWith("-1920.webp"))!.bytes.length).toBe(400_000);
});

test("a variant that never fits keeps its smallest try, with a warning", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const images = fakeImages((width) => (width === 480 ? 40_000 : 1_000));
  const variants = await makeVariants(images as unknown as ImagesBinding, png, base);
  expect(images.asked.filter((line) => line.startsWith("output 480 image/webp"))).toEqual(["output 480 image/webp 70", "output 480 image/webp 60", "output 480 image/webp 50", "output 480 image/webp 40"]);
  expect(variants[0].bytes.length).toBe(40_000);
  expect(warn).toHaveBeenCalledTimes(2);
});

// The budgets are "under": a variant exactly at its budget is over it, one byte less fits
test.each([
  [480, 30_720],
  [960, 71_680],
] as const)("at %i wide, %i bytes is over the budget and one byte less fits", async (width, budget) => {
  const atBudget = fakeImages((w, _format, quality) => (w === width ? (quality === 70 ? budget : budget - 1) : 1_000));
  const stepped = await makeVariants(atBudget as unknown as ImagesBinding, png, base);
  expect(atBudget.asked.filter((line) => line.startsWith(`output ${width} image/avif`))).toEqual([`output ${width} image/avif 70`, `output ${width} image/avif 60`]);
  expect(stepped.find((variant) => variant.key === `${base}-${width}.avif`)!.bytes.length).toBe(budget - 1);

  const under = fakeImages((w) => (w === width ? budget - 1 : 1_000));
  await makeVariants(under as unknown as ImagesBinding, png, base);
  expect(under.asked.filter((line) => line.startsWith(`output ${width} image/avif`))).toEqual([`output ${width} image/avif 70`]);
});

test("a variant that never fits keeps the smallest it tried, even when that isn't the last", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  // Quality 40 comes out bigger than quality 50 here, and none of them fit
  const sizes: Record<number, number> = { 70: 50_000, 60: 40_000, 50: 35_000, 40: 36_000 };
  const images = fakeImages((width, format, quality) => (width === 480 && format === "image/webp" ? sizes[quality] : 1_000));
  const variants = await makeVariants(images as unknown as ImagesBinding, png, base);
  expect(variants[1].key).toBe(`${base}-480.webp`);
  expect(variants[1].bytes.length).toBe(35_000);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("35000 bytes"));
});
