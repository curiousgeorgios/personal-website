import { expect, test } from "@playwright/test";

test.skip(({ browserName }) => browserName !== "chromium", "HTTP behaviour, checked once");

test("streams a seeded track with range support and long caching", async ({ request }) => {
  const full = await request.get("/media/audio/simple-things.mp3");
  expect(full.status()).toBe(200);
  const headers = full.headers();
  expect(headers["content-type"]).toBe("audio/mpeg");
  expect(headers["accept-ranges"]).toBe("bytes");
  expect(headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  const size = Number(headers["content-length"]);
  expect(size).toBeGreaterThan(100_000);
  const part = await request.get("/media/audio/simple-things.mp3", { headers: { Range: "bytes=100-1099" } });
  expect(part.status()).toBe(206);
  expect(part.headers()["content-range"]).toBe(`bytes 100-1099/${size}`);
  expect((await part.body()).length).toBe(1000);
});

test("serves covers as WebP", async ({ request }) => {
  const cover = await request.get("/media/covers/nyc-in-1940.webp");
  expect(cover.status()).toBe(200);
  expect(cover.headers()["content-type"]).toBe("image/webp");
});

test("unknown keys and other prefixes are 404 and never cached", async ({ request }) => {
  for (const path of ["/media/audio/missing.mp3", "/media/secret/simple-things.mp3"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(404);
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
});
