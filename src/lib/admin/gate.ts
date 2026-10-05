import type { JWTVerifyGetKey } from "jose";
import { accessKeys, logRefusal, verifyAccessJwt, type AccessConfig, type AccessIdentity } from "./access";

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

export const isAdminPath = (pathname: string) => pathname === "/admin" || pathname.startsWith("/admin/");

/** Writes must come from this site: a missing or different Origin header is refused (spec 7) */
export function originAllowed(request: Request, url: URL): boolean {
  if (SAFE_METHODS.includes(request.method)) return true;
  return request.headers.get("origin") === url.origin;
}

export interface AdminConfig extends AccessConfig {
  /** The one address let in (ADR-0016). Empty refuses everyone, as an unset team domain or audience does */
  adminEmail: string;
}

// ASCII-only lowercase: toLowerCase also folds the Kelvin sign (U+212A) to "k"
const address = (email: string) => email.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/**
 * The admin's identity when the request carries a valid Access token for this application that names ADMIN_EMAIL;
 * null otherwise, and always null until Access and the address are configured. The Access policy decides who may sign
 * in, this decides who may edit, so a policy loosened by mistake doesn't open /admin (ADR-0016).
 */
export async function adminIdentity(
  request: Request,
  config: AdminConfig,
  keys: (teamDomain: string) => JWTVerifyGetKey = accessKeys,
): Promise<AccessIdentity | null> {
  const token = request.headers.get("cf-access-jwt-assertion");
  // typeof because an ADMIN_EMAIL missing from wrangler.jsonc arrives as undefined, and a number or object in vars would
  // make .trim throw (a 500 without the admin headers), whatever the type says
  if (!token || !config.teamDomain || !config.audience || typeof config.adminEmail !== "string" || !config.adminEmail.trim()) return null;
  let keySet: JWTVerifyGetKey;
  try {
    keySet = keys(config.teamDomain);
  } catch (error) {
    // A team domain that isn't a valid host is a refusal, not a 500 without the admin headers
    logRefusal(error);
    return null;
  }
  const identity = await verifyAccessJwt(token, config, keySet);
  if (!identity) return null;
  if (address(identity.email) !== address(config.adminEmail)) {
    // A valid token for someone else: the Access policy let in more than George. Logged without the address
    console.warn("admin: access token refused", "not the admin's email");
    return null;
  }
  return identity;
}
