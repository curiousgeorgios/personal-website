// Magic bytes, because a file's name and the browser's reported type can say anything (spec 7)

/** "mp3" for an ID3 tag or an MPEG audio frame (layers I to III, so not AAC), otherwise null */
export function sniffAudio(head: Uint8Array): "mp3" | null {
  if (head.length >= 3 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return "mp3";
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0) return "mp3";
  return null;
}

const startsWith = (head: Uint8Array, bytes: number[], at = 0) => head.length >= at + bytes.length && bytes.every((byte, i) => head[at + i] === byte);

/** The type of a JPEG, PNG or WebP image, otherwise null (SVG, GIF and everything else are refused) */
export function sniffImage(head: Uint8Array): "jpeg" | "png" | "webp" | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  return null;
}
