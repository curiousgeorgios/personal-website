import { afterEach, expect, test, vi } from "vitest";
import { forwardEvent, INGEST_LIMIT } from "../../src/lib/ingest";

const config = { key: "phc_test", host: "https://us.i.posthog.com", country: "AU" };
const pageview = {
  event: "$pageview",
  distinct_id: "$posthog_cookieless",
  timestamp: "2026-10-05T01:02:03.000Z",
  properties: { $current_url: "https://curiousgeorge.dev/", $session_id: "s1", $cookieless_mode: true, $process_person_profile: false },
};
// The server's clock, deliberately a different time from the visitor's (the pageview's timestamp)
const serverNow = () => new Date("2026-10-05T04:05:06.000Z");
const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://curiousgeorge.dev/ingest/i/v0/e/", { method: "POST", body, headers: { "Content-Type": "text/plain", ...headers } });
const ok = () => vi.fn(async () => new Response("{}", { status: 200, headers: { "Set-Cookie": "ph_session=1" } }));
const sent = (upstream: ReturnType<typeof ok>) => upstream.mock.calls[0] as unknown as [string, RequestInit];

afterEach(() => vi.restoreAllMocks());

test("forwards a pageview with the key, the country and the visitor's IP, stamped with the server's time, and never a cookie either way", async () => {
  const upstream = ok();
  const response = await forwardEvent(
    post(JSON.stringify(pageview), { Cookie: "CF_Authorization=secret", "CF-Connecting-IP": "203.0.113.7", "User-Agent": "UA/1" }),
    config,
    upstream,
    serverNow,
  );
  expect(response.status).toBe(204);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(upstream).toHaveBeenCalledOnce();
  const [url, init] = sent(upstream);
  expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
  const headers = new Headers(init.headers);
  expect(headers.get("cookie")).toBeNull();
  expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
  expect(headers.get("user-agent")).toBe("UA/1");
  expect(JSON.parse(init.body as string)).toEqual({
    api_key: "phc_test",
    event: "$pageview",
    distinct_id: "$posthog_cookieless",
    timestamp: "2026-10-05T04:05:06.000Z",
    properties: { ...pageview.properties, $geoip_country_code: "AU" },
  });
  expect(init.signal).toBeInstanceOf(AbortSignal);
});

test("the cookieless fields are set here, whatever the page sent, and a sent IP is dropped", async () => {
  const upstream = ok();
  const event = { event: "label_opened", distinct_id: "someone", properties: { slug: "canberra-events", $cookieless_mode: false, $process_person_profile: true, $ip: "1.2.3.4" } };
  await forwardEvent(post(JSON.stringify(event)), config, upstream);
  const body = JSON.parse(sent(upstream)[1].body as string);
  expect(body.distinct_id).toBe("$posthog_cookieless");
  expect(body.properties).toEqual({ slug: "canberra-events", $cookieless_mode: true, $process_person_profile: false, $geoip_country_code: "AU" });
});

test.each([
  ["an event the logbook doesn't send", JSON.stringify({ event: "$identify", properties: {} })],
  ["no event", JSON.stringify({ properties: {} })],
  ["properties that aren't an object", JSON.stringify({ event: "$pageview", properties: [1] })],
  ["something that isn't JSON", "event=$pageview"],
])("refuses %s without forwarding it", async (_name, body) => {
  const upstream = ok();
  expect((await forwardEvent(post(body), config, upstream)).status).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
});

test("refuses a body over 32KB, counted as it arrives", async () => {
  const upstream = ok();
  const big = JSON.stringify({ event: "$pageview", properties: { pad: "x".repeat(INGEST_LIMIT) } });
  expect((await forwardEvent(post(big), config, upstream)).status).toBe(413);
  expect(upstream).not.toHaveBeenCalled();
});

test("drops events quietly when no key is set (local and test runs)", async () => {
  const upstream = ok();
  expect((await forwardEvent(post(JSON.stringify(pageview)), { ...config, key: undefined }, upstream)).status).toBe(204);
  expect(upstream).not.toHaveBeenCalled();
});

test("a PostHog failure is logged and the beacon still gets a 204", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const offline = vi.fn(async () => {
    throw new Error("offline");
  });
  expect((await forwardEvent(post(JSON.stringify(pageview)), config, offline)).status).toBe(204);
  expect((await forwardEvent(post(JSON.stringify(pageview)), config, vi.fn(async () => new Response("no", { status: 500 })))).status).toBe(204);
  expect(error).toHaveBeenCalledTimes(2);
});

test("without a country, no country property is sent", async () => {
  const upstream = ok();
  await forwardEvent(post(JSON.stringify(pageview)), { ...config, country: null }, upstream);
  expect(JSON.parse(sent(upstream)[1].body as string).properties).not.toHaveProperty("$geoip_country_code");
});

// A stream body has no length up front, which is how a chunked sendBeacon arrives; Node wants duplex set for one
const streamed = (stream: ReadableStream<Uint8Array>) =>
  new Request("https://curiousgeorge.dev/ingest/i/v0/e/", { method: "POST", body: stream, duplex: "half" } as RequestInit);

test("a body that fails to read (a client that aborts mid-beacon) is a 400, not a crash", async () => {
  const upstream = ok();
  const aborted = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"event":"$pagev'));
    },
    pull(controller) {
      controller.error(new Error("client aborted"));
    },
  });
  const response = await forwardEvent(streamed(aborted), config, upstream);
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(upstream).not.toHaveBeenCalled();
});

test("refuses a body of many small chunks with no length once it passes 32KB, and stops reading", async () => {
  const upstream = ok();
  let pulled = 0;
  const many = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (++pulled > 200) return controller.close();
      controller.enqueue(new Uint8Array(200).fill(120));
    },
  });
  expect((await forwardEvent(streamed(many), config, upstream)).status).toBe(413);
  expect(upstream).not.toHaveBeenCalled();
  expect(pulled).toBeLessThan(200);
});

test("accepts a body of exactly 32KB and refuses one byte more", async () => {
  const upstream = ok();
  const sized = (bytes: number) => {
    const overhead = JSON.stringify({ event: "$pageview", properties: { slug: "" } }).length;
    return JSON.stringify({ event: "$pageview", properties: { slug: "x".repeat(bytes - overhead) } });
  };
  const exact = sized(INGEST_LIMIT);
  expect(new TextEncoder().encode(exact).byteLength).toBe(INGEST_LIMIT);
  expect((await forwardEvent(post(exact), config, upstream)).status).toBe(204);
  expect(upstream).toHaveBeenCalledOnce();
  const over = upstream.mock.calls.length;
  expect((await forwardEvent(post(sized(INGEST_LIMIT + 1)), config, upstream)).status).toBe(413);
  expect(upstream).toHaveBeenCalledTimes(over);
});

test("only the beacon's own properties go on; anything else the page sent is dropped", async () => {
  const upstream = ok();
  const sentProperties = {
    $current_url: "https://curiousgeorge.dev/",
    $host: "curiousgeorge.dev",
    $pathname: "/",
    $referrer: "https://example.com/",
    $referring_domain: "example.com",
    $raw_user_agent: "UA/1",
    $timezone: "Australia/Sydney",
    $session_id: "s1",
    utm_source: "a",
    utm_medium: "b",
    utm_campaign: "c",
    utm_term: "d",
    utm_content: "e",
    slug: "canberra-events",
    record_id: "r1",
  };
  await forwardEvent(post(JSON.stringify({ event: "record_played", properties: { ...sentProperties, $set: { email: "a@b.c" }, token: "t", junk: 1, $ip: "1.2.3.4" } })), config, upstream);
  expect(JSON.parse(sent(upstream)[1].body as string).properties).toEqual({
    ...sentProperties,
    $cookieless_mode: true,
    $process_person_profile: false,
    $geoip_country_code: "AU",
  });
});

test("a country the page sent never passes, even when ours is unknown", async () => {
  const upstream = ok();
  const event = { event: "$pageview", properties: { $geoip_country_code: "ZZ" } };
  await forwardEvent(post(JSON.stringify(event)), { ...config, country: null }, upstream);
  expect(JSON.parse(sent(upstream)[1].body as string).properties).toEqual({ $cookieless_mode: true, $process_person_profile: false });
  await forwardEvent(post(JSON.stringify(event)), config, upstream);
  expect(JSON.parse((upstream.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).properties.$geoip_country_code).toBe("AU");
});

test("the visitor's clock never reaches PostHog, and PostHog's reply is cancelled unread", async () => {
  const reply = new Response("{}", { status: 200 });
  const upstream = vi.fn(async () => reply);
  await forwardEvent(post(JSON.stringify({ ...pageview, timestamp: "1999-01-01T00:00:00.000Z" })), config, upstream as unknown as typeof fetch, serverNow);
  expect(JSON.parse((upstream.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).timestamp).toBe("2026-10-05T04:05:06.000Z");
  expect(reply.bodyUsed).toBe(true);
});

test("an event from the downloads page is refused and never forwarded", async () => {
  const upstream = ok();
  for (const pathname of ["/photos/downloads", "/photos/downloads/fixture-01"]) {
    const body = JSON.stringify({ ...pageview, properties: { ...pageview.properties, $pathname: pathname } });
    expect((await forwardEvent(post(body), config, upstream, serverNow)).status).toBe(400);
  }
  expect(upstream).not.toHaveBeenCalled();
  const gallery = JSON.stringify({ ...pageview, properties: { ...pageview.properties, $pathname: "/photos" } });
  expect((await forwardEvent(post(gallery), config, upstream, serverNow)).status).toBe(204);
});
