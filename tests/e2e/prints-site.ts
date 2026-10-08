// The prints e2e servers and their fixture secrets (spec 23.3, ADR-0024). Public on purpose: they only ever sign fixture
// data in throwaway stores. playwright.config.ts, the stand-in and the specs all import them, so each value lives once.

/** Every provider stood in; recreated every run */
export const PRINTS = "http://localhost:4337";
/** Stripe's real test mode, started only when STRIPE_TEST_SECRET_KEY is set (Task 15) */
export const PRINTS_STRIPE = "http://localhost:4338";
/** Prints switched on with every secret but no exchange rate stored: the basket shows, unquotable (spec 16.5 as ruled) */
export const PRINTS_NO_RATE = "http://localhost:4339";
/** The stand-in for Artelo, the exchange rate, Stripe's three endpoints and the mail binding */
export const STAND_IN = "http://127.0.0.1:4401";

export const FIXTURE_STRIPE_KEY = "sk_test_fixture_prints";
export const FIXTURE_SECRETS = {
  STRIPE_WEBHOOK_SECRET: "whsec_fixture_prints",
  ARTELO_API_KEY: "artelo-fixture-key",
  ARTELO_WEBHOOK_SECRET: "artelo-fixture-webhook-secret",
  PRINT_VIEW_SECRET: "2".repeat(64),
} as const;

/** A prints server's store, made afresh: the migrations, the gallery fixture and (unless left out) a rate of 1.50 dated today, so prints open at once */
export function printStore(store: string, { rate = true } = {}): string {
  return [
    `rm -rf ${store}`,
    `wrangler d1 migrations apply curiousgeorge-logbook --local --persist-to ${store}`,
    `node scripts/seed-photo-test.mjs --persist-to ${store}`,
    ...(rate ? [`wrangler d1 execute curiousgeorge-logbook --local --persist-to ${store} --command "INSERT INTO print_settings (key, value, updated_at) VALUES ('usd_aud', '1.5', 0), ('usd_aud_date', date('now'), 0)"`] : []),
  ].join(" && ");
}

/**
 * The vars both prints servers share: prints open, the stand-in for Artelo, the rate and mail, the fixture secrets and
 * every print setting at wrangler.jsonc's value. build:test copies George's .dev.vars into dist/server, so anything left
 * unpinned would come from his machine (ADR-0024's reasoning). Each is quoted for the shell: the seller's name has a space
 */
export function printVars(origin: string): string {
  const vars: Record<string, string> = {
    PRINTS_OPEN: "true", SITE_ORIGIN: origin, ARTELO_API_BASE: STAND_IN, FX_URL: `${STAND_IN}/fx`, EMAIL_SINK: `${STAND_IN}/__mail`,
    PRINT_GST: "none", STRIPE_GST_TAX_RATE: "", PRINT_SELLER_NAME: "george vlachos", PRINT_FROM_EMAIL: "prints@curiousgeorge.dev", ADMIN_EMAIL: "hello@curiousgeorge.dev",
    ...FIXTURE_SECRETS,
  };
  return Object.entries(vars).map(([name, value]) => `--var '${name}:${value}'`).join(" ");
}
