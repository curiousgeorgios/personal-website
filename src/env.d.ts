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
