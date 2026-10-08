import { SignJWT, jwtVerify } from "jose";
import { PHOTO_ID } from "./photo-id";

export { PHOTO_ID };

export const DEFAULT_LINK_SECONDS = 7 * 86400;
export const MAX_LINK_SECONDS = 30 * 86400;
export const GRANT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const AUDIENCE = "photo-download";
const ISSUER = "curiousgeorge.dev";
const TYPE = "photo-download+jwt";

export interface PhotoToken {
  grantId: string;
  photoId: string | null;
  expiresAt: number;
}

export function photoSigningKey(secret: string | undefined): Uint8Array {
  if (typeof secret !== "string" || !/^[a-f0-9]{64}$/.test(secret)) throw new Error("PHOTO_LINK_SECRET must be a 32-byte lowercase hex secret");
  return Uint8Array.from(secret.match(/../g)!, (byte) => Number.parseInt(byte, 16));
}

export async function signPhotoToken(secret: string, grant: PhotoToken, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = photoSigningKey(secret);
  if (!GRANT_ID.test(grant.grantId) || (grant.photoId !== null && !PHOTO_ID.test(grant.photoId))) throw new Error("Invalid download grant");
  if (!Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= now || grant.expiresAt > now + MAX_LINK_SECONDS) throw new Error("Invalid link expiry");
  return new SignJWT({ photo_id: grant.photoId })
    .setProtectedHeader({ alg: "HS256", typ: TYPE })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setSubject(grant.grantId)
    .setIssuedAt(now).setExpirationTime(grant.expiresAt).sign(key);
}

export async function verifyPhotoToken(secret: string | undefined, token: string, now = Math.floor(Date.now() / 1000)): Promise<PhotoToken | null> {
  const key = photoSigningKey(secret);
  if (!token || token.length > 2048) return null;
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"], typ: TYPE, issuer: ISSUER, audience: AUDIENCE,
      requiredClaims: ["sub", "iat", "exp", "photo_id"], currentDate: new Date(now * 1000),
    });
    if (typeof payload.sub !== "string" || !GRANT_ID.test(payload.sub)) return null;
    if (payload.photo_id !== null && (typeof payload.photo_id !== "string" || !PHOTO_ID.test(payload.photo_id))) return null;
    if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)) return null;
    if (payload.iat! > now || payload.exp! <= payload.iat! || payload.exp! - payload.iat! > MAX_LINK_SECONDS) return null;
    return { grantId: payload.sub, photoId: payload.photo_id as string | null, expiresAt: payload.exp! };
  } catch {
    return null;
  }
}
