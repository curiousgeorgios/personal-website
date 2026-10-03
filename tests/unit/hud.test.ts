import { parseHTML } from "linkedom";
import { describe, expect, test, vi } from "vitest";
import { createHud } from "../../src/deck/scene/hud";
import type { Deck, DeckState } from "../../src/deck/types";

const idle: DeckState = { want: null, current: null, browsed: 0, busy: false, playing: null, failed: null, scene: true };

function setup(titles = ["simple things", "nyc in 1940", "light it up"], state: Partial<DeckState> = {}) {
  const window = parseHTML('<div class="deck"></div>');
  const host = window.document.querySelector(".deck") as unknown as HTMLElement;
  const current = { ...idle, ...state };
  const deck = {
    tracks: titles.map((title) => ({ title, artist: "x", src: "", cover: "" })),
    getState: () => current,
    toggle: vi.fn(),
    browse: vi.fn(),
  };
  const hud = createHud(host, deck as unknown as Deck);
  const button = (act: string) => host.querySelector(`[data-act="${act}"]`)!;
  const event = (type: string, props: Record<string, unknown> = {}) => Object.assign(new window.Event(type), props);
  const click = (act: string) => button(act).dispatchEvent(event("click"));
  return { hud, deck, host, button, click, event };
}

const arrows = (button: (act: string) => Element) => [button("prev").getAttribute("aria-disabled"), button("next").getAttribute("aria-disabled")];

describe("crate control", () => {
  test("is a named group of three buttons", () => {
    const { host } = setup();
    const group = host.querySelector(".crate-hud")!;
    expect([group.getAttribute("role"), group.getAttribute("aria-label")]).toEqual(["group", "record crate"]);
    expect([...group.querySelectorAll("button")].map((b) => b.getAttribute("data-act"))).toEqual(["prev", "play", "next"]);
    expect([...group.querySelectorAll("button")].map((b) => b.getAttribute("type"))).toEqual(["button", "button", "button"]);
  });

  test("always shows the browsed title; the icon state and the name say what a press does", () => {
    const { hud, button } = setup();
    const play = button("play");
    hud.render({ ...idle, browsed: 1 });
    expect([play.textContent, play.getAttribute("data-state"), play.getAttribute("aria-label")]).toEqual(["nyc in 1940", "play", "play nyc in 1940"]);
    hud.render({ ...idle, browsed: 1, want: 1, current: 1, busy: true });
    expect([play.textContent, play.getAttribute("data-state"), play.getAttribute("aria-label")]).toEqual(["nyc in 1940", "cueing", "cueing nyc in 1940"]);
    hud.render({ ...idle, browsed: 1, want: 1, current: 1, playing: 1 });
    expect([play.textContent, play.getAttribute("data-state"), play.getAttribute("aria-label")]).toEqual(["nyc in 1940", "stop", "stop nyc in 1940"]);
    expect(play.getAttribute("title")).toBe("nyc in 1940");
  });

  test("arrows are aria-disabled at either end and while a record travels, never disabled", () => {
    const { hud, button } = setup();
    hud.render(idle);
    expect(arrows(button)).toEqual(["true", "false"]);
    hud.render({ ...idle, browsed: 2 });
    expect(arrows(button)).toEqual(["false", "true"]);
    hud.render({ ...idle, browsed: 1, busy: true });
    expect(arrows(button)).toEqual(["true", "true"]);
    expect(button("prev").hasAttribute("disabled")).toBe(false);
  });

  test("with one record both arrows are disabled and play still works", () => {
    const { hud, button, click, deck } = setup(["only one"]);
    hud.render(idle);
    expect(arrows(button)).toEqual(["true", "true"]);
    click("next");
    click("play");
    expect(deck.browse).not.toHaveBeenCalled();
    expect(deck.toggle).toHaveBeenCalledWith(0);
  });

  test("arrows browse by one and the arrow keys flip", () => {
    const { hud, click, deck, host, event } = setup(undefined, { browsed: 1 });
    hud.render({ ...idle, browsed: 1 });
    click("next");
    click("prev");
    host.querySelector(".crate-hud")!.dispatchEvent(event("keydown", { key: "ArrowRight" }));
    expect(deck.browse.mock.calls).toEqual([[2], [0], [2]]);
  });

  test("hint shades the button a click on the scene would press", () => {
    const { hud, button } = setup();
    hud.hint("next");
    expect(["prev", "play", "next"].map((act) => button(act).classList.contains("hint"))).toEqual([false, false, true]);
    hud.hint(null);
    expect(["prev", "play", "next"].some((act) => button(act).classList.contains("hint"))).toBe(false);
  });
});
