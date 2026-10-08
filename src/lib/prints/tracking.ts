/** A tracking address worth a link: https only, one token. The one rule for the buyer's page, the admin and the shipped email (spec 18.4) */
export const trackingHref = (url: string): string | null => (/^https:\/\/\S+$/i.test(url.trim()) ? url.trim() : null);
