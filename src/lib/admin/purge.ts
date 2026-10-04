/**
 * Purges the cached home page, so a save shows on the next visit everywhere (spec 6.1). False when it can't: local
 * runs have no purge, and in production the page still refreshes within its five-minute freshness window.
 */
export async function purgeLogbook(cache: { invalidate(options: { tags: string[] }): Promise<unknown> }): Promise<boolean> {
  try {
    await cache.invalidate({ tags: ["logbook"] });
    return true;
  } catch (error) {
    // One line: local runs fail this way on every save, and a stack would bury the rest of the log
    console.error("admin: couldn't purge the cached home page", error instanceof Error ? error.message : String(error));
    return false;
  }
}
