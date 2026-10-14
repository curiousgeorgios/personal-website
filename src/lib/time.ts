// Built on first use, not at import: a phone's first Intl formatter costs it about 55ms, which the home page's clock
// spends after the first paint (clock.ts)
let sydney: Intl.DateTimeFormat | undefined;

export function sydneyTime(now: Date): string {
  sydney ??= new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Sydney" });
  return sydney.format(now).replace(/\s?(am|pm)$/i, (_match, period: string) => ` ${period.toLowerCase()}`);
}

// en-CA writes dates as YYYY-MM-DD, the format a date input and the log use. Built on first use, not at import: the
// home page's clock script imports this file, and a formatter built at module level would ship there unused.
let sydneyDateFormat: Intl.DateTimeFormat | undefined;

/** Today's date in Sydney, for the new log entry form */
export function sydneyDate(now: Date): string {
  sydneyDateFormat ??= new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Australia/Sydney" });
  return sydneyDateFormat.format(now);
}
