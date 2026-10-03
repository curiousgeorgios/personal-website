import { defineMiddleware } from "astro:middleware";

// Astro sends Content-Security-Policy itself (security.csp in astro.config.mjs); these are the rest.
const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  // Redirect responses have immutable headers, so always copy before setting
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!secured.headers.has(name)) secured.headers.set(name, value);
  }
  return secured;
});
