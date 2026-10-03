import { expect, test } from "vitest";
import Log from "../../src/components/Log.astro";
import type { LogEntry } from "../../src/lib/logbook";
import { render, text } from "./render";

const entries = (n: number): LogEntry[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, date: `2026-0${9 - i}-01`, precision: "month" as const, text: `entry ${i + 1}.` }));

test("three or fewer entries render with no toggle", async () => {
  const doc = await render(Log, { entries: entries(3) });
  expect(doc.querySelectorAll(".log li")).toHaveLength(3);
  expect(doc.querySelector(".more")).toBeNull();
  expect(doc.querySelector(".older")).toBeNull();
});

test("more than three entries tuck the rest behind a toggle", async () => {
  const doc = await render(Log, { entries: entries(5) });
  expect(doc.querySelectorAll(".log > ul > li")).toHaveLength(3);
  expect(doc.querySelector("#older-entries")!.getAttribute("hidden")).toBe("until-found");
  expect(doc.querySelectorAll("#older-entries li")).toHaveLength(2);
  expect(text(doc.querySelector(".more .lbl"))).toBe("older entries");
  expect(doc.querySelector(".more")!.getAttribute("aria-expanded")).toBe("false");
});
