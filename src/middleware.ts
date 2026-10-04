import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { adminIdentity, isAdminPath, originAllowed } from "./lib/admin/gate";

// Astro sends Content-Security-Policy itself (security.csp in astro.config.mjs); these are the rest.
const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  // Not no-referrer: browsers would then send Origin: null on POSTs, and the origin check below would refuse every write
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

const refuse = (message: string) =>
  new Response(message, { status: 403, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  const admin = isAdminPath(url.pathname);
  let response: Response;
  // Every write must come from this site. Astro's own check is off, so these 403s get the headers below.
  if (!originAllowed(request, url)) {
    response = refuse("cross-site requests are not allowed");
  } else if (admin) {
    let email: string | null;
    // Test builds skip Access, and only on this machine; a production build can't contain this branch (astro.config.mjs
    // and the deploy job's guard), and a test build deployed by mistake still asks Access
    if (__ADMIN_BYPASS__ && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) email = "admin-bypass@localhost";
    else email = await adminIdentity(request, { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD });
    if (email) {
      context.locals.adminEmail = email;
      response = await next();
    } else {
      response = refuse("forbidden");
    }
  } else {
    response = await next();
  }
  // Redirect responses have immutable headers, so always copy before setting
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!secured.headers.has(name)) secured.headers.set(name, value);
  }
  if (admin) {
    secured.headers.set("Cache-Control", "no-store");
    secured.headers.set("X-Robots-Tag", "noindex");
  }
  return secured;
});
