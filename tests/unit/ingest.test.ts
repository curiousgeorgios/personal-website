import { afterEach, expect, test, vi } from "vitest";
import { forwardEvent, INGEST_LIMIT } from "../../src/lib/ingest";

const config = { key: "phc_test", host: "https://us.i.posthog.com", country: "AU" };
const pageview = {
  event: "$pageview",
  distinct_id: "$posthog_cookieless",
  timestamp: "2026-10-05T01:02:03.000Z",
  properties: { $current_url: "https://curiousgeorge.dev/", $session_id: "s1", $cookieless_mode: true, $process_person_profile: false },
};
const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://curiousgeorge.dev/ingest/i/v0/e/", { method: "POST", body, headers: { "Content-Type": "text/plain", ...headers } });
const ok = () => vi.fn(async () => new Response("{}", { status: 200, headers: { "Set-Cookie": "ph_session=1" } }));
const sent = (upstream: ReturnType<typeof ok>) => upstream.mock.calls[0] as unknown as [string, RequestInit];

afterEach(() => vi.restoreAllMocks());

test("forwards a pageview with the key, the country and the visitor's IP, and never a cookie either way", async () => {
  const upstream = ok();
  const response = await forwardEvent(
    post(JSON.stringify(pageview), { Cookie: "CF_Authorization=secret", "CF-Connecting-IP": "203.0.113.7", "User-Agent": "UA/1" }),
    config,
    upstream,
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
    timestamp: "2026-10-05T01:02:03.000Z",
    properties: { ...pageview.properties, $geoip_country_code: "AU" },
  });
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
