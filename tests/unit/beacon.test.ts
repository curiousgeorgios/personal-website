import { describe, expect, test } from "vitest";
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
        $referrer: "https://l.instagram.com/?u=x",
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
    for (const referrer of ["", "not a url"]) {
      const { properties } = eventBody("$pageview", { ...visit, referrer, href: "https://curiousgeorge.dev/" }, {}, now) as { properties: Record<string, unknown> };
      expect(properties).toMatchObject({ $referrer: "$direct", $referring_domain: "$direct" });
      expect(properties).not.toHaveProperty("utm_source");
    }
  });

  test("an event's own properties come along", () => {
    expect(eventBody("label_opened", visit, { slug: "canberra-events" }, now)).toMatchObject({ event: "label_opened", properties: { slug: "canberra-events", $session_id: visit.sessionId } });
  });
});
