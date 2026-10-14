import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { needsNativeRender, photoFingerprint } from "../../scripts/photo-recipe.mjs";

test("lossless native preparation invalidates old RAW and HEIC checkpoints while JPEG checkpoints remain reusable", () => {
  const bytes = Buffer.from("recorded source bytes");
  const source = { path: "photo.jpg", kind: "edited", display_width: 3648, display_height: 5472 };
  const old = createHash("sha256").update(bytes).update("gallery-v1:edited:3648:5472").digest("hex");
  expect(photoFingerprint(bytes, source)).toBe(old);
  expect(photoFingerprint(bytes, { ...source, path: "photo.JPEG" })).toBe(old);
  for (const extension of ["ARW", "dng", "HEIC"]) {
    const native = { ...source, path: `photo.${extension}` };
    expect(needsNativeRender(native.path)).toBe(true);
    expect(photoFingerprint(bytes, native)).not.toBe(old);
    expect(photoFingerprint(bytes, native)).not.toBe(photoFingerprint(bytes, { ...native, display_width: 3647 }));
  }
});
