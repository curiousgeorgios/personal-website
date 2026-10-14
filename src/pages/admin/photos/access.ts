import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { approveEmail, approvedEmails, normaliseEmail, revokeEmail } from "../../../lib/photos/access";
import { photoError, photoJson, readPhotoJson } from "../../../lib/photos/http";

export const GET: APIRoute = async () => {
  try { return photoJson({ approvals: await approvedEmails(env.DB) }, 200, true); }
  catch { console.error("photos: approvals unavailable"); return photoError("Download access is temporarily unavailable.", 503); }
};

export const POST: APIRoute = async ({ request }) => {
  const parsed = await readPhotoJson(request);
  if ("response" in parsed) return parsed.response;
  const data = parsed.data;
  const email = data && typeof data === "object" && !Array.isArray(data) ? normaliseEmail((data as Record<string, unknown>).email) : null;
  if (!email) return photoError("Enter a valid email address.", 400);
  try { return photoJson({ approval: await approveEmail(env.DB, env.PHOTO_LINK_SECRET, email, Math.floor(Date.now() / 1000)) }, 201, true); }
  catch { console.error("photos: approval unavailable"); return photoError("Could not approve download access.", 503); }
};

export const DELETE: APIRoute = async ({ url }) => {
  try { return await revokeEmail(env.DB, url.searchParams.get("id") ?? "", Math.floor(Date.now() / 1000)) ? photoJson({ revoked: true }, 200, true) : photoError("Approval unavailable or already revoked.", 404); }
  catch { console.error("photos: revocation unavailable"); return photoError("Could not revoke download access.", 503); }
};
