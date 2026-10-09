import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { purgeTags } from "../../../lib/admin/purge";
import { photoError, photoJson, readPhotoJson } from "../../../lib/photos/http";
import { publicationPurges, publishRefusal, setPublished } from "../../../lib/photos/publish";
import { PHOTO_ID } from "../../../lib/photos/tokens";

export const PATCH: APIRoute = async ({ params, request, cache }) => {
  const id = params.id ?? "";
  if (!PHOTO_ID.test(id)) return photoError("Photo unavailable.", 404);
  const parsed = await readPhotoJson(request);
  if ("response" in parsed) return parsed.response;
  const body = parsed.data;
  if (!body || typeof body !== "object" || !("published" in body) || typeof body.published !== "boolean") return photoError("Supply a boolean published value.", 400);
  try {
    const outcome = await setPublished({ db: env.DB, prints: env.PHOTO_PRINTS, media: env.MEDIA }, [id], body.published);
    if ("missing" in outcome) return photoError("Photo unavailable.", 404);
    if ("postless" in outcome) return photoError(publishRefusal(outcome), 409);
    // The home page's photo line depends on whether anything is published, so the logbook goes too (spec 2.2); a hide
    // also purges the photograph's previews
    const cacheInvalidated = await purgeTags(cache, publicationPurges([id], body.published));
    return photoJson({ id, published: body.published, cacheInvalidated }, 200, true);
  } catch { console.error("photos: publication update unavailable"); return photoError("Could not update the photo.", 503); }
};
