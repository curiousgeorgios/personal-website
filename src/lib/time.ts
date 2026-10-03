const SYDNEY = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Sydney" });

export function sydneyTime(now: Date): string {
  return SYDNEY.format(now).replace(/\s?(am|pm)$/i, (_match, period: string) => ` ${period.toLowerCase()}`);
}
