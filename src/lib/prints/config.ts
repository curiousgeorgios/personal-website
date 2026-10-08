// Everything the print code reads from the Worker's env, in one place (spec 21.4). Secrets stay strings ("" when unset),
// so a missing one closes prints (spec 16.5) instead of throwing halfway through a request.

/** The secrets prints need before they can open (spec 16.5), in the spec's order */
export const PRINT_SECRETS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "ARTELO_API_KEY", "ARTELO_WEBHOOK_SECRET", "PRINT_VIEW_SECRET", "PHOTO_LINK_SECRET"] as const;
export type PrintSecret = (typeof PRINT_SECRETS)[number];

export const DAY = 86_400;

export interface PrintConfig {
  /** PRINTS_OPEN is exactly "true" */
  switchedOn: boolean;
  sellerName: string;
  gst: "none" | "inclusive";
  gstTaxRate: string;
  fromEmail: string;
  /** The site's origin without a trailing slash; the cron has no request to read it from */
  siteOrigin: string;
  adminEmail: string;
  arteloBase: string;
  stripeBase: string;
  fxUrl: string;
  secrets: Record<PrintSecret, string>;
  /** The secrets that are unset or blank, by name */
  missing: PrintSecret[];
  /** Seconds from payment in which Artelo must take an order (spec 19): a day, or PRINT_RETRY_WINDOW in test builds */
  retryWindow: number;
  /** Test builds only: mail goes here instead of the EMAIL binding (spec 23.3) */
  emailSink: string | null;
  /** Test builds only: rate limits key on X-Test-Client when a request sends it (spec 21.3) */
  testClients: boolean;
}

const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const trimSlash = (value: string) => value.replace(/\/+$/, "");

export function printConfig(env: Cloudflare.Env): PrintConfig {
  const vars = env as unknown as Record<string, unknown>;
  const secrets = Object.fromEntries(PRINT_SECRETS.map((name) => [name, text(vars[name]).trim()])) as Record<PrintSecret, string>;
  let retryWindow = DAY;
  let emailSink: string | null = null;
  // Statements, not expressions: a production build compiles this block out, test-only names and all
  if (__TEST_HOOKS__) {
    // A test build never talks to Stripe's live mode (spec 21.4)
    if (secrets.STRIPE_SECRET_KEY.startsWith("sk_live_")) {
      console.error("prints: a test build refuses a live stripe key");
      secrets.STRIPE_SECRET_KEY = "";
    }
    const window = text(vars.PRINT_RETRY_WINDOW);
    if (/^\d{1,6}$/.test(window)) retryWindow = Number(window);
    if (text(vars.EMAIL_SINK)) emailSink = text(vars.EMAIL_SINK);
  }
  return {
    switchedOn: vars.PRINTS_OPEN === "true",
    sellerName: text(vars.PRINT_SELLER_NAME, "george vlachos"),
    gst: vars.PRINT_GST === "inclusive" ? "inclusive" : "none",
    gstTaxRate: text(vars.STRIPE_GST_TAX_RATE),
    fromEmail: text(vars.PRINT_FROM_EMAIL, "prints@curiousgeorge.dev"),
    siteOrigin: trimSlash(text(vars.SITE_ORIGIN, "https://curiousgeorge.dev")),
    adminEmail: text(vars.ADMIN_EMAIL),
    arteloBase: trimSlash(text(vars.ARTELO_API_BASE, "https://www.artelo.com/api/open")),
    stripeBase: trimSlash(text(vars.STRIPE_API_BASE, "https://api.stripe.com")),
    fxUrl: text(vars.FX_URL, "https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD"),
    secrets,
    missing: PRINT_SECRETS.filter((name) => secrets[name] === ""),
    retryWindow,
    emailSink,
    testClients: __TEST_HOOKS__,
  };
}

/** What the print code needs to act: the store, the config, the outside world and the clock (seconds), all replaceable in tests */
export interface PrintDeps {
  db: D1Database;
  config: PrintConfig;
  fetch: typeof fetch;
  now: () => number;
  /** PHOTO_PRINTS, the private masters an order's links serve */
  photoPrints: R2Bucket;
  /** The send_email binding; null where there is none (unit tests) */
  email: SendEmail | null;
  /** Work that must finish after the response: the request's or the cron's waitUntil */
  waitUntil: (promise: Promise<unknown>) => void;
}

export function printDeps(env: Cloudflare.Env, waitUntil: (promise: Promise<unknown>) => void): PrintDeps {
  return {
    db: env.DB,
    config: printConfig(env),
    // Bound, so the runtime's fetch is never called with another `this`
    fetch: (input, init) => fetch(input, init),
    now: () => Math.floor(Date.now() / 1000),
    photoPrints: env.PHOTO_PRINTS,
    email: env.EMAIL ?? null,
    waitUntil,
  };
}
