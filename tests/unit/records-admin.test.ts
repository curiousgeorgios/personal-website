import { describe, expect, test } from "vitest";
import RecordsAdmin from "../../src/components/admin/RecordsAdmin.astro";
import type { ActionFailure } from "../../src/lib/admin/actions";
import type { AdminRecord } from "../../src/lib/admin/store";
import { render, text } from "./render";

const CAP = "the crate holds six records. deactivate one to add another.";
const record = (id: number): AdminRecord => ({ id, title: `record ${id}`, artist: "someone", audioKey: `audio/${id}.mp3`, coverKey: `covers/${id}.webp`, position: id, active: true });
const full = [1, 2, 3, 4, 5, 6].map(record);

describe("RecordsAdmin, with a full crate", () => {
  test("says the crate is full once, in a hint, and has no add form", async () => {
    const doc = await render(RecordsAdmin, { records: full, failure: null });
    expect(text(doc.querySelector("#record-new .hint"))).toBe(CAP);
    expect(doc.querySelector("#record-new form")).toBeNull();
  });

  test("after an add fails on it, says so once, in the alert", async () => {
    const failure: ActionFailure = { ok: false, section: "records", form: "record-new", errors: { form: CAP }, values: {} };
    const doc = await render(RecordsAdmin, { records: full, failure });
    expect(text(doc.querySelector("#record-new [role=alert]"))).toBe(CAP);
    expect(doc.querySelector("#record-new .hint")).toBeNull();
    expect(text(doc.querySelector("#record-new")).split(CAP)).toHaveLength(2);
  });
});
