import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { photoAccessDeps } from "../../../../lib/photos/access-env";
import { logoutResponse, sessionResponse, verifyCodeResponse } from "../../../../lib/photos/access-http";

export const GET: APIRoute = ({ request }) => sessionResponse(env.DB, request);
export const POST: APIRoute = ({ request }) => verifyCodeResponse(photoAccessDeps(env), request);
export const DELETE: APIRoute = ({ request }) => logoutResponse(env.DB, request);
