import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { downloadPhoto } from "../../../lib/photos/download";

export const GET: APIRoute = ({ params, request }) => downloadPhoto(env.DB, env.PHOTO_PRINTS, env.PHOTO_LINK_SECRET, params.id ?? "", request);
export const HEAD = GET;
