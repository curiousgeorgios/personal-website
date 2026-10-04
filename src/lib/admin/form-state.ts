import type { ActionFailure } from "./actions";
import type { AdminFact, AdminItem, AdminLogEntry, AdminRecord } from "./store";
import type { Fields } from "./validate";

/** How one form renders: after it failed, open with what was typed and what's wrong; otherwise closed, with what's saved */
export interface FormState {
  open: boolean;
  values: Fields;
  errors: Fields;
}

export function formState(failure: ActionFailure | null, form: string, saved: Fields): FormState {
  if (failure?.form === form) return { open: true, values: { ...saved, ...failure.values }, errors: failure.errors };
  return { open: false, values: saved, errors: {} };
}

const field = (value: string | null) => value ?? "";

/** A saved line as the fields of its form (the names in ITEM_FIELDS) */
export const itemFields = (item: AdminItem): Fields => ({
  section: item.section,
  slug: item.slug,
  text: item.text,
  aside: field(item.aside),
  label_status: field(item.labelStatus),
  label_era: field(item.labelEra),
  label_made_of: field(item.labelMadeOf),
  label_text: field(item.labelText),
  label_kind: field(item.labelKind),
  label_note: field(item.labelNote),
  snapshot_url: field(item.snapshotUrl),
});

export const logFields = (entry: AdminLogEntry): Fields => ({ date: entry.date, precision: entry.precision, text: entry.text });

export const factFields = (key: "shelf" | "kettle", fact: AdminFact | null): Fields => ({ key, title: fact?.title ?? "", subtitle: field(fact?.subtitle ?? null) });

export const recordFields = (record: AdminRecord): Fields => ({ title: record.title, artist: record.artist });
