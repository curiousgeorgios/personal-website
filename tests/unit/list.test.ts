import { parseHTML } from "linkedom";
import { describe, expect, test, vi } from "vitest";
import { bindList } from "../../src/deck/list";
import type { Deck, DeckState } from "../../src/deck/types";

const idle: DeckState = { want: null, current: null, browsed: 0, busy: false, playing: null, failed: null, scene: false };

function setup() {
  const window = parseHTML(
    `<ol class="tracks">${[0, 1, 2]
      .map((i) => `<li><button data-index="${i}" aria-pressed="false"><span class="side">a${i + 1}</span><span class="st">play</span></button></li>`)
      .join("")}</ol>`,
  );
  let listener: (state: DeckState) => void = () => {};
  const deck = {
    tracks: [],
    getState: () => idle,
    subscribe: (fn: (state: DeckState) => void) => {
      listener = fn;
      return () => {};
    },
    toggle: vi.fn(),
    browse: vi.fn(),
    setRate: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const list = window.document.querySelector(".tracks") as unknown as HTMLElement;
  bindList(list, deck as unknown as Deck);
  const rows = [...list.querySelectorAll("li")];
  // Events from linkedom's own window, so its elements dispatch them
  const event = (type: string, props: Record<string, unknown> = {}) => Object.assign(new window.Event(type), props);
  return { deck, rows, event, push: (state: Partial<DeckState>) => listener({ ...idle, ...state }) };
}

const st = (row: Element) => row.querySelector(".st")?.textContent;

describe("track list", () => {
  test("shows each record's state", () => {
    const { rows, push } = setup();
    push({ want: 0, busy: true });
    expect(rows.map(st)).toEqual(["cueing", "play", "play"]);
    push({ want: 0, current: 0, playing: 0 });
    expect(rows.map(st)).toEqual(["playing · stop", "play", "play"]);
    push({ failed: 2 });
    expect(rows.map(st)).toEqual(["play", "play", "couldn't play"]);
  });

  test("marks the wanted record as pressed and on", () => {
    const { rows, push } = setup();
    push({ want: 1 });
    expect(rows.map((row) => row.querySelector("button")?.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    expect(rows.map((row) => row.classList.contains("on"))).toEqual([false, true, false]);
  });

  test("marks the record in view only while a scene is attached", () => {
    const { rows, push } = setup();
    push({ browsed: 2 });
    expect(rows[2].classList.contains("browsed")).toBe(false);
    push({ browsed: 2, scene: true });
    expect(rows.map((row) => row.classList.contains("browsed"))).toEqual([false, false, true]);
  });

  test("a click toggles; a mouse hover or focus browses; a touch does not browse", () => {
    const { deck, rows, event } = setup();
    const button = rows[1].querySelector("button")!;
    button.dispatchEvent(event("click"));
    expect(deck.toggle).toHaveBeenCalledWith(1);
    button.dispatchEvent(event("pointerenter", { pointerType: "touch" }));
    expect(deck.browse).not.toHaveBeenCalled();
    button.dispatchEvent(event("pointerenter", { pointerType: "mouse" }));
    button.dispatchEvent(event("focus"));
    expect(deck.browse.mock.calls).toEqual([[1], [1]]);
  });
});
