import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { isMediaKey, photoCacheTag, previewPhotoId, publishedPreviews, serveMedia, type PreviewGate } from "../../src/lib/media";
import { sqliteD1 } from "./sqlite-d1";

const BYTES = Uint8Array.from({ length: 2000 }, (_, i) => i % 256);

// Mimics R2: ranges come back as { offset, length }, { offset } or { suffix }; a matching If-None-Match returns no body;
// head finds known keys only
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
    head: vi.fn(async (key: string) => (objects[key] ? { key, size: BYTES.length } : null)),
  } as unknown as R2Bucket & { get: ReturnType<typeof vi.fn>; head: ReturnType<typeof vi.fn> };
}

const PREVIEW = `photos/previews/post-01/${"a".repeat(64)}/240.avif`;
const bucket = () => fakeBucket({ "audio/a.mp3": "audio/mpeg", "covers/a.webp": "image/webp", "snapshots/s/480.avif": "image/avif", [PREVIEW]: "image/avif" });
// Audio, covers and snapshots never ask whether a photograph is published: a question here would fail the test with a 500
const unasked: PreviewGate = async () => { throw new Error("asked about a key that isn't a preview"); };
const serve = (b: R2Bucket, key: string, request: Request) => serveMedia(b, key, request, unasked);
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
  // R2 failures are logged on purpose; keep that out of the test output and check it where it matters
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errors.mockRestore());

  test("streams a whole object with its type and long-lived caching", async () => {
    const response = await serve(bucket(), "audio/a.mp3", get());
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
    const response = await serve(bucket(), "audio/a.mp3", get({ Range: "bytes=100-1099" }));
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 100-1099/2000");
    expect(response.headers.get("content-length")).toBe("1000");
    expect(new Uint8Array(await response.arrayBuffer())[0]).toBe(100);
  });

  test("answers open-ended and suffix ranges", async () => {
    const open = await serve(bucket(), "audio/a.mp3", get({ Range: "bytes=1500-" }));
    expect([open.status, open.headers.get("content-range")]).toEqual([206, "bytes 1500-1999/2000"]);
    const suffix = await serve(bucket(), "audio/a.mp3", get({ Range: "bytes=-500" }));
    expect([suffix.status, suffix.headers.get("content-range"), suffix.headers.get("content-length")]).toEqual([206, "bytes 1500-1999/2000", "500"]);
  });

  test("answers a range past the end with 416 and the object's size, uncached", async () => {
    const response = await serve(bucket(), "audio/a.mp3", get({ Range: "bytes=5000-" }));
    expect([response.status, response.headers.get("content-range"), response.headers.get("cache-control")]).toEqual([416, "bytes */2000", "no-store"]);
    expect(errors).toHaveBeenCalledWith("media: R2 read failed", "audio/a.mp3", expect.any(Error));
  });

  test("returns 304 when the browser's copy is current", async () => {
    const response = await serve(bucket(), "audio/a.mp3", get({ "If-None-Match": '"etag-audio/a.mp3"' }));
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"etag-audio/a.mp3"');
  });

  test("404s, uncached, for missing objects and disallowed keys without touching R2 for the latter", async () => {
    const b = bucket();
    for (const key of ["audio/missing.mp3", "secret/a", "audio/../covers/a.webp"]) {
      const response = await serve(b, key, get());
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(b.get).toHaveBeenCalledTimes(1);
  });

  test("404s, uncached, when a ranged read throws for an object that is not there", async () => {
    const b = Object.assign(bucket(), { get: vi.fn().mockRejectedValue(new Error("boom")) });
    const response = await serve(b, "audio/missing.mp3", get({ Range: "bytes=0-" }));
    expect([response.status, response.headers.get("cache-control")]).toEqual([404, "no-store"]);
    expect(b.head).toHaveBeenCalledWith("audio/missing.mp3");
  });

  test("500s, uncached, when both the read and the check for the object fail", async () => {
    const b = Object.assign(bucket(), {
      get: vi.fn().mockRejectedValue(new Error("boom")),
      head: vi.fn().mockRejectedValue(new Error("still boom")),
    });
    const response = await serve(b, "audio/a.mp3", get({ Range: "bytes=0-" }));
    expect([response.status, response.headers.get("cache-control")]).toEqual([500, "no-store"]);
    expect(await response.text()).toBe("media unavailable");
    expect(errors).toHaveBeenCalledWith("media: R2 read failed", "audio/a.mp3", expect.any(Error));
  });

  test("500s, uncached, when a read without a range throws", async () => {
    const b = Object.assign(bucket(), { get: vi.fn().mockRejectedValue(new Error("boom")) });
    const response = await serve(b, "audio/a.mp3", get());
    expect([response.status, response.headers.get("cache-control")]).toEqual([500, "no-store"]);
    expect(b.head).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith("media: R2 read failed", "audio/a.mp3", expect.any(Error));
  });
});

describe("previews of hidden photographs", () => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errors.mockRestore());

  test("previewPhotoId reads the photograph's id from a preview key, and nothing from any other", () => {
    expect(previewPhotoId(PREVIEW)).toBe("post-01");
    expect(previewPhotoId("photos/previews/Abc_x-9-123/sha/1600.webp")).toBe("Abc_x-9-123");
    expect(["audio/a.mp3", "covers/post-01.webp", "photos/previews/not-an-id/sha/240.avif", "photos/previews/", "photos/prints/post-01/x.jpg"].map(previewPhotoId)).toEqual([null, null, null, null, null]);
    expect(photoCacheTag("post-01")).toBe("photo-post-01");
  });

  test("a published photograph's preview is served with a year of immutable caching", async () => {
    const published = vi.fn(async () => true);
    const response = await serveMedia(bucket(), PREVIEW, get(), published);
    expect(published).toHaveBeenCalledWith("post-01");
    expect([response.status, response.headers.get("content-type"), response.headers.get("cache-control")]).toEqual([200, "image/avif", "public, max-age=31536000, immutable"]);
  });

  test("a hidden photograph's preview is a 404, never cached, and R2 isn't read", async () => {
    const b = bucket();
    const response = await serveMedia(b, PREVIEW, get(), async () => false);
    expect([response.status, response.headers.get("cache-control")]).toEqual([404, "no-store"]);
    expect(b.get).not.toHaveBeenCalled();
  });

  test("a preview key without a photograph's id is a 404 without asking", async () => {
    const response = await serveMedia(bucket(), "photos/previews/nope/sha/240.avif", get(), unasked);
    expect([response.status, response.headers.get("cache-control")]).toEqual([404, "no-store"]);
  });

  test("a failed check is a 500, never cached, and says nothing of the key", async () => {
    const response = await serveMedia(bucket(), PREVIEW, get(), async () => { throw new Error("D1 down"); });
    expect([response.status, response.headers.get("cache-control")]).toEqual([500, "no-store"]);
    expect(errors).toHaveBeenCalledWith("media: the preview check failed", "D1 down");
  });

  test("audio, covers and snapshots are served without the check", async () => {
    for (const key of ["audio/a.mp3", "covers/a.webp", "snapshots/s/480.avif"]) expect((await serve(bucket(), key, get())).status).toBe(200);
  });

  test("publishedPreviews follows publication in D1: hidden and unknown photographs say no, and publishing again says yes", async () => {
    const db = sqliteD1();
    await db.prepare("INSERT INTO photos (id, collection, position, title, published, previews, print_key, print_width, print_height, print_bytes, print_sha256) VALUES ('post-01', 'post', 1, '', 1, '[]', 'k', 1, 1, 1, 's')").run();
    const gate = publishedPreviews(db);
    expect(await gate("post-01")).toBe(true);
    await db.prepare("UPDATE photos SET published = 0 WHERE id = 'post-01'").run();
    expect(await gate("post-01")).toBe(false);
    expect(await gate("post-99")).toBe(false);
    await db.prepare("UPDATE photos SET published = 1 WHERE id = 'post-01'").run();
    expect((await serveMedia(bucket(), PREVIEW, get(), gate)).status).toBe(200);
  });
});
