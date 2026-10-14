import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { photoAccessDeps } from "../../../../lib/photos/access-env";
import { requestCodeResponse } from "../../../../lib/photos/access-http";

export const POST: APIRoute = ({ request }) => requestCodeResponse(photoAccessDeps(env), request);
