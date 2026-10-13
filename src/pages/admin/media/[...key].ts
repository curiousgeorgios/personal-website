import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { serveMedia } from "../../../lib/media";

// The admin's thumbnails, hidden photographs' included, which the public /media refuses (spec 6.2). Behind the admin
// gate like the rest of /admin, and never cached there (the middleware sets no-store and drops any cache tag).
export const GET: APIRoute = ({ params, request }) => {
  const key = params.key ?? "";
  if (!key.startsWith("photos/previews/")) return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  return serveMedia(env.MEDIA, key, request, async () => true);
};
