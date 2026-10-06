import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { serveMedia } from "../../lib/media";

export const GET: APIRoute = ({ params, request }) => serveMedia(env.MEDIA, params.key ?? "", request);
