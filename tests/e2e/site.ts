/**
 * A write to the local site through wrangler dev. Its proxy retries a dropped connection to the Worker only for GET and
 * HEAD; a POST that meets one (on a server just started, or under load) gets the proxy's own 500, without the headers
 * every response from the site carries, its own 500s included (the middleware's Strict-Transport-Security). That 500, and
 * only that one, is sent again.
 */
export async function postToSite(url: URL | string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, method: "POST" });
  if (response.status !== 500 || response.headers.has("strict-transport-security")) return response;
  // Not the site's 500: say what it was, so a run that meets one shows the cause instead of hiding it
  console.warn(`postToSite: a 500 without the site's headers from ${url}, sent again: ${(await response.text()).slice(0, 200)}`);
  return fetch(url, { ...init, method: "POST" });
}
