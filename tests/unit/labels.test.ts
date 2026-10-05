import { expect, test } from "vitest";
import ItemLines from "../../src/components/ItemLines.astro";
import type { Item } from "../../src/lib/logbook";
import { render, text } from "./render";

const items: Item[] = [
  {
    slug: "canberra-events", section: "now", text: "building [canberra.events](https://canberra.events)", aside: null,
    label: { era: "2025 to now", status: "live", madeOf: "a city calendar", text: "one calendar.", kind: "decision", note: "start with organisers.", snapshotKey: "snapshots/fixture-canberra-events" },
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

test("a line with a snapshot gets a hover card that waits to load, and a framed, lazy snapshot in its label", async () => {
  const doc = await render(ItemLines, { items });
  const item = doc.querySelector('[data-slug="canberra-events"]')!;
  const card = item.querySelector(".peekwrap > .hovercard")!;
  expect(card.getAttribute("aria-hidden")).toBe("true");
  expect(card.querySelector("source")!.getAttribute("data-srcset")).toBe("/media/snapshots/fixture-canberra-events-480.avif");
  expect(card.querySelector("source")!.hasAttribute("srcset")).toBe(false);
  expect(card.querySelector("img")!.getAttribute("data-src")).toBe("/media/snapshots/fixture-canberra-events-480.webp");
  expect(card.querySelector("img")!.hasAttribute("src")).toBe(false);
  expect(text(card.querySelector(".cap"))).toBe("click for the label");
  const frame = item.querySelector(".drawer .wall.framed > button.frame")!;
  expect(frame.getAttribute("aria-label")).toBe("look closer at canberra.events");
  expect(frame.getAttribute("data-closer-avif")).toBe("/media/snapshots/fixture-canberra-events-1920.avif");
  expect(frame.getAttribute("data-closer-webp")).toBe("/media/snapshots/fixture-canberra-events-1920.webp");
  expect(frame.querySelector("source")!.getAttribute("srcset")).toBe(
    "/media/snapshots/fixture-canberra-events-480.avif 480w, /media/snapshots/fixture-canberra-events-960.avif 960w",
  );
  const img = frame.querySelector("img")!;
  expect(img.getAttribute("loading")).toBe("lazy");
  expect(img.getAttribute("src")).toBe("/media/snapshots/fixture-canberra-events-480.webp");
  expect(img.getAttribute("alt")).toBe("a snapshot of canberra.events");
});

test("a line without a snapshot has no hover card and no frame", async () => {
  const doc = await render(ItemLines, { items });
  const item = doc.querySelector('[data-slug="onestack"]')!;
  expect(item.querySelector(".hovercard")).toBeNull();
  expect(item.querySelector(".frame")).toBeNull();
  expect(item.querySelector(".wall")!.classList.contains("framed")).toBe(false);
});
