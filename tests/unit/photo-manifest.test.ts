import { describe, expect, test } from "vitest";
import { hasAllPreviews, type Preview } from "../../src/lib/photos/store";
import { checkPhotoRecord, PREVIEW_FORMATS, PREVIEW_SIZES } from "../../scripts/photo-manifest.mjs";

const SHA = "e5".repeat(32);
const preview = (size: number, format: string) => ({ key: `photos/previews/post-01/${SHA}/${size}.${format}`, format });
const record = (over: Record<string, unknown> = {}) => ({
  id: "post-01",
  collection: "post",
  position: 0,
  print: { key: `prints/post-01/${SHA}.jpg`, sha256: SHA },
  previews: PREVIEW_SIZES.flatMap((size: number) => PREVIEW_FORMATS.map((format: string) => preview(size, format))),
  ...over,
});

describe("checkPhotoRecord", () => {
  test("accepts eight previews, 240 to 1600, in WebP and AVIF", () => {
    expect(PREVIEW_SIZES).toEqual([240, 480, 960, 1600]);
    expect(() => checkPhotoRecord(record())).not.toThrow();
  });

  test("refuses a record from before the 240s, with its six previews", () => {
    const six = record().previews.filter((p: { key: string }) => !p.key.includes("/240."));
    expect(() => checkPhotoRecord(record({ previews: six }))).toThrow("Missing responsive variants: post-01");
  });

  test("refuses a repeated preview, a size the site doesn't use and a format that doesn't match its key", () => {
    const previews = record().previews;
    expect(() => checkPhotoRecord(record({ previews: [...previews.slice(1), previews[2]] }))).toThrow("Missing responsive variants");
    expect(() => checkPhotoRecord(record({ previews: [...previews.slice(1), preview(320, "webp")] }))).toThrow("Invalid preview key");
    expect(() => checkPhotoRecord(record({ previews: [{ ...previews[0], format: "avif" }, ...previews.slice(1)] }))).toThrow("Invalid preview key");
  });

  test("refuses a bad id, collection, position or print key", () => {
    expect(() => checkPhotoRecord(record({ id: "../secret" }))).toThrow("Invalid catalogue record");
    expect(() => checkPhotoRecord(record({ collection: "a/b" }))).toThrow("Invalid catalogue record");
    expect(() => checkPhotoRecord(record({ position: -1 }))).toThrow("Invalid catalogue record");
    expect(() => checkPhotoRecord(record({ print: { key: `prints/other-01/${SHA}.jpg`, sha256: SHA } }))).toThrow("Invalid print key");
  });
});

describe("the publish check's previews", () => {
  const eight = record().previews as unknown as Preview[];

  test("accepts the eight and refuses a photograph missing its 240s", () => {
    expect(hasAllPreviews(eight)).toBe(true);
    expect(hasAllPreviews(eight.filter((p) => !p.key.includes("/240.")))).toBe(false);
  });

  test("refuses eight previews when a 240 is missing and a 480 is repeated", () => {
    const repeated = [...eight.filter((p) => p.key !== eight[0].key), eight[2]];
    expect(repeated).toHaveLength(8);
    expect(hasAllPreviews(repeated)).toBe(false);
  });
});
