import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { pageOptions, photoJson } from "../../../lib/photos/http";
import { photoPage } from "../../../lib/photos/store";

export const GET: APIRoute = async ({ url, cache }) => {
  const options = pageOptions(url);
  if (!options || [...url.searchParams.keys()].some((key) => !["after", "limit", "collection"].includes(key))) return photoJson({ error: "Invalid catalogue query." }, 400);
  try {
    const page = await photoPage(env.DB, options.after, options.limit, options.collection);
    cache.set({ maxAge: 60, swr: 300, tags: ["photos"] });
    return photoJson(page);
  }
  catch { console.error("photos: catalogue unavailable"); return photoJson({ error: "Catalogue temporarily unavailable." }, 503); }
};
