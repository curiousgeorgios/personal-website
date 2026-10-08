import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { photoError, photoJson, readPhotoJson } from "../../../lib/photos/http";
import { insertGrant, revokeGrant } from "../../../lib/photos/store";
import { DEFAULT_LINK_SECONDS, MAX_LINK_SECONDS, signPhotoToken } from "../../../lib/photos/tokens";

export const POST: APIRoute = async ({ request, url }) => {
  const parsed = await readPhotoJson(request);
  if ("response" in parsed) return parsed.response;
  const data = parsed.data as { photoId?: unknown; expiresInSeconds?: unknown };
  if (!data || typeof data !== "object" || Array.isArray(data)) return photoError("Invalid request.", 400);
  // People only ever get catalogue links (ADR-0020 as amended); photo-scoped grants are made inside print orders
  if (data.photoId !== undefined && data.photoId !== null) return photoError("photo links are internal", 400);
  const duration = data.expiresInSeconds ?? DEFAULT_LINK_SECONDS;
  if (!Number.isSafeInteger(duration) || Number(duration) < 60 || Number(duration) > MAX_LINK_SECONDS) return photoError("Invalid expiry (60 seconds to 30 days).", 400);
  try {
    const grant = { grantId: crypto.randomUUID(), photoId: null, expiresAt: Math.floor(Date.now() / 1000) + Number(duration) };
    const token = await signPhotoToken(env.PHOTO_LINK_SECRET ?? "", grant);
    await insertGrant(env.DB, grant);
    // The page, not the JSON route, which stays for scripts (spec 2.2)
    return photoJson({ grantId: grant.grantId, expiresAt: grant.expiresAt, url: `${url.origin}/photos/downloads?token=${encodeURIComponent(token)}` }, 201, true);
  } catch { console.error("photos: could not issue link"); return photoError("Could not issue a download link.", 503); }
};

export const DELETE: APIRoute = async ({ url }) => {
  const id = url.searchParams.get("grantId") ?? "";
  try { return await revokeGrant(env.DB, id) ? photoJson({ revoked: true }, 200, true) : photoError("Link unavailable or already revoked.", 404); }
  catch { console.error("photos: could not revoke link"); return photoError("Could not revoke the link.", 503); }
};
