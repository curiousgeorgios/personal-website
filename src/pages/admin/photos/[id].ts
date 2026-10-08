import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { photoError, photoJson, readPhotoJson } from "../../../lib/photos/http";
import { PHOTO_ID } from "../../../lib/photos/tokens";
import { PREVIEW_COUNT, type Preview, type PhotoRow } from "../../../lib/photos/store";

export const PATCH: APIRoute = async ({ params, request, cache }) => {
  const id = params.id ?? "";
  if (!PHOTO_ID.test(id)) return photoError("Photo unavailable.", 404);
  const parsed = await readPhotoJson(request);
  if ("response" in parsed) return parsed.response;
  const body = parsed.data;
  if (!body || typeof body !== "object" || !("published" in body) || typeof body.published !== "boolean") return photoError("Supply a boolean published value.", 400);
  try {
    const row = await env.DB.prepare("SELECT * FROM photos WHERE id = ?").bind(id).first<PhotoRow>();
    if (!row) return photoError("Photo unavailable.", 404);
    if (body.published) {
      const object = await env.PHOTO_PRINTS.head(row.print_key);
      if (!object || object.size !== row.print_bytes || object.httpMetadata?.contentType !== "image/jpeg" || object.customMetadata?.sha256 !== row.print_sha256) return photoError("Verified print master unavailable.", 409);
      const previews = JSON.parse(row.previews) as Preview[];
      if (previews.length !== PREVIEW_COUNT) return photoError("Responsive previews unavailable.", 409);
      for (const preview of previews) {
        if (!preview.key.startsWith("photos/previews/") || !["avif", "webp"].includes(preview.format)) return photoError("Invalid preview.", 409);
        const stored = await env.MEDIA.head(preview.key);
        if (!stored || stored.httpMetadata?.contentType !== `image/${preview.format}`) return photoError("Responsive previews unavailable.", 409);
      }
    }
    await env.DB.prepare("UPDATE photos SET published = ? WHERE id = ?").bind(body.published ? 1 : 0, id).run();
    let cacheInvalidated = true;
    try { await cache.invalidate({ tags: ["photos"] }); } catch { cacheInvalidated = false; }
    return photoJson({ id, published: body.published, cacheInvalidated }, 200, true);
  } catch { console.error("photos: publication update unavailable"); return photoError("Could not update the photo.", 503); }
};
