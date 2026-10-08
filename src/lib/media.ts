// Media lives in R2 and is served same-origin under /media/<key> (spec 6.2). Keys are unique and never reused,
// so a file can be cached for a year.
export const MEDIA_PREFIXES = ["audio/", "covers/", "snapshots/", "photos/previews/"];

export function isMediaKey(key: string): boolean {
  if (!MEDIA_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
  return key.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

const missing = () =>
  new Response("not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });

const unavailable = () =>
  new Response("media unavailable", { status: 500, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });

type ByteRange = { offset?: number; length?: number; suffix?: number };

export async function serveMedia(bucket: R2Bucket, key: string, request: Request): Promise<Response> {
  if (!isMediaKey(key)) return missing();
  let object: R2ObjectBody | R2Object | null;
  try {
    object = await bucket.get(key, { range: request.headers, onlyIf: request.headers });
  } catch (error) {
    console.error("media: R2 read failed", key, error);
    // R2 throws for a range it can't serve, such as one past the end, but also for a real outage. Audio always
    // sends Range, so a head request tells the two apart: a found object means the range was the problem.
    if (!request.headers.has("Range")) return unavailable();
    try {
      const found = await bucket.head(key);
      if (!found) return missing();
      return new Response(null, { status: 416, headers: { "Cache-Control": "no-store", "Content-Range": `bytes */${found.size}` } });
    } catch (headError) {
      console.error("media: R2 head failed", key, headError);
      return unavailable();
    }
  }
  if (!object) return missing();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  // R2 leaves the body out when the request's conditions say the browser already has this version
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  const range = object.range as ByteRange | undefined;
  if (range && request.headers.has("Range")) {
    const offset = range.suffix !== undefined ? object.size - range.suffix : (range.offset ?? 0);
    const length = range.suffix !== undefined ? range.suffix : (range.length ?? object.size - offset);
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}
