/** What the snapshots Worker (plan 4) records in items.snapshot_status, and how the admin page says it (spec 9) */
export const SNAPSHOT_STATUSES = {
  ok: "captured",
  "navigation-error": "the page didn't load",
  "http-error": "the page returned an error",
  challenge: "a bot check blocked it",
  "too-small": "the capture came out blank",
} as const;

export type SnapshotStatus = keyof typeof SNAPSHOT_STATUSES;

// The Worker captures at 17:00 UTC, already the next morning in Sydney, so the admin shows Sydney dates
const SYDNEY_DAY = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Australia/Sydney" });

/** One line for the admin page: when the page was last captured, or why the last try failed (a failure keeps the old image) */
export function describeSnapshot(status: string | null, at: string | null): string {
  const day = at ? SYDNEY_DAY.format(new Date(at)) : null;
  if (!status) return "not captured yet";
  if (status === "ok") return day ? `captured ${day}` : "captured";
  const reason = status in SNAPSHOT_STATUSES ? SNAPSHOT_STATUSES[status as SnapshotStatus] : status;
  return day ? `${reason} · last good capture ${day}` : `${reason} · no good capture yet`;
}
