import { photoSession } from "./access";
import type { DownloadsView } from "./gallery";
import { allEntries } from "./store";

export async function photoDownloadsView(db: D1Database, request: Request, now = Math.floor(Date.now() / 1000)): Promise<DownloadsView> {
  try {
    const session = await photoSession(db, request, now);
    return session ? { state: "ok", entries: await allEntries(db, [240]), expiresAt: session.expiresAt } : { state: "signin" };
  } catch {
    console.error("photos: the downloads page is unavailable");
    return { state: "down" };
  }
}
