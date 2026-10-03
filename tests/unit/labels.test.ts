import { expect, test } from "vitest";
import ItemLines from "../../src/components/ItemLines.astro";
import type { Item } from "../../src/lib/logbook";
import { render, text } from "./render";

const items: Item[] = [
  {
    slug: "canberra-events", section: "now", text: "building [canberra.events](https://canberra.events)", aside: null,
    label: { era: "2025 to now", status: "live", madeOf: "a city calendar", text: "one calendar.", kind: "decision", note: "start with organisers.", snapshotKey: null },
  },
  {
    slug: "onestack", section: "before", text: "founded [onestack.cloud](https://onestack.cloud)", aside: null,
    label: { era: "founder", status: "retired", madeOf: null, text: null, kind: null, note: null, snapshotKey: null },
  },
  { slug: "kpmg", section: "before", text: "management consulting at kpmg", aside: null, label: null },
];

test("labelled lines get a named pill and a hidden-until-found drawer", async () => {
  const doc = await render(ItemLines, { items });
  const pill = doc.querySelector('[data-slug="canberra-events"] .peek')!;
  expect(pill.getAttribute("aria-label")).toBe("label for canberra.events");
  expect(pill.getAttribute("aria-expanded")).toBe("false");
  expect(pill.getAttribute("aria-controls")).toBe("label-canberra-events");
  const drawer = doc.querySelector("#label-canberra-events")!;
  expect(drawer.getAttribute("hidden")).toBe("until-found");
  expect(text(drawer.querySelector(".status"))).toBe("live and in use · 2025 to now");
  expect(text(drawer.querySelector(".made"))).toBe("made of a city calendar");
  expect(text(drawer.querySelector(".decision span"))).toBe("the decision");
  expect(drawer.querySelector(".decision")!.lastChild!.textContent).toBe("start with organisers.");
});

test("partial labels render only the fields they have", async () => {
  const doc = await render(ItemLines, { items });
  const drawer = doc.querySelector("#label-onestack")!;
  expect(text(drawer.querySelector(".status"))).toBe("retired · founder");
  expect(drawer.querySelector(".made")).toBeNull();
  expect(drawer.querySelector(".decision")).toBeNull();
});

test("a label without an era has no dangling separator", async () => {
  const doc = await render(ItemLines, { items: [{ ...items[1], slug: "no-era", label: { ...items[1].label!, era: "" } }] });
  expect(text(doc.querySelector("#label-no-era .status"))).toBe("retired");
});

test("lines without a label get no pill", async () => {
  const doc = await render(ItemLines, { items });
  expect(doc.querySelector('[data-slug="kpmg"] .peek')).toBeNull();
  expect(doc.querySelector('[data-slug="kpmg"]')!.classList.contains("labelled")).toBe(false);
});
