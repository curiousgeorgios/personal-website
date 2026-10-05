/// <reference types="astro/client" />

/** True only in builds made with TEST_HOOKS=1 (bun run build:test); production builds compile the hooks out */
declare const __TEST_HOOKS__: boolean;

/** True only in test builds made with ADMIN_BYPASS=1, which skip Cloudflare Access on /admin; production builds can't set it */
declare const __ADMIN_BYPASS__: boolean;

declare namespace App {
  interface Locals {
    /** The signed-in admin's email, set by the middleware on /admin requests */
    adminEmail?: string;
  }
}

declare namespace Cloudflare {
  interface Env {
    /** The PostHog project key, a Worker secret (wrangler secret put POSTHOG_KEY). Unset locally, so /ingest drops events */
    POSTHOG_KEY?: string;
  }
}

interface Window {
  __deck?: {
    state(): import("./deck/types").DeckState;
    audio(): { paused: boolean; src: string; rate: number };
  };
  __deckScene?: import("./deck/scene/hooks").SceneHooks;
}
