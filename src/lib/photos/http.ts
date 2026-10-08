import { CATALOGUE_LIMIT, MAX_CATALOGUE_LIMIT } from "./store";

export const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
  "CDN-Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

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

export function requestToken(request: Request): string {
  const tokens = new URL(request.url).searchParams.getAll("token");
  return tokens.length === 1 ? tokens[0] : "";
}

export async function readPhotoJson(request: Request): Promise<{ data: unknown } | { response: Response }> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return { response: photoError("Use application/json.", 415) };
  const reader = request.body?.getReader();
  if (!reader) return { response: photoError("Invalid JSON.", 400) };
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4096) { await reader.cancel(); return { response: photoError("Request too large.", 413) }; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { data: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch { return { response: photoError("Invalid JSON.", 400) }; }
  finally { reader.releaseLock(); }
}
