import type { Page } from "@playwright/test";

/** Sends Global Privacy Control from this page, so the beacon sends nothing: a check against the live site must not count as a visit */
export const withGpc = (page: Page) =>
  page.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
