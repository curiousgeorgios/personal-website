/**
 * Purges cached pages by tag, so a save shows on the next visit everywhere (spec 6.1): logbook for the home page, photos
 * for the gallery. False when it can't: local runs have no purge, and in production the old page can keep showing for a
 * while (the edge serves it stale as it refreshes).
 */
// Cloudflare purges at most 30 tags per call, and hiding a whole post adds a photo-<id> tag per photograph, so a long
// list goes in batches; one failed batch reports the purge as failed
export const PURGE_BATCH = 30;

export async function purgeTags(cache: { invalidate(options: { tags: string[] }): Promise<unknown> }, tags: string[]): Promise<boolean> {
  try {
    for (let start = 0; start < tags.length; start += PURGE_BATCH) await cache.invalidate({ tags: tags.slice(start, start + PURGE_BATCH) });
    return true;
  } catch (error) {
    // One line: local runs fail this way on every save, and a stack would bury the rest of the log
    console.error(`admin: couldn't purge the cached pages tagged ${tags.join(" and ")}`, error instanceof Error ? error.message : String(error));
    return false;
  }
}
