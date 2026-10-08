// Quotes call Artelo, so they are limited with Workers Rate Limiting, which sets no cookie (spec 21.3). Limits count per
// Cloudflare location, which is accepted.

export interface PrintLimits {
  quote?: RateLimit;
  checkout?: RateLimit;
  artelo?: RateLimit;
}

/** QUOTE_LIMIT and CHECKOUT_LIMIT key on the visitor's address; test builds on X-Test-Client when a request sends it */
export function clientKey(request: Request, testClients: boolean): string {
  const test = testClients ? request.headers.get("x-test-client") : null;
  return test ? `test:${test}` : (request.headers.get("cf-connecting-ip") ?? "unknown");
}

/** ARTELO_LIMIT keeps every quote under Artelo's own limit with one bucket; test builds give each test client its own */
export function arteloKey(request: Request, testClients: boolean): string {
  const test = testClients ? request.headers.get("x-test-client") : null;
  return test ? `price-check:${test}` : "price-check";
}

/** Whether the request is under the limit. A missing or failing binding lets it through, logged: the limit protects Artelo's quota, not money */
export async function underLimit(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch (error) {
    console.error("prints: a rate limit couldn't be checked", error instanceof Error ? error.message : String(error));
    return true;
  }
}
