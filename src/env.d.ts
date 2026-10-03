/// <reference types="astro/client" />

/** True only in builds made with TEST_HOOKS=1 (bun run build:test); production builds compile the hooks out */
declare const __TEST_HOOKS__: boolean;

interface Window {
  __deck?: {
    state(): import("./deck/types").DeckState;
    audio(): { paused: boolean; src: string; rate: number };
  };
}
