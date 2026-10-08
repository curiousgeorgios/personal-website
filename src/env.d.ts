/// <reference types="astro/client" />

/** True only in builds made with TEST_HOOKS=1 (bun run build:test); production builds compile the hooks out */
declare const __TEST_HOOKS__: boolean;

/** True only in test builds made with ADMIN_BYPASS=1, which skip Cloudflare Access on /admin; production builds can't set it */
declare const __ADMIN_BYPASS__: boolean;

declare namespace App {
  interface Locals {
    /** The signed-in admin's email, set by the middleware on /admin requests */
    adminEmail?: string;
    /** When the admin's Access session ends (the token's exp, seconds since 1970); unset under the local bypass */
    adminUntil?: number;
  }
}

declare namespace Cloudflare {
  interface Env {
    /** 32 random bytes as lowercase hex. Kept in a Worker secret, never in the public catalogue. */
    PHOTO_LINK_SECRET?: string;
    /** The PostHog project key, a Worker secret (wrangler secret put POSTHOG_KEY). Unset locally, so /ingest drops events */
    POSTHOG_KEY?: string;
    /** Print secrets George sets with wrangler secret put (spec 21.4); prints stay closed until all are set */
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    ARTELO_API_KEY?: string;
    /** Set by bun run prints:webhook */
    ARTELO_WEBHOOK_SECRET?: string;
    /** 32 random bytes as lowercase hex: order view keys and sealed quotes, each under its own label */
    PRINT_VIEW_SECRET?: string;
    /** Test builds only: seconds in place of the 24-hour retry window (spec 19) */
    PRINT_RETRY_WINDOW?: string;
    /** Test builds only: where mail goes instead of the EMAIL binding (spec 23.3) */
    EMAIL_SINK?: string;
  }
}

interface Window {
  __deck?: {
    state(): import("./deck/types").DeckState;
    audio(): { paused: boolean; src: string; rate: number; ready: boolean };
    /** Holds the runner's clock at `at` (a performance.now() time) until called with null */
    hold(at: number | null): void;
  };
  /** The runner's held clock, test builds only */
  __deckClock?: number;
  __deckScene?: import("./deck/scene/hooks").SceneHooks;
}
