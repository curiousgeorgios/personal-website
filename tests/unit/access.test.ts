import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, test } from "vitest";
import { verifyAccessJwt } from "../../src/lib/admin/access";

const config = { teamDomain: "team.cloudflareaccess.com", audience: "aud-123" };
let keys: JWTVerifyGetKey;
let accessKey: CryptoKey;
let strangerKey: CryptoKey;

interface Claims {
  email?: string | null;
  iss?: string;
  aud?: string;
  exp?: number | string;
  key?: CryptoKey;
}

// A token shaped like Cloudflare Access's: RS256, kid, iss = https://<team domain>, aud = the application's AUD tag
function sign({ email = "george@example.com", iss = "https://team.cloudflareaccess.com", aud = "aud-123", exp = "1h", key }: Claims = {}) {
  return new SignJWT(email === null ? {} : { email })
    .setProtectedHeader({ alg: "RS256", kid: "access-1" })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key ?? accessKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  accessKey = pair.privateKey;
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "access-1", alg: "RS256" }] });
  strangerKey = (await generateKeyPair("RS256")).privateKey;
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
  ])("refuses %s", async (_name, claims) => {
    expect(await verifyAccessJwt(await sign(claims as Claims), config, keys)).toBeNull();
  });

  test("refuses a token signed by another key", async () => {
    expect(await verifyAccessJwt(await sign({ key: strangerKey }), config, keys)).toBeNull();
  });

  test("refuses something that isn't a token", async () => {
    expect(await verifyAccessJwt("not.a.token", config, keys)).toBeNull();
  });
});
