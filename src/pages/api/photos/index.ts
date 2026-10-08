import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { entryOptions, pageOptions, photoJson } from "../../../lib/photos/http";
import { entryPage, photoPage } from "../../../lib/photos/store";

export const GET: APIRoute = async ({ url, cache }) => {
  // The entry mode (spec 3.6): a page of posts, each with its published photographs and only the gallery's previews
  if (url.searchParams.has("by")) {
    const options = entryOptions(url);
    if (!options) return photoJson({ error: "Invalid catalogue query." }, 400);
    try {
      const page = await entryPage(env.DB, options.before, options.limit);
      cache.set({ maxAge: 60, swr: 300, tags: ["photos"] });
      return photoJson({ entries: page.entries.map(({ collection, date, place, photos }) => ({ collection, date, place, photos })), next: page.next });
    } catch { console.error("photos: catalogue unavailable"); return photoJson({ error: "Catalogue temporarily unavailable." }, 503); }
  }
  const options = pageOptions(url);
  if (!options || [...url.searchParams.keys()].some((key) => !["after", "limit", "collection"].includes(key))) return photoJson({ error: "Invalid catalogue query." }, 400);
  try {
    const page = await photoPage(env.DB, options.after, options.limit, options.collection);
    cache.set({ maxAge: 60, swr: 300, tags: ["photos"] });
    return photoJson(page);
  }
  catch { console.error("photos: catalogue unavailable"); return photoJson({ error: "Catalogue temporarily unavailable." }, 503); }
};
