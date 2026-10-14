import { afterEach, describe, expect, test, vi } from "vitest";
import { eventBody, uuidv7 } from "../../src/lib/beacon";

describe("uuidv7", () => {
  test("puts the time first, then the version and variant bits", () => {
    expect(uuidv7(1_700_000_000_000, (count) => new Uint8Array(count))).toBe("018bcfe5-6800-7000-8000-000000000000");
    expect(uuidv7(1_700_000_000_000, (count) => new Uint8Array(count).fill(255))).toBe("018bcfe5-6800-7fff-bfff-ffffffffffff");
  });

  test("is a valid, unique v7 by default", () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidv7()).not.toBe(id);
  });
});

describe("eventBody", () => {
  const visit = {
    href: "https://curiousgeorge.dev/?utm_source=instagram&utm_medium=social&utm_campaign=bio_link&fbclid=x",
    referrer: "https://l.instagram.com/?u=x",
    userAgent: "UA/1",
    timeZone: "Australia/Sydney",
    sessionId: "019a0000-0000-7000-8000-000000000000",
  };
  const now = new Date("2026-10-05T01:02:03.000Z");

  test("a pageview carries the cookieless fields and the visit, and no key", () => {
    expect(eventBody("$pageview", visit, {}, now)).toEqual({
      event: "$pageview",
      distinct_id: "$posthog_cookieless",
      timestamp: "2026-10-05T01:02:03.000Z",
      properties: {
        $current_url: "https://curiousgeorge.dev/?utm_source=instagram&utm_medium=social&utm_campaign=bio_link",
        $host: "curiousgeorge.dev",
        $pathname: "/",
        $referrer: "https://l.instagram.com",
        $referring_domain: "l.instagram.com",
        $raw_user_agent: "UA/1",
        $timezone: "Australia/Sydney",
        $session_id: visit.sessionId,
        $cookieless_mode: true,
        $process_person_profile: false,
        utm_source: "instagram",
        utm_medium: "social",
        utm_campaign: "bio_link",
      },
    });
  });

  test("no referrer, or one that isn't a URL, is a direct visit", () => {
    for (const referrer of ["", "not a url", "about:blank"]) {
      const { properties } = eventBody("$pageview", { ...visit, referrer, href: "https://curiousgeorge.dev/" }, {}, now) as { properties: Record<string, unknown> };
      expect(properties).toMatchObject({ $referrer: "$direct", $referring_domain: "$direct" });
      expect(properties).not.toHaveProperty("utm_source");
    }
  });

  test("the referrer sent is its origin, never its path, query or fragment", () => {
    const sent = (referrer: string) => (eventBody("$pageview", { ...visit, referrer }, {}, now) as { properties: Record<string, unknown> }).properties;
    expect(sent("https://www.google.com/search?q=curious+george&gclid=abc#top")).toMatchObject({
      $referrer: "https://www.google.com",
      $referring_domain: "www.google.com",
    });
    expect(sent("http://localhost:3000/a/b?c=d")).toMatchObject({ $referrer: "http://localhost:3000", $referring_domain: "localhost:3000" });
    expect(sent("android-app://com.google.android.googlequicksearchbox/")).toMatchObject({
      $referrer: "android-app://com.google.android.googlequicksearchbox",
      $referring_domain: "com.google.android.googlequicksearchbox",
    });
  });

  test("the url sent keeps only the origin, the path and the utm parameters", () => {
    const sent = (href: string) => (eventBody("$pageview", { ...visit, href }, {}, now) as { properties: Record<string, unknown> }).properties;
    expect(sent("https://curiousgeorge.dev/?gclid=abc&ref=abc&utm_source=instagram#section")).toMatchObject({
      $current_url: "https://curiousgeorge.dev/?utm_source=instagram",
      $host: "curiousgeorge.dev",
      $pathname: "/",
    });
    expect(sent("https://curiousgeorge.dev/?ref=abc#section").$current_url).toBe("https://curiousgeorge.dev/");
    // In the list's order, whatever order the visitor's link had
    expect(sent("https://curiousgeorge.dev/?utm_medium=social&utm_source=instagram").$current_url).toBe("https://curiousgeorge.dev/?utm_source=instagram&utm_medium=social");
  });

  test("an event's own properties come along", () => {
    expect(eventBody("label_opened", visit, { slug: "canberra-events" }, now)).toMatchObject({ event: "label_opened", properties: { slug: "canberra-events", $session_id: visit.sessionId } });
  });
});

describe("the beacon script", () => {
  const ENDPOINT = "/ingest/i/v0/e/";

  // The script runs when it loads, so each test stubs the browser it finds and imports it fresh. It starts the visit a
  // task after the first frame; `frame` runs that frame and lets the task go, unless the test holds it back
  async function load(sendBeacon?: (url: string, body: string) => boolean, { painted = true } = {}) {
    const beacon = sendBeacon && vi.fn(sendBeacon);
    const fetched = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response(null, { status: 204 })));
    const frames: FrameRequestCallback[] = [];
    const listeners = new Map<string, (event: { detail: unknown }) => void>();
    vi.stubGlobal("navigator", { userAgent: "UA/1", sendBeacon: beacon });
    vi.stubGlobal("location", { href: "https://curiousgeorge.dev/" });
    vi.stubGlobal("document", { referrer: "", addEventListener: vi.fn((name: string, listener: (event: { detail: unknown }) => void) => listeners.set(name, listener)) });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("fetch", fetched);
    vi.resetModules();
    await import("../../src/scripts/beacon");
    const frame = async () => {
      for (const callback of frames.splice(0)) callback(0);
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    if (painted) await frame();
    return { beacon, fetched, frame, track: (detail: unknown) => listeners.get("logbook:track")?.({ detail }) };
  }

  afterEach(() => vi.unstubAllGlobals());

  test("a beacon the browser accepts is all that is sent", async () => {
    const { beacon, fetched } = await load(() => true);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon?.mock.calls[0][0]).toBe(ENDPOINT);
    expect(typeof beacon?.mock.calls[0][1]).toBe("string");
    expect(fetched).not.toHaveBeenCalled();
  });

  test.each([
    ["is missing", undefined],
    ["refuses it", () => false],
  ])("falls back to fetch with the same text body and keepalive when sendBeacon %s", async (_name, sendBeacon) => {
    const { beacon, fetched } = await load(sendBeacon);
    expect(fetched).toHaveBeenCalledTimes(1);
    const [url, init] = fetched.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect(init).toMatchObject({ method: "POST", keepalive: true, headers: { "Content-Type": "text/plain" } });
    expect(typeof init.body).toBe("string");
    expect(JSON.parse(init.body as string)).toMatchObject({ event: "$pageview", distinct_id: "$posthog_cookieless" });
    if (beacon) expect(beacon.mock.calls[0]).toEqual([ENDPOINT, init.body]);
  });

  test("waits for the first frame, so its Intl formatter never holds the first paint, and holds an earlier event until then", async () => {
    const { beacon, frame, track } = await load(() => true, { painted: false });
    track({ event: "label_opened", properties: { slug: "canberra-events" } });
    expect(beacon).not.toHaveBeenCalled();
    await frame();
    expect(beacon?.mock.calls.map(([, body]) => JSON.parse(body).event)).toEqual(["$pageview", "label_opened"]);
    track({ event: "record_played" });
    expect(beacon?.mock.calls.map(([, body]) => JSON.parse(body).event)).toEqual(["$pageview", "label_opened", "record_played"]);
  });
});

