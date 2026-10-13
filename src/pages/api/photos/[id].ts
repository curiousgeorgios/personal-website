import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { photoJson } from "../../../lib/photos/http";
import { photoById, publicPhoto } from "../../../lib/photos/store";

export const GET: APIRoute = async ({ params, url, cache }) => {
  if (url.search) return photoJson({ error: "Invalid photo query." }, 400);
  try {
    const photo = await photoById(env.DB, params.id ?? "");
    if (!photo) return photoJson({ error: "Photo unavailable." }, 404);
    cache.set({ maxAge: 60, swr: 300, tags: ["photos"] });
    return photoJson(publicPhoto(photo));
  } catch { console.error("photos: catalogue unavailable"); return photoJson({ error: "Catalogue temporarily unavailable." }, 503); }
};
