import { describe, expect, test } from "vitest";
import PhotographsAdmin from "../../src/components/admin/PhotographsAdmin.astro";
import type { ActionFailure } from "../../src/lib/admin/actions";
import type { AdminPhoto, AdminPost } from "../../src/lib/admin/store";
import { render, text } from "./render";

const photo = (id: string, over: Partial<AdminPhoto> = {}): AdminPhoto => ({
  id, title: "", published: true, rawReview: false, thumb: { url: `/admin/media/photos/previews/${id}/x/240.webp`, width: 160, height: 240 }, ...over,
});
const posts: AdminPost[] = [
  { collection: "newer", date: "2026-09-27", place: "bondi, sydney", photos: [photo("newer-01"), photo("newer-02", { published: false, rawReview: true }), photo("newer-03", { rawReview: true })] },
  { collection: "older", date: "2025-02-02", place: null, photos: [photo("older-01", { title: "the long jetty" })] },
];
const failure = (form: string, errors: Record<string, string>, values: Record<string, string> = {}): ActionFailure => ({ ok: false, section: "photographs", form, errors, values });

describe("PhotographsAdmin", () => {
  test("each post's summary gives its date, place, counts and how many await RAW review", async () => {
    const doc = await render(PhotographsAdmin, { posts, failure: null });
    expect([...doc.querySelectorAll("details > summary .what")].map(text)).toEqual(["27.09.26 · bondi, sydney · 3 photos, 2 published", "02.02.25 · 1 photo, 1 published"]);
    expect(text(doc.querySelector("#post-newer > summary .tagged"))).toBe("2 raw");
    expect(doc.querySelector("#post-older > summary .tagged")).toBeNull();
  });

  test("posts start closed; inside, the place, the post's buttons and each photo with its own", async () => {
    const doc = await render(PhotographsAdmin, { posts, failure: null });
    expect(doc.querySelector("#post-newer")!.hasAttribute("open")).toBe(false);
    expect(doc.querySelector<HTMLInputElement>("#post-newer-place")!.getAttribute("value")).toBe("bondi, sydney");
    expect(text(doc.querySelector("#post-newer-place-hint"))).toBe("area, city. leave it empty to show no place.");
    expect([...doc.querySelectorAll("#post-newer > .controls button")].map(text)).toEqual(["publish all 3", "hide all"]);
    const img = doc.querySelector("#photo-newer-01 img")!;
    expect([img.getAttribute("loading"), img.getAttribute("alt"), img.getAttribute("width")]).toEqual(["lazy", "", "160"]);
    expect(doc.querySelector("#photo-newer-01 button[aria-label]")!.getAttribute("aria-label")).toBe("hide newer-01");
    expect(doc.querySelector("#photo-newer-02 button[aria-label]")!.getAttribute("aria-label")).toBe("publish newer-02");
    expect(text(doc.querySelector("#photo-newer-02 .tagged"))).toBe("raw");
    expect(doc.querySelector<HTMLInputElement>("#photo-older-01-title")!.getAttribute("value")).toBe("the long jetty");
  });

  test("a failed photo form opens its post, with the message and what was typed", async () => {
    const doc = await render(PhotographsAdmin, { posts, failure: failure("photo-newer-02", { title: "80 characters at most" }, { id: "newer-02", title: "x".repeat(81) }) });
    expect(doc.querySelector("#post-newer")!.hasAttribute("open")).toBe(true);
    expect(doc.querySelector("#post-older")!.hasAttribute("open")).toBe(false);
    expect(doc.querySelector("#photo-newer-02-title")!.getAttribute("value")).toBe("x".repeat(81));
    expect(text(doc.querySelector("#photo-newer-02-title-error"))).toBe("80 characters at most");
  });

  test("a failed publish opens its post, with the message at the top", async () => {
    const doc = await render(PhotographsAdmin, { posts, failure: failure("post-older", { form: "1 photo couldn't be checked: older-01. publish the others one at a time." }) });
    expect(doc.querySelector("#post-older")!.hasAttribute("open")).toBe(true);
    expect(text(doc.querySelector('#post-older > [role="alert"]'))).toBe("1 photo couldn't be checked: older-01. publish the others one at a time.");
  });

  test("a photograph's own failure shows on its row, and one with no preview still has a place for it", async () => {
    const lost = [{ collection: "lost", date: "2026-01-02", place: null, photos: [photo("lost-01", { thumb: null })] }];
    const doc = await render(PhotographsAdmin, { posts: lost, failure: failure("photo-lost-01", { form: "that photo couldn't be checked (print master), so it stays hidden. run the import for it again." }) });
    expect(doc.querySelector("#post-lost")!.hasAttribute("open")).toBe(true);
    expect(text(doc.querySelector('#photo-lost-01 [role="alert"]'))).toBe("that photo couldn't be checked (print master), so it stays hidden. run the import for it again.");
    expect(doc.querySelector("#photo-lost-01 img")).toBeNull();
    expect(doc.querySelector("#photo-lost-01 .no-thumb")).not.toBeNull();
  });

  test("with nothing imported, it says how to import", async () => {
    const doc = await render(PhotographsAdmin, { posts: [], failure: null });
    expect(text(doc.querySelector(".empty"))).toBe("no photos imported yet. run photos:import from the mac.");
  });
});
