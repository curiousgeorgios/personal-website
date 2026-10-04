import { ulid } from "./ulid";

/** Spec 11: covers are 512px WebP under 40KB */
export const COVER_LIMIT = 40 * 1024;
const QUALITIES = [80, 72, 64, 56, 48, 40];

export interface MediaKeys {
  audioKey: string;
  coverKey: string;
}

/** Fresh, never-reused R2 keys for a record's files, under the prefixes /media serves (spec 6.2) */
export function newMediaKeys(id = ulid()): MediaKeys {
  return { audioKey: `audio/${id}.mp3`, coverKey: `covers/${id}.webp` };
}

/** The cover as a 512 × 512 WebP under 40KB, stepping the quality down until it fits; null if it never does */
export async function makeCover(images: ImagesBinding, file: Blob): Promise<Uint8Array | null> {
  for (const quality of QUALITIES) {
    const result = await images.input(file.stream()).transform({ width: 512, height: 512, fit: "cover" }).output({ format: "image/webp", quality });
    const bytes = new Uint8Array(await new Response(result.image()).arrayBuffer());
    if (bytes.length < COVER_LIMIT) return bytes;
  }
  return null;
}
