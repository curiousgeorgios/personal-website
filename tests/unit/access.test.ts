import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { verifyAccessJwt } from "../../src/lib/admin/access";

const config = { teamDomain: "team.cloudflareaccess.com", audience: "aud-123" };
let keys: JWTVerifyGetKey;
let accessKey: CryptoKey;
let strangerKey: CryptoKey;
let ecKey: CryptoKey;

interface Claims {
  email?: string | null;
  iss?: string;
  aud?: string;
  exp?: number | string;
  key?: CryptoKey;
  header?: { alg: string; kid: string };
}

// A token shaped like Cloudflare Access's: RS256, kid, iss = https://<team domain>, aud = the application's AUD tag
function sign({ email = "george@example.com", iss = "https://team.cloudflareaccess.com", aud = "aud-123", exp = "1h", key, header = { alg: "RS256", kid: "access-1" } }: Claims = {}) {
  return new SignJWT(email === null ? {} : { email })
    .setProtectedHeader(header)
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key ?? accessKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  accessKey = pair.privateKey;
  // An ES256 key sits in the set too, so a token signed with it is refused for its algorithm and not for an unknown key
  const ec = await generateKeyPair("ES256", { extractable: true });
  ecKey = ec.privateKey;
  keys = createLocalJWKSet({
    keys: [
      { ...(await exportJWK(pair.publicKey)), kid: "access-1", alg: "RS256" },
      { ...(await exportJWK(ec.publicKey)), kid: "access-ec", alg: "ES256" },
    ],
  });
  strangerKey = (await generateKeyPair("RS256")).privateKey;
});

// Refusals are logged (Workers Logs); keep them out of the test output and let each test read them
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifyAccessJwt", () => {
  test("returns the email from a valid token", async () => {
    expect(await verifyAccessJwt(await sign(), config, keys)).toBe("george@example.com");
  });

  test.each([
    ["another application's audience", { aud: "someone-else" }],
    ["another team's issuer", { iss: "https://other.cloudflareaccess.com" }],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 60 }],
    ["no email claim", { email: null }],
    ["an empty email claim", { email: "" }],
  ])("refuses %s", async (_name, claims) => {
    expect(await verifyAccessJwt(await sign(claims as Claims), config, keys)).toBeNull();
  });

  test("refuses a token signed by another key", async () => {
    expect(await verifyAccessJwt(await sign({ key: strangerKey }), config, keys)).toBeNull();
  });

  test("refuses a token signed with another algorithm, even by a key in the set", async () => {
    const token = await sign({ key: ecKey, header: { alg: "ES256", kid: "access-ec" } });
    expect(await verifyAccessJwt(token, config, keys)).toBeNull();
    expect(warn).toHaveBeenCalledWith("admin: access token refused", "ERR_JOSE_ALG_NOT_ALLOWED");
  });

  test("refuses something that isn't a token", async () => {
    expect(await verifyAccessJwt("not.a.token", config, keys)).toBeNull();
  });

  test("logs why a token was refused, with the jose error code and never the token", async () => {
    const token = await sign({ exp: Math.floor(Date.now() / 1000) - 60 });
    expect(await verifyAccessJwt(token, config, keys)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("admin: access token refused", "ERR_JWT_EXPIRED");
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(token.split(".")[1]);
  });

  test("logs nothing for a valid token", async () => {
    await verifyAccessJwt(await sign(), config, keys);
    expect(warn).not.toHaveBeenCalled();
  });
});
