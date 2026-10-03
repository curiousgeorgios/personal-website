import type { APIRoute } from "astro";

// Retired in the 2026 redesign (ADR-0007)
export const GET: APIRoute = () => new Response(null, { status: 301, headers: { Location: "/" } });
