import type { APIRoute } from "astro";

export const GET: APIRoute = () =>
  new Response(null, {
    status: 302,
    headers: { Location: "/?utm_source=instagram&utm_medium=social&utm_campaign=bio_link", "Cache-Control": "no-store" },
  });
