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
  const date = at ? new Date(at) : null;
  const day = date && !Number.isNaN(date.getTime()) ? SYDNEY_DAY.format(date) : null;
  if (!status) return "not captured yet";
  if (status === "ok") return day ? `captured ${day}` : "captured";
  const reason = Object.hasOwn(SNAPSHOT_STATUSES, status) ? SNAPSHOT_STATUSES[status as SnapshotStatus] : status;
  return day ? `${reason} · last good capture ${day}` : `${reason} · no good capture yet`;
}

/** The widths every capture is stored at (spec 9): the hover card and label, phones and dense screens, the closer look */
export const SNAPSHOT_WIDTHS = [480, 960, 1920] as const;
export type SnapshotWidth = (typeof SNAPSHOT_WIDTHS)[number];
export type SnapshotFormat = "avif" | "webp";

/** Where a capture's files live in R2: one fresh base per capture, so a cached page never sees a key change under it */
export const snapshotBase = (slug: string, id: string) => `snapshots/${slug}-${id}`;
export const snapshotVariant = (base: string, width: SnapshotWidth, format: SnapshotFormat) => `${base}-${width}.${format}`;

/** The base a variant's key belongs to, or null for anything else under snapshots/ */
export function variantBase(key: string): string | null {
  const match = /^(snapshots\/.+)-(?:480|960|1920)\.(?:avif|webp)$/.exec(key);
  return match ? match[1] : null;
}
