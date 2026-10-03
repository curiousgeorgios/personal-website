import { describe, expect, test, vi } from "vitest";
import { isMediaKey, serveMedia } from "../../src/lib/media";

const BYTES = Uint8Array.from({ length: 2000 }, (_, i) => i % 256);

// Mimics R2: ranges come back as { offset, length }, { offset } or { suffix }; a matching If-None-Match returns no body
function fakeBucket(objects: Record<string, string>) {
  return {
    get: vi.fn(async (key: string, options?: { range?: Headers; onlyIf?: Headers }) => {
      const type = objects[key];
      if (!type) return null;
      const size = BYTES.length;
      const base = {
        key,
        size,
        httpEtag: `"etag-${key}"`,
        writeHttpMetadata: (headers: Headers) => headers.set("Content-Type", type),
      };
      if (options?.onlyIf?.get("If-None-Match") === base.httpEtag) return base;
      const match = /^bytes=(\d*)-(\d*)$/.exec(options?.range?.get("Range") ?? "");
      if (match && match[1] !== "" && Number(match[1]) >= size) throw new Error("The requested range is not satisfiable");
      let range: { offset?: number; length?: number; suffix?: number } | undefined;
      let slice = BYTES;
      if (match && match[1] === "") {
        range = { suffix: Number(match[2]) };
        slice = BYTES.slice(size - Number(match[2]));
      } else if (match && match[2] === "") {
        range = { offset: Number(match[1]) };
        slice = BYTES.slice(Number(match[1]));
      } else if (match) {
        const offset = Number(match[1]);
        range = { offset, length: Number(match[2]) - offset + 1 };
        slice = BYTES.slice(offset, Number(match[2]) + 1);
      }
      return { ...base, range, body: new Blob([slice]).stream() };
    }),
  } as unknown as R2Bucket & { get: ReturnType<typeof vi.fn> };
}

const bucket = () => fakeBucket({ "audio/a.mp3": "audio/mpeg", "covers/a.webp": "image/webp" });
const get = (headers: Record<string, string> = {}) => new Request("https://curiousgeorge.dev/media/x", { headers });

describe("isMediaKey", () => {
  test("allows only the audio, covers and snapshots prefixes", () => {
    expect(["audio/a.mp3", "covers/a.webp", "snapshots/s/480.avif"].every(isMediaKey)).toBe(true);
    expect(["", "a.mp3", "secret/a", "audio", "audios/a.mp3"].some(isMediaKey)).toBe(false);
  });

  test("rejects dot segments and empty segments", () => {
    expect(["audio/../secret", "audio/./a.mp3", "audio//a.mp3", "audio/a/.."].some(isMediaKey)).toBe(false);
    expect(isMediaKey("audio/a..b.mp3")).toBe(true);
  });
});

describe("serveMedia", () => {
  test("streams a whole object with its type and long-lived caching", async () => {
    const response = await serveMedia(bucket(), "audio/a.mp3", get());
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "audio/mpeg",
      "content-length": "2000",
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      etag: '"etag-audio/a.mp3"',
    });
    expect((await response.arrayBuffer()).byteLength).toBe(2000);
  });

  test("answers a byte range with 206 and Content-Range", async () => {
    const response = await serveMedia(bucket(), "audio/a.mp3", get({ Range: "bytes=100-1099" }));
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 100-1099/2000");
    expect(response.headers.get("content-length")).toBe("1000");
    expect(new Uint8Array(await response.arrayBuffer())[0]).toBe(100);
  });

  test("answers open-ended and suffix ranges", async () => {
    const open = await serveMedia(bucket(), "audio/a.mp3", get({ Range: "bytes=1500-" }));
    expect([open.status, open.headers.get("content-range")]).toEqual([206, "bytes 1500-1999/2000"]);
    const suffix = await serveMedia(bucket(), "audio/a.mp3", get({ Range: "bytes=-500" }));
    expect([suffix.status, suffix.headers.get("content-range"), suffix.headers.get("content-length")]).toEqual([206, "bytes 1500-1999/2000", "500"]);
  });

  test("answers a range past the end with 416, uncached", async () => {
    const response = await serveMedia(bucket(), "audio/a.mp3", get({ Range: "bytes=5000-" }));
    expect([response.status, response.headers.get("content-range"), response.headers.get("cache-control")]).toEqual([416, "bytes */*", "no-store"]);
  });

  test("returns 304 when the browser's copy is current", async () => {
    const response = await serveMedia(bucket(), "audio/a.mp3", get({ "If-None-Match": '"etag-audio/a.mp3"' }));
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"etag-audio/a.mp3"');
  });

  test("404s, uncached, for missing objects and disallowed keys without touching R2 for the latter", async () => {
    const b = bucket();
    for (const key of ["audio/missing.mp3", "secret/a", "audio/../covers/a.webp"]) {
      const response = await serveMedia(b, key, get());
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(b.get).toHaveBeenCalledTimes(1);
  });
});
