import { CATALOGUE_LIMIT, ENTRY_LIMIT, MAX_CATALOGUE_LIMIT, MAX_ENTRY_LIMIT } from "./store";

export const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
  "CDN-Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Paths whose responses carry a bearer token or what it unlocks: the middleware gives them PRIVATE_HEADERS whatever the
 * route sent, so they are never cached, indexed or passed on as a referrer (spec 5.2): the downloads and a buyer's order page (spec 13.3).
 */
export const isPrivatePath = (pathname: string) =>
  pathname.startsWith("/api/photos/access/") || pathname === "/api/photos/downloads" || pathname === "/api/photos/downloads/" || pathname === "/photos/downloads" || pathname.startsWith("/photos/downloads/") || pathname.startsWith("/prints/");

export function photoJson(value: unknown, status = 200, privateResponse = false): Response {
  return new Response(JSON.stringify(value), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    ...(privateResponse ? PRIVATE_HEADERS : { "Cache-Control": status === 200 ? "public, max-age=60, stale-while-revalidate=300" : "no-store" }),
  } });
}

export const photoError = (message: string, status: number) => photoJson({ error: message }, status, true);

export function pageOptions(url: URL): { after: number; limit: number; collection: string | null } | null {
  const after = url.searchParams.get("after") ?? "-1";
  const limit = url.searchParams.get("limit") ?? String(CATALOGUE_LIMIT);
  const collection = url.searchParams.get("collection");
  if (!/^(?:-1|\d{1,9})$/.test(after) || !/^\d{1,2}$/.test(limit)) return null;
  if (Number(limit) < 1 || Number(limit) > MAX_CATALOGUE_LIMIT) return null;
  if (collection !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(collection)) return null;
  return { after: Number(after), limit: Number(limit), collection };
}

/** The entry mode's query (spec 3.6): by=entry, an optional before (seconds) and a limit from 1 to 12; anything else is null */
export function entryOptions(url: URL): { before: number | null; limit: number } | null {
  if ([...url.searchParams.keys()].some((key) => !["by", "before", "limit"].includes(key))) return null;
  if (url.searchParams.getAll("by").join(",") !== "entry") return null;
  const before = url.searchParams.get("before");
  const limit = url.searchParams.get("limit") ?? String(ENTRY_LIMIT);
  if ((before !== null && !/^\d{1,10}$/.test(before)) || !/^\d{1,2}$/.test(limit)) return null;
  if (Number(limit) < 1 || Number(limit) > MAX_ENTRY_LIMIT) return null;
  return { before: before === null ? null : Number(before), limit: Number(limit) };
}

export function requestToken(request: Request): string {
  const tokens = new URL(request.url).searchParams.getAll("token");
  return tokens.length === 1 ? tokens[0] : "";
}

// Finish small rejected uploads without retaining their bytes. A partly-read body can reset the dev proxy's next
// request (workers-sdk #15709); both the byte cap and deadline keep this from draining an unlimited or slow upload.
async function discardRemainder(reader: ReadableStreamDefaultReader<Uint8Array>, consumed: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        while (consumed <= 65536) {
          const { value, done } = await reader.read();
          if (done) return;
          consumed += value.length;
        }
      })(),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, 50); }),
    ]);
  } catch {
    // A disconnected client still gets no parsed data.
  } finally { clearTimeout(timer); }
}

export async function readPhotoJson(request: Request): Promise<{ data: unknown } | { response: Response }> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return { response: photoError("Use application/json.", 415) };
  const declared = request.headers.get("content-length");
  const declaredTooLarge = !!declared && /^\d+$/.test(declared) && Number(declared) > 4096;
  const reader = request.body?.getReader();
  if (!reader) return { response: photoError("Invalid JSON.", 400) };
  try {
    if (declaredTooLarge) {
      await discardRemainder(reader, 0);
      return { response: photoError("Request too large.", 413) };
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4096) {
        await discardRemainder(reader, length);
        return { response: photoError("Request too large.", 413) };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { data: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch { return { response: photoError("Invalid JSON.", 400) }; }
  finally { reader.releaseLock(); }
}
