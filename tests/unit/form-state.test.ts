import { expect, test } from "vitest";
import type { ActionFailure } from "../../src/lib/admin/actions";
import { factFields, formState, itemFields, logFields, recordFields } from "../../src/lib/admin/form-state";

const saved = factFields("shelf", { title: "the scout mindset", subtitle: "julia galef" });
const failure: ActionFailure = {
  ok: false,
  section: "lately",
  form: "fact-shelf",
  errors: { title: "a title is needed, or clear both to hide it" },
  values: { key: "shelf", title: "", subtitle: "julia galef" },
};

test("a form that didn't fail shows what's saved, closed", () => {
  expect(formState(null, "fact-shelf", saved)).toEqual({ open: false, values: saved, errors: {} });
  expect(formState(failure, "fact-kettle", saved)).toEqual({ open: false, values: saved, errors: {} });
});

test("the form that failed opens with what was typed and what's wrong", () => {
  expect(formState(failure, "fact-shelf", saved)).toEqual({ open: true, values: failure.values, errors: failure.errors });
});

test("a failure without values (a remove that wasn't ticked) keeps the saved values", () => {
  const unticked: ActionFailure = { ok: false, section: "now", form: "item-3", errors: { confirm: "tick the box to remove it" }, values: {} };
  expect(formState(unticked, "item-3", saved)).toEqual({ open: true, values: saved, errors: unticked.errors });
});

test("saved rows become form fields, with empty strings for what's unset", () => {
  expect(factFields("kettle", null)).toEqual({ key: "kettle", title: "", subtitle: "" });
  expect(
    itemFields({
      id: 3,
      slug: "kpmg",
      section: "before",
      position: 6,
      text: "management consulting at kpmg",
      aside: null,
      labelStatus: "retired",
      labelEra: "2016 - 2018",
      labelMadeOf: null,
      labelText: null,
      labelKind: "lesson",
      labelNote: "listen first.",
      snapshotUrl: null,
      snapshotAt: null,
      snapshotStatus: null,
    }),
  ).toEqual({
    section: "before",
    slug: "kpmg",
    text: "management consulting at kpmg",
    aside: "",
    label_status: "retired",
    label_era: "2016 - 2018",
    label_made_of: "",
    label_text: "",
    label_kind: "lesson",
    label_note: "listen first.",
    snapshot_url: "",
  });
  expect(logFields({ id: 1, date: "2026-10-01", precision: "month", text: "two." })).toEqual({ date: "2026-10-01", precision: "month", text: "two." });
  expect(recordFields({ id: 1, title: "simple things", artist: "loom room", audioKey: "a", coverKey: "c", position: 1, active: true })).toEqual({
    title: "simple things",
    artist: "loom room",
  });
});
