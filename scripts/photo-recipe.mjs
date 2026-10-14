import { createHash } from "node:crypto";
import { extname } from "node:path";

export const needsNativeRender = (path) => [".arw", ".dng", ".heic"].includes(extname(path).toLowerCase());

export function photoFingerprint(bytes, source) {
  const recipe = needsNativeRender(source.path) ? "gallery-v2-lossless-native" : "gallery-v1";
  return createHash("sha256").update(bytes).update(`${recipe}:${source.kind}:${source.display_width}:${source.display_height}`).digest("hex");
}
