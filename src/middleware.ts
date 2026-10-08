import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import type { AccessIdentity } from "./lib/admin/access";
import { adminIdentity, isAdminPath, originAllowed } from "./lib/admin/gate";
import { PRIVATE_HEADERS, isPrivatePath } from "./lib/photos/http";

// Astro sends Content-Security-Policy itself (security.csp in astro.config.mjs); these are the rest.
const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  // Not no-referrer: browsers would then send Origin: null on POSTs, and the origin check below would refuse every write
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

const plain = (message: string, status: number) =>
  new Response(message, { status, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
const refuse = (message: string) => plain(message, 403);

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  const admin = isAdminPath(url.pathname);
  const privatePhotos = isPrivatePath(url.pathname);
  let response: Response;
  // Every write must come from this site. Astro's own check is off, so these 403s get the headers below.
  if (!originAllowed(request, url)) {
    response = refuse("cross-site requests are not allowed");
  } else if (admin) {
    let identity: AccessIdentity | null;
    // Test builds skip Access, and only on this machine; a production build can't contain this branch (astro.config.mjs
    // and the deploy job's guard), and a test build deployed by mistake still asks Access
    if (__ADMIN_BYPASS__ && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) identity = { email: "admin-bypass@localhost", expires: null };
    else identity = await adminIdentity(request, { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD, adminEmail: env.ADMIN_EMAIL });
    if (identity) {
      context.locals.adminEmail = identity.email;
      if (identity.expires !== null) context.locals.adminUntil = identity.expires;
      try {
        response = await next();
      } catch (error) {
        // A page that throws (D1 down, say) would otherwise skip the headers below and leave a blank 500
        console.error("admin: the page failed to render", error);
        response = plain("the admin page couldn't load. try again.", 500);
      }
    } else {
      response = refuse("forbidden");
    }
  } else {
    if (privatePhotos) {
      try { response = await next(); }
      catch { console.error("photos: route unavailable"); response = plain("Downloads are temporarily unavailable.", 503); }
    } else response = await next();
  }
  // Redirect responses have immutable headers, so always copy before setting
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!secured.headers.has(name)) secured.headers.set(name, value);
  }
  if (admin) {
    secured.headers.set("Cache-Control", "no-store");
    // Set outright, so a page that ever calls Astro.cache.set can't have the edge serve /admin without the gate
    secured.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
    secured.headers.delete("Cache-Tag");
    secured.headers.set("X-Robots-Tag", "noindex");
  }
  if (privatePhotos) {
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) secured.headers.set(name, value);
    secured.headers.delete("Cache-Tag");
  }
  return secured;
});
