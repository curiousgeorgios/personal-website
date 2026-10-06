const SYDNEY = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Sydney" });

export function sydneyTime(now: Date): string {
  return SYDNEY.format(now).replace(/\s?(am|pm)$/i, (_match, period: string) => ` ${period.toLowerCase()}`);
}

// en-CA writes dates as YYYY-MM-DD, the format a date input and the log use. Built on first use, not at import: the
// home page's clock script imports this file, and a formatter built at module level would ship there unused.
let sydneyDateFormat: Intl.DateTimeFormat | undefined;

/** Today's date in Sydney, for the new log entry form */
export function sydneyDate(now: Date): string {
  sydneyDateFormat ??= new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Australia/Sydney" });
  return sydneyDateFormat.format(now);
}
