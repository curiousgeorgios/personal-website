import { afterEach, expect, test, vi } from "vitest";
import { DAY, printConfig } from "../../src/lib/prints/config";

const env = (over: Record<string, unknown> = {}) =>
  ({
    PRINTS_OPEN: "true", PRINT_SELLER_NAME: "george vlachos", PRINT_GST: "none", STRIPE_GST_TAX_RATE: "", PRINT_FROM_EMAIL: "prints@curiousgeorge.dev",
    SITE_ORIGIN: "https://curiousgeorge.dev/", ADMIN_EMAIL: "hello@curiousgeorge.dev", ARTELO_API_BASE: "https://www.artelo.com/api/open/",
    STRIPE_API_BASE: "https://api.stripe.com", FX_URL: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD",
    STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: "whsec_abc", ARTELO_API_KEY: "artelo", ARTELO_WEBHOOK_SECRET: "hook",
    PRINT_VIEW_SECRET: "2".repeat(64), PHOTO_LINK_SECRET: "1".repeat(64), PRINT_RETRY_WINDOW: "0", EMAIL_SINK: "http://127.0.0.1:4401/__mail",
    ...over,
  }) as unknown as Cloudflare.Env;

afterEach(() => vi.unstubAllGlobals());

test("reads the vars, trims trailing slashes and finds nothing missing", () => {
  vi.stubGlobal("__TEST_HOOKS__", false);
  const config = printConfig(env());
  expect(config).toMatchObject({
    switchedOn: true, sellerName: "george vlachos", gst: "none", fromEmail: "prints@curiousgeorge.dev", siteOrigin: "https://curiousgeorge.dev",
    adminEmail: "hello@curiousgeorge.dev", arteloBase: "https://www.artelo.com/api/open", stripeBase: "https://api.stripe.com", missing: [],
  });
  expect(config.secrets.STRIPE_SECRET_KEY).toBe("sk_test_abc");
});

test("prints are switched on only by the exact string true; gst is none unless it says inclusive", () => {
  vi.stubGlobal("__TEST_HOOKS__", false);
  for (const value of ["false", "TRUE", "1", undefined]) expect(printConfig(env({ PRINTS_OPEN: value })).switchedOn).toBe(false);
  expect(printConfig(env({ PRINT_GST: "inclusive" })).gst).toBe("inclusive");
  expect(printConfig(env({ PRINT_GST: "yes" })).gst).toBe("none");
});

test("an unset or blank secret is missing, by name, in the spec's order", () => {
  vi.stubGlobal("__TEST_HOOKS__", false);
  const config = printConfig(env({ ARTELO_API_KEY: undefined, PRINT_VIEW_SECRET: "   " }));
  expect(config.missing).toEqual(["ARTELO_API_KEY", "PRINT_VIEW_SECRET"]);
  expect(config.secrets.ARTELO_API_KEY).toBe("");
});

test("a production build ignores the test-only vars and keeps a live key", () => {
  vi.stubGlobal("__TEST_HOOKS__", false);
  const config = printConfig(env({ STRIPE_SECRET_KEY: "sk_live_abc" }));
  expect(config.retryWindow).toBe(DAY);
  expect(config.emailSink).toBeNull();
  expect(config.testClients).toBe(false);
  expect(config.secrets.STRIPE_SECRET_KEY).toBe("sk_live_abc");
});

test("a test build reads the retry window and the mail sink, and refuses a live stripe key", () => {
  vi.stubGlobal("__TEST_HOOKS__", true);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(printConfig(env()).retryWindow).toBe(0);
  expect(printConfig(env({ PRINT_RETRY_WINDOW: "nonsense" })).retryWindow).toBe(DAY);
  expect(printConfig(env()).emailSink).toBe("http://127.0.0.1:4401/__mail");
  expect(printConfig(env()).testClients).toBe(true);
  const live = printConfig(env({ STRIPE_SECRET_KEY: "sk_live_abc" }));
  expect(live.secrets.STRIPE_SECRET_KEY).toBe("");
  expect(live.missing).toEqual(["STRIPE_SECRET_KEY"]);
  expect(error).toHaveBeenCalledWith("prints: a test build refuses a live stripe key");
  error.mockRestore();
});

test("a test build refuses a live key, standard or restricted, and keeps a test key of either kind", () => {
  vi.stubGlobal("__TEST_HOOKS__", true);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const key of ["sk_live_abc", "rk_live_abc"]) {
    const live = printConfig(env({ STRIPE_SECRET_KEY: key }));
    expect(live.secrets.STRIPE_SECRET_KEY, key).toBe("");
    expect(live.missing, key).toEqual(["STRIPE_SECRET_KEY"]);
  }
  expect(error).toHaveBeenCalledTimes(2);
  for (const key of ["sk_test_abc", "rk_test_abc"]) {
    const test = printConfig(env({ STRIPE_SECRET_KEY: key }));
    expect(test.secrets.STRIPE_SECRET_KEY, key).toBe(key);
    expect(test.missing, key).toEqual([]);
  }
  error.mockRestore();
});
