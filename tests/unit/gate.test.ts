import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { adminIdentity, isAdminPath, originAllowed } from "../../src/lib/admin/gate";

const config = { teamDomain: "team.cloudflareaccess.com", audience: "aud-123" };
let keys: JWTVerifyGetKey;
let token: string;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k", alg: "RS256" }] });
  token = await new SignJWT({ email: "george@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "k" })
    .setIssuer("https://team.cloudflareaccess.com")
    .setAudience("aud-123")
    .setExpirationTime("1h")
    .sign(pair.privateKey);
});

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const url = new URL("https://curiousgeorge.dev/admin/");
const request = (method: string, headers: Record<string, string> = {}) => new Request(url, { method, headers });

describe("isAdminPath", () => {
  test("matches /admin and everything under it, nothing else", () => {
    expect(["/admin", "/admin/", "/admin/anything"].every(isAdminPath)).toBe(true);
    expect(["/", "/administrator", "/media/admin", "/admin-old"].some(isAdminPath)).toBe(false);
  });
});

describe("originAllowed", () => {
  test("reads are always allowed", () => {
    expect(["GET", "HEAD", "OPTIONS"].every((method) => originAllowed(request(method), url))).toBe(true);
  });

  test("writes need this site's exact origin", () => {
    expect(originAllowed(request("POST", { Origin: "https://curiousgeorge.dev" }), url)).toBe(true);
    expect(originAllowed(request("POST"), url)).toBe(false);
    expect(originAllowed(request("POST", { Origin: "https://example.com" }), url)).toBe(false);
    expect(originAllowed(request("POST", { Origin: "http://curiousgeorge.dev" }), url)).toBe(false);
    expect(originAllowed(request("DELETE", { Origin: "null" }), url)).toBe(false);
  });
});

describe("adminIdentity", () => {
  test("returns the email for a valid Access token, fetching keys for the configured team", async () => {
    const keyFor = vi.fn(() => keys);
    expect(await adminIdentity(request("GET", { "Cf-Access-Jwt-Assertion": token }), config, keyFor)).toBe("george@example.com");
    expect(keyFor).toHaveBeenCalledWith("team.cloudflareaccess.com");
  });

  test("refuses a request without a token", async () => {
    expect(await adminIdentity(request("GET"), config, () => keys)).toBeNull();
  });

  test("refuses, rather than throws, when the team domain isn't a valid host", async () => {
    // Uses the real key set builder: new URL rejects the host, which must end as a refusal and not a 500
    const headers = { "Cf-Access-Jwt-Assertion": token };
    expect(await adminIdentity(request("GET", headers), { teamDomain: "not a host", audience: "aud-123" })).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toBe("admin: access token refused");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
  });

  test("fails closed until the team domain and audience are set", async () => {
    const keyFor = vi.fn(() => keys);
    const headers = { "Cf-Access-Jwt-Assertion": token };
    expect(await adminIdentity(request("GET", headers), { teamDomain: "", audience: "aud-123" }, keyFor)).toBeNull();
    expect(await adminIdentity(request("GET", headers), { teamDomain: "team.cloudflareaccess.com", audience: "" }, keyFor)).toBeNull();
    expect(keyFor).not.toHaveBeenCalled();
  });
});
