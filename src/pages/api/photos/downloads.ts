import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { pageOptions, photoError, photoJson, requestToken } from "../../../lib/photos/http";
import { grantIsActive, photoPage } from "../../../lib/photos/store";
import { verifyPhotoToken } from "../../../lib/photos/tokens";

export const GET: APIRoute = async ({ request, url }) => {
  const options = pageOptions(url);
  if (!options) return photoError("Invalid catalogue query.", 400);
  try {
    const tokenText = requestToken(request);
    const token = await verifyPhotoToken(env.PHOTO_LINK_SECRET, tokenText);
    if (!token || token.photoId !== null || !await grantIsActive(env.DB, token, Math.floor(Date.now() / 1000))) return photoError("This download link is invalid or expired.", 403);
    const page = await photoPage(env.DB, options.after, options.limit, options.collection);
    return photoJson({ ...page, expiresAt: token.expiresAt, photos: page.photos.map((photo) => ({ ...photo, downloadUrl: `/photos/downloads/${photo.id}?token=${encodeURIComponent(tokenText)}` })) }, 200, true);
  } catch { console.error("photos: links unavailable"); return photoError("Downloads are temporarily unavailable.", 503); }
};
