import { PRIVATE_HEADERS, photoError, requestToken } from "./http";
import { activeGrant, photoById, photoMaster } from "./store";
import { verifyPhotoToken } from "./tokens";

export async function downloadPhoto(db: D1Database, bucket: R2Bucket, secret: string | undefined, id: string, request: Request, now = Math.floor(Date.now() / 1000)): Promise<Response> {
  try {
    const token = await verifyPhotoToken(secret, requestToken(request), now);
    const grant = token && (token.photoId === null || token.photoId === id) ? await activeGrant(db, token, now) : null;
    if (!token || !grant) return photoError("This download link is invalid or expired.", 403);
    // A print order's grant serves its photo's current master whether or not it is published (spec 13.3); a catalogue
    // link still needs publication
    const photo = grant.orderId !== null && token.photoId === id ? await photoMaster(db, id) : await photoById(db, id);
    if (!photo || !/^prints\/[A-Za-z0-9_-]+\/[a-f0-9]{64}\.jpg$/.test(photo.print_key)) return photoError("Photo unavailable.", 404);
    const object = await bucket.head(photo.print_key);
    if (!object) return photoError("Photo unavailable.", 404);
    if (object.size !== photo.print_bytes || object.httpMetadata?.contentType !== "image/jpeg") return photoError("Photo unavailable.", 503);
    const headers = new Headers({ ...PRIVATE_HEADERS, "Content-Type": "image/jpeg", "Content-Disposition": `attachment; filename="${photo.id}.jpg"`, "Accept-Ranges": "bytes", "ETag": object.httpEtag });
    const ifMatch = request.headers.get("If-Match");
    if (ifMatch && ifMatch !== "*" && !ifMatch.split(/,\s*/).includes(object.httpEtag)) return new Response(null, { status: 412, headers });
    const ifNone = request.headers.get("If-None-Match");
    if (ifNone === "*" || ifNone?.split(/,\s*/).includes(object.httpEtag)) return new Response(null, { status: 304, headers });
    const rangeHeader = request.headers.get("Range");
    const ifRange = request.headers.get("If-Range");
    let range: { offset: number; length: number } | undefined;
    // HTTP range semantics only apply to GET; HEAD returns metadata for the complete object.
    if (request.method === "GET" && rangeHeader && (!ifRange || ifRange === object.httpEtag)) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      let start = NaN, end = NaN;
      if (match && (match[1] || match[2])) {
        if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), object.size - 1) : object.size - 1; }
        else { const suffix = Number(match[2]); if (suffix > 0) { start = Math.max(0, object.size - suffix); end = object.size - 1; } }
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= object.size || end < start) {
        headers.set("Content-Range", `bytes */${object.size}`);
        return new Response(null, { status: 416, headers });
      }
      range = { offset: start, length: end - start + 1 };
      headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
    }
    headers.set("Content-Length", String(range?.length ?? object.size));
    if (request.method === "HEAD") return new Response(null, { headers });
    const body = await bucket.get(photo.print_key, range ? { range } : undefined);
    if (!body || !("body" in body)) return photoError("Photo unavailable.", 404);
    if (body.httpEtag !== object.httpEtag || body.size !== object.size) return photoError("Photo unavailable.", 503);
    return new Response(body.body, { status: range ? 206 : 200, headers });
  } catch {
    // Never log the Request or error object, which could contain a bearer link.
    console.error("photos: download unavailable");
    return photoError("Downloads are temporarily unavailable.", 503);
  }
}
