import type { JWTVerifyGetKey } from "jose";
import { accessKeys, verifyAccessJwt, type AccessConfig } from "./access";

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

export const isAdminPath = (pathname: string) => pathname === "/admin" || pathname.startsWith("/admin/");

/** Writes must come from this site: a missing or different Origin header is refused (spec 7) */
export function originAllowed(request: Request, url: URL): boolean {
  if (SAFE_METHODS.includes(request.method)) return true;
  return request.headers.get("origin") === url.origin;
}

/** The admin's email when the request carries a valid Access token for this application; null otherwise, and always null until Access is configured */
export async function adminIdentity(
  request: Request,
  config: AccessConfig,
  keys: (teamDomain: string) => JWTVerifyGetKey = accessKeys,
): Promise<string | null> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || !config.teamDomain || !config.audience) return null;
  return verifyAccessJwt(token, config, keys(config.teamDomain));
}
