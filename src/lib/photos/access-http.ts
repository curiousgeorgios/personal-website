import { CHALLENGE_COOKIE, CODE_SECONDS, RESEND_SECONDS, SESSION_COOKIE, SESSION_SECONDS, logoutPhotoSession, normaliseEmail, photoCookie, photoSession, requestPhotoCode, verifyPhotoCode, type PhotoAccessDeps } from "./access";
import { PRIVATE_HEADERS, photoError, photoJson, readPhotoJson } from "./http";

const sameOrigin = (request: Request) => request.headers.get("origin") === new URL(request.url).origin;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export async function requestCodeResponse(deps: PhotoAccessDeps, request: Request): Promise<Response> {
  if (!sameOrigin(request)) return photoError("Cross-site requests are not allowed.", 403);
  const parsed = await readPhotoJson(request);
  if ("response" in parsed) return parsed.response;
  const email = object(parsed.data) ? normaliseEmail(parsed.data.email) : null;
  if (!email) return photoError("Enter a valid email address.", 400);
  try {
    const result = await requestPhotoCode(deps, email, deps.client?.(request) ?? request.headers.get("cf-connecting-ip") ?? "unknown");
    if (result.state === "limited") {
      const response = photoError("Too many code requests. Try again later.", 429);
      response.headers.set("Retry-After", String(result.retryAfter));
      return response;
    }
    const response = photoJson({ message: "If this email address has been approved, a sign-in code will arrive shortly.", expiresIn: CODE_SECONDS, resendAfter: RESEND_SECONDS }, 202, true);
    response.headers.append("Set-Cookie", photoCookie(CHALLENGE_COOKIE, result.challenge, CODE_SECONDS));
    return response;
  } catch {
    console.error("photos: sign-in unavailable");
    return photoError("Sign-in is temporarily unavailable.", 503);
  }
}

export async function verifyCodeResponse(deps: PhotoAccessDeps, request: Request): Promise<Response> {
  if (!sameOrigin(request)) return photoError("Cross-site requests are not allowed.", 403);
  const parsed = await readPhotoJson(request);
  if ("response" in parsed) return parsed.response;
  const code = object(parsed.data) && typeof parsed.data.code === "string" ? parsed.data.code : "";
  try {
    const result = await verifyPhotoCode(deps, request, code);
    if (!result) return photoError("The code is incorrect or expired. Request a new code if needed.", 403);
    const response = photoJson({ authenticated: true, expiresAt: result.expiresAt }, 200, true);
    response.headers.append("Set-Cookie", photoCookie(SESSION_COOKIE, result.token, SESSION_SECONDS));
    response.headers.append("Set-Cookie", photoCookie(CHALLENGE_COOKIE, "", 0));
    return response;
  } catch {
    console.error("photos: sign-in unavailable");
    return photoError("Sign-in is temporarily unavailable.", 503);
  }
}

export async function sessionResponse(db: D1Database, request: Request, now = Math.floor(Date.now() / 1000)): Promise<Response> {
  try {
    const session = await photoSession(db, request, now);
    return photoJson(session ? { authenticated: true, expiresAt: session.expiresAt } : { authenticated: false }, 200, true);
  } catch {
    console.error("photos: session unavailable");
    return photoError("Sign-in is temporarily unavailable.", 503);
  }
}

export async function logoutResponse(db: D1Database, request: Request): Promise<Response> {
  if (!sameOrigin(request)) return photoError("Cross-site requests are not allowed.", 403);
  try {
    await logoutPhotoSession(db, request);
    const headers = new Headers(PRIVATE_HEADERS);
    headers.append("Set-Cookie", photoCookie(SESSION_COOKIE, "", 0));
    headers.append("Set-Cookie", photoCookie(CHALLENGE_COOKIE, "", 0));
    return new Response(null, { status: 204, headers });
  } catch {
    console.error("photos: sign-out unavailable");
    return photoError("Sign-out is temporarily unavailable.", 503);
  }
}
