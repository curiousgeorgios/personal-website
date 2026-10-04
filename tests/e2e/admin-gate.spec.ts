import { expect, test } from "@playwright/test";

// The test build skips Access (__ADMIN_BYPASS__), so this checks the headers and the origin rule end to end; the
// Access token rules are unit-tested in tests/unit/access.test.ts and gate.test.ts
test.skip(({ browserName }) => browserName !== "chromium", "HTTP behaviour, checked once");
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local test build's Access bypass");

test("the admin page is private: no-store, noindex and the signed-in identity", async ({ page }) => {
  const response = await page.goto("/admin/");
  expect(response?.status()).toBe(200);
  const headers = response!.headers();
  expect(headers["cache-control"]).toBe("no-store");
  // The edge must never cache the admin page: it would be served without the gate
  expect(headers["cloudflare-cdn-cache-control"]).toBe("no-store");
  expect(headers["x-robots-tag"]).toBe("noindex");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await expect(page.locator(".where")).toContainText("signed in as admin-bypass@localhost");
});

test("a write without this site's origin is refused, with the security headers", async ({ baseURL }) => {
  // A body that can't write anything, so a regressed origin check can't touch the seeded store other specs read
  const body = new URLSearchParams({ intent: "nothing-at-all" });
  for (const path of ["/admin/", "/"]) {
    for (const origin of [null, "https://example.com"]) {
      // Node's fetch sends no Origin unless asked, unlike a browser
      const response = await fetch(new URL(path, baseURL), { method: "POST", body, headers: origin ? { Origin: origin } : {} });
      expect(response.status, `${path} with origin ${origin}`).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    }
  }
});

test("a write from this site's origin gets through the gate", async ({ baseURL }) => {
  const response = await fetch(new URL("/admin/", baseURL), {
    method: "POST",
    body: new URLSearchParams({ intent: "nothing-at-all" }),
    headers: { Origin: new URL(baseURL!).origin },
  });
  expect(response.status).not.toBe(403);
  // Not a 500 either: a crash would also pass the line above
  expect(response.status).toBeLessThan(500);
});
