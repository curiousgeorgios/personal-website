import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { photoCacheTag, previewPhotoId, publishedPreviews, serveMedia } from "../../lib/media";

export const GET: APIRoute = async ({ params, request, cache }) => {
  const key = params.key ?? "";
  const response = await serveMedia(env.MEDIA, key, request, publishedPreviews(env.DB));
  // A published photograph's previews keep their year of caching, and carry its own tag so hiding it can purge them
  // from the edge (spec 6.2). Refusals are no-store and carry no tag.
  const photoId = previewPhotoId(key);
  if (photoId && response.status < 400) cache.set({ maxAge: 31536000, tags: [photoCacheTag(photoId)] });
  return response;
};
