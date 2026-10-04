import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AccessConfig {
  /** The Access team domain, e.g. curiousgeorge.cloudflareaccess.com */
  teamDomain: string;
  /** The Access application's audience (AUD) tag */
  audience: string;
}

const keySets = new Map<string, JWTVerifyGetKey>();

/** Access's signing keys for a team, fetched once per isolate (jose refetches when they rotate) */
export function accessKeys(teamDomain: string): JWTVerifyGetKey {
  let keys = keySets.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    keySets.set(teamDomain, keys);
  }
  return keys;
}

/** The signed-in email from a Cloudflare Access JWT, or null unless signature, audience, issuer and expiry all check out */
export async function verifyAccessJwt(token: string, config: AccessConfig, keys: JWTVerifyGetKey): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: `https://${config.teamDomain}`, audience: config.audience, algorithms: ["RS256"] });
    return typeof payload.email === "string" && payload.email !== "" ? payload.email : null;
  } catch {
    return null;
  }
}
