import { expect, test } from "vitest";
import { readPhotoJson } from "../../src/lib/photos/http";

test("native form submissions are rejected before any address or code is processed", async () => {
  const result = await readPhotoJson(new Request("https://curiousgeorge.dev/api/photos/access/code", { method: "POST", body: new URLSearchParams({ email: "recipient@example.test" }) }));
  expect("response" in result && result.response.status).toBe(415);
});

test("declared oversized JSON is refused without parsing it, while its small body is discarded", async () => {
  const request = new Request("https://curiousgeorge.dev", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "5000" }, body: "{}" });
  const result = await readPhotoJson(request);
  expect("response" in result && result.response.status).toBe(413);
  expect(request.bodyUsed).toBe(true);
});

test("the actual body limit holds with absent or dishonest content lengths", async () => {
  for (const length of [null, "2"]) {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (length) headers.set("Content-Length", length);
    const request = new Request("https://curiousgeorge.dev", { method: "POST", headers, body: JSON.stringify({ email: "x".repeat(5000) }) });
    const result = await readPhotoJson(request);
    expect("response" in result && result.response.status).toBe(413);
  }
});

test("rejected chunked bodies finish without retaining extra bytes or waiting indefinitely", async () => {
  let ended = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(5000)); controller.close(); ended = true; } });
  const request = new Request("https://curiousgeorge.dev", { method: "POST", headers: { "Content-Type": "application/json" }, body, duplex: "half" } as RequestInit);
  const result = await readPhotoJson(request);
  expect("response" in result && result.response.status).toBe(413);
  expect(ended).toBe(true);
  const slow = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(5000)); } });
  const slowRequest = new Request("https://curiousgeorge.dev", { method: "POST", headers: { "Content-Type": "application/json" }, body: slow, duplex: "half" } as RequestInit);
  const started = performance.now();
  const rejected = await readPhotoJson(slowRequest);
  expect("response" in rejected && rejected.response.status).toBe(413);
  expect(performance.now() - started).toBeLessThan(500);
});

test("the parser still accepts bounded JSON and rejects malformed input", async () => {
  for (const [body, status] of [["{", 400], ["{\"code\":\"012345\"}", 200]] as const) {
    const result = await readPhotoJson(new Request("https://curiousgeorge.dev", { method: "POST", headers: { "Content-Type": "application/json" }, body }));
    expect("response" in result ? result.response.status : 200).toBe(status);
  }
});
