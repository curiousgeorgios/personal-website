import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { formatLogDate } from "../text";
import { sydneyDate } from "../time";

export interface AccessConfig {
  /** The Access team domain, e.g. curiousgeorge.cloudflareaccess.com */
  teamDomain: string;
  /** The Access application's audience (AUD) tag */
  audience: string;
}

/** Who a valid Access token says is signed in, and until when */
export interface AccessIdentity {
  email: string;
  /** When the Access session ends: the token's exp, in seconds since 1970; null for a token without one */
  expires: number | null;
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

/** Workers Logs line for a refused admin request: the jose error code (or the error's name), never the token */
export function logRefusal(error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  const reason = typeof code === "string" ? code : error instanceof Error ? error.name : "unknown";
  console.warn("admin: access token refused", reason);
}

/** The signed-in identity from a Cloudflare Access JWT, or null unless signature, audience, issuer and expiry all check out */
export async function verifyAccessJwt(token: string, config: AccessConfig, keys: JWTVerifyGetKey): Promise<AccessIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: `https://${config.teamDomain}`, audience: config.audience, algorithms: ["RS256"] });
    if (typeof payload.email !== "string" || payload.email === "") return null;
    return { email: payload.email, expires: typeof payload.exp === "number" ? payload.exp : null };
  } catch (error) {
    logRefusal(error);
    return null;
  }
}

/** The day an Access session ends, as /admin shows it: Sydney's date in the log's day format (05.11.26) */
export const sessionEnds = (expires: number): string => formatLogDate(sydneyDate(new Date(expires * 1000)), "day");
