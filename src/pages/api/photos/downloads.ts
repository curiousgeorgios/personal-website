import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { pageOptions, photoError, photoJson } from "../../../lib/photos/http";
import { photoPage } from "../../../lib/photos/store";
import { photoSession } from "../../../lib/photos/access";

export const GET: APIRoute = async ({ request, url }) => {
  const options = pageOptions(url);
  if (!options) return photoError("Invalid catalogue query.", 400);
  try {
    const session = await photoSession(env.DB, request);
    if (!session) return photoError("Sign in with an approved email address to download photos.", 403);
    const page = await photoPage(env.DB, options.after, options.limit, options.collection);
    return photoJson({ ...page, expiresAt: session.expiresAt, photos: page.photos.map((photo) => ({ ...photo, downloadUrl: `/photos/downloads/${photo.id}` })) }, 200, true);
  } catch { console.error("photos: links unavailable"); return photoError("Downloads are temporarily unavailable.", 503); }
};
