import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { photoError, photoJson } from "../../../lib/photos/http";
import { revokeCatalogueLink } from "../../../lib/photos/store";

export const POST: APIRoute = () => photoError("Download links have been replaced by approved email sign-in.", 410);

export const DELETE: APIRoute = async ({ url }) => {
  const id = url.searchParams.get("grantId") ?? "";
  // Catalogue links only: a photo-scoped grant (a print order's) is revoked by the print code alone, and answers as if it weren't here
  try { return (await revokeCatalogueLink(env.DB, id)) === "revoked" ? photoJson({ revoked: true }, 200, true) : photoError("Link unavailable or already revoked.", 404); }
  catch { console.error("photos: could not revoke link"); return photoError("Could not revoke the link.", 503); }
};
