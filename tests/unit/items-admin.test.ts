import { describe, expect, test } from "vitest";
import ItemFields from "../../src/components/admin/ItemFields.astro";
import ItemsAdmin from "../../src/components/admin/ItemsAdmin.astro";
import MoveForm from "../../src/components/admin/MoveForm.astro";
import RemoveForm from "../../src/components/admin/RemoveForm.astro";
import type { ActionFailure } from "../../src/lib/admin/actions";
import { formState } from "../../src/lib/admin/form-state";
import type { AdminItem } from "../../src/lib/admin/store";
import { render, text } from "./render";

const item = (over: Partial<AdminItem>): AdminItem => ({
  id: 1,
  slug: "digital-nachos",
  section: "now",
  position: 1,
  text: "growing [digital nachos](https://digitalnachos.com.au) with friends",
  aside: null,
  labelStatus: null,
  labelEra: null,
  labelMadeOf: null,
  labelText: null,
  labelKind: null,
  labelNote: null,
  snapshotUrl: null,
  snapshotAt: null,
  snapshotStatus: null,
  ...over,
});

const failure = (form: string, errors: Record<string, string>, values: Record<string, string> = {}): ActionFailure => ({
  ok: false,
  section: "now",
  form,
  errors,
  values,
});

describe("RemoveForm", () => {
  const props = { form: "item-4", intent: "item.remove", id: 4, confirm: "yes, remove this line", section: "now" };

  test("a failed remove marks the box invalid and ties it to the message", async () => {
    const doc = await render(RemoveForm, { ...props, error: "tick the box to confirm" });
    const box = doc.querySelector('input[name="confirm"]')!;
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(box.getAttribute("aria-describedby")).toBe("item-4-confirm-error");
    expect(text(doc.getElementById("item-4-confirm-error"))).toBe("tick the box to confirm");
  });

  test("a fresh remove has no error markup, and its box is required", async () => {
    const doc = await render(RemoveForm, props);
    const box = doc.querySelector('input[name="confirm"]')!;
    expect(box.hasAttribute("required")).toBe(true);
    expect(box.hasAttribute("aria-invalid")).toBe(false);
    expect(box.hasAttribute("aria-describedby")).toBe(false);
    expect(doc.querySelector(".error")).toBeNull();
  });
});

describe("MoveForm", () => {
  const props = { intent: "item.move", id: 4, name: "digital-nachos", section: "now" };
  const buttons = (doc: Document) => ({
    up: doc.querySelector<HTMLButtonElement>('button[value="up"]')!,
    down: doc.querySelector<HTMLButtonElement>('button[value="down"]')!,
  });

  test("the first line can't move up, the last can't move down", async () => {
    const first = buttons(await render(MoveForm, { ...props, first: true, last: false }));
    expect([first.up.hasAttribute("disabled"), first.down.hasAttribute("disabled")]).toEqual([true, false]);
    const last = buttons(await render(MoveForm, { ...props, first: false, last: true }));
    expect([last.up.hasAttribute("disabled"), last.down.hasAttribute("disabled")]).toEqual([false, true]);
    const only = buttons(await render(MoveForm, { ...props, first: true, last: true }));
    expect([only.up.hasAttribute("disabled"), only.down.hasAttribute("disabled")]).toEqual([true, true]);
  });

  test("the buttons are named for the line they move", async () => {
    const { up, down } = buttons(await render(MoveForm, { ...props, first: false, last: false }));
    expect(up.getAttribute("aria-label")).toBe("move digital-nachos up");
    expect(down.getAttribute("aria-label")).toBe("move digital-nachos down");
  });
});

describe("ItemFields", () => {
  const state = formState(null, "item-new-now", { section: "now", slug: "", text: "" });

  test("an edit form chooses the section", async () => {
    const doc = await render(ItemFields, { form: "item-4", state });
    expect(doc.querySelector('select[name="section"]')).not.toBeNull();
  });

  test("an add form is fixed to its own section, so a failure reopens the form the browser scrolled to", async () => {
    const doc = await render(ItemFields, { form: "item-new-now", state, chooseSection: false });
    expect(doc.querySelector('select[name="section"]')).toBeNull();
    expect(doc.querySelector('input[type="hidden"][name="section"]')?.getAttribute("value")).toBe("now");
  });
});

describe("ItemsAdmin", () => {
  test("a collapsed line shows its link text, not the bracket and address syntax; the textarea keeps the raw text", async () => {
    const doc = await render(ItemsAdmin, { section: "now", items: [item({})], failure: null });
    expect(text(doc.querySelector(".entry summary .what"))).toBe("growing digital nachos with friends");
    expect(doc.querySelector<HTMLTextAreaElement>("#item-1-text")?.textContent).toBe("growing [digital nachos](https://digitalnachos.com.au) with friends");
  });

  test("a failed form says how many things to fix, at the top of what opened; others say nothing", async () => {
    const doc = await render(ItemsAdmin, {
      section: "now",
      items: [item({}), item({ id: 2, slug: "second" })],
      failure: failure("item-2", { slug: "that slug is taken", snapshot_url: "use an https:// address" }),
    });
    const alert = doc.querySelector("#item-2 > [role=alert]");
    expect(text(alert)).toBe("2 things to fix below");
    expect(alert?.previousElementSibling?.tagName).toBe("SUMMARY");
    expect(doc.querySelectorAll("[role=alert]")).toHaveLength(1);
  });

  test("one error reads in the singular, on the add form too", async () => {
    const doc = await render(ItemsAdmin, {
      section: "now",
      items: [],
      failure: failure("item-new-now", { slug: "that slug is taken" }, { section: "now", slug: "taken", text: "x" }),
    });
    expect(text(doc.querySelector("#item-new-now > [role=alert]"))).toBe("1 thing to fix below");
    expect(doc.getElementById("item-new-now")?.hasAttribute("open")).toBe(true);
  });

  test("a failed remove counts as one thing to fix", async () => {
    const doc = await render(ItemsAdmin, {
      section: "now",
      items: [item({})],
      failure: failure("item-1", { confirm: "tick the box to confirm" }),
    });
    expect(text(doc.querySelector("#item-1 > [role=alert]"))).toBe("1 thing to fix below");
  });
});
