/**
 * A write to the local site through wrangler dev. Its proxy retries a dropped connection to the Worker only for GET and
 * HEAD; a POST that meets one (on a server just started, or under load) gets the proxy's own 500, whose body is the
 * dropped connection's error ("Network connection lost") and which has none of the headers every response from the
 * site carries, its own 500s included (the middleware's Strict-Transport-Security). Only a 500 matching both is sent
 * again, so a 500 from the Worker itself is never retried.
 */
export async function postToSite(url: URL | string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, method: "POST" });
  if (response.status !== 500 || response.headers.has("strict-transport-security")) return response;
  const body = await response.clone().text();
  if (!body.includes("Network connection lost")) return response;
  // The proxy's 500: say so, so a run that meets one shows the cause instead of hiding it
  console.warn(`postToSite: wrangler's proxy lost the connection to the Worker on ${url}, sent again: ${body.slice(0, 200)}`);
  return fetch(url, { ...init, method: "POST" });
}
