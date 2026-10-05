import { parseHTML } from "linkedom";
import { describe, expect, test } from "vitest";
import { playedProperties, trackOf, upgradeRows } from "../../src/deck/rows";

// Two rows as Turntable.astro renders them; the second has no id
const html = `<ol class="tracks">
  <li><a class="pick" href="/media/audio/a.mp3" data-index="0" data-id="1" data-src="/media/audio/a.mp3" data-cover="/media/covers/a.webp" data-title="simple things" data-artist="loom room"><span class="side mono">a1</span> <span class="tt">simple things <span class="aside">- loom room</span></span> <span class="st mono">play</span></a></li>
  <li><a class="pick" href="/media/audio/b.mp3" data-index="1" data-src="/media/audio/b.mp3" data-cover="/media/covers/b.webp" data-title="nyc in 1940" data-artist="berlioz"><span class="side mono">a2</span> <span class="tt">nyc in 1940</span> <span class="st mono">play</span></a></li>
</ol>`;
const list = () => parseHTML(html).document.querySelector(".tracks") as unknown as HTMLElement;

describe("upgradeRows", () => {
  test("turns each track's link into a play button with the same data and words, and no address", () => {
    const tracks = list();
    const buttons = upgradeRows(tracks);
    expect(tracks.querySelectorAll("a")).toHaveLength(0);
    expect(buttons).toHaveLength(2);
    const [first] = buttons;
    expect(first.tagName).toBe("BUTTON");
    expect(first.getAttribute("type")).toBe("button");
    expect(first.getAttribute("class")).toBe("pick");
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(first.hasAttribute("href")).toBe(false);
    expect([first.dataset.index, first.dataset.id, first.dataset.src, first.dataset.title]).toEqual(["0", "1", "/media/audio/a.mp3", "simple things"]);
    expect(first.querySelector(".st")?.textContent).toBe("play");
    expect(first.textContent?.replace(/\s+/g, " ").trim()).toBe("a1 simple things - loom room play");
  });

  test("leaves buttons that are already buttons alone", () => {
    const tracks = list();
    upgradeRows(tracks);
    expect(upgradeRows(tracks)).toHaveLength(2);
  });
});

test("a row's track is what the runner plays", () => {
  const [first] = upgradeRows(list());
  expect(trackOf(first)).toEqual({ title: "simple things", artist: "loom room", src: "/media/audio/a.mp3", cover: "/media/covers/a.webp" });
});

test("record_played carries the record's id, and a row without one is still counted, without it", () => {
  expect(playedProperties("1")).toEqual({ record_id: 1 });
  expect(playedProperties(undefined)).toEqual({});
  expect(playedProperties("not a number")).toEqual({});
});
