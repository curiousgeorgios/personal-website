import { describe, expect, test } from "vitest";
import LinksAdmin from "../../src/components/admin/LinksAdmin.astro";
import type { ActionFailure } from "../../src/lib/admin/actions";
import type { AdminLink } from "../../src/lib/admin/store";
import { render, text } from "./render";

// Made at 14:30 UTC on 7 October, which is the 8th in Sydney; works until 15.10.26
const LINK: AdminLink = { id: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", createdAt: "2026-10-07 14:30:00", expiresAt: 1792035000, note: "for mum" };
const props = (over: Record<string, unknown> = {}) => ({ links: [LINK], failure: null, issued: null, ...over });

describe("LinksAdmin", () => {
  test("the issue form carries a fresh 16-byte nonce on every render", async () => {
    const nonce = async () => (await render(LinksAdmin, props())).querySelector('#link-new input[name="nonce"]')!.getAttribute("value")!;
    const [one, two] = [await nonce(), await nonce()];
    expect(one).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(two).not.toBe(one);
  });

  test("the issue form asks for days (7 to start) and a note", async () => {
    const doc = await render(LinksAdmin, props());
    expect(doc.querySelector("#link-new-days")!.getAttribute("value")).toBe("7");
    expect(text(doc.querySelector("#link-new-note-hint"))).toBe("who it's for, so you know which to revoke");
  });

  test("an issued link is shown once, read-only, with a copy button the script reveals", async () => {
    const doc = await render(LinksAdmin, props({ issued: { url: "https://curiousgeorge.dev/photos/downloads?token=abc" } }));
    expect(text(doc.querySelector(".notice"))).toBe("here's the link. copy it now - it can't be shown again.");
    const field = doc.querySelector("#issued-link")!;
    expect([field.getAttribute("value"), field.hasAttribute("readonly")]).toEqual(["https://curiousgeorge.dev/photos/downloads?token=abc", true]);
    const copy = doc.querySelector('button[data-copy="issued-link"]')!;
    expect([text(copy), copy.hasAttribute("hidden")]).toEqual(["copy", true]);
  });

  test("a repeated form says the link was already made, and shows none", async () => {
    const doc = await render(LinksAdmin, props({ issued: { repeat: true } }));
    expect(text(doc.querySelector(".notice"))).toBe("that link was already made. it's in the list below, but it can't be shown again.");
    expect(doc.querySelector("#issued-link")).toBeNull();
  });

  test("each active link says when it was made, until when it works and its note, with a revoke form", async () => {
    const doc = await render(LinksAdmin, props());
    const row = doc.querySelector(`#link-${LINK.id}`)!;
    expect(text(row.querySelector("p"))).toBe("made 08.10.26 · works until 15.10.26 · for mum");
    expect(row.querySelector('input[name="intent"]')!.getAttribute("value")).toBe("link.revoke");
    expect(text(row.querySelector(".confirm"))).toBe("yes, switch this link off");
    expect(text(row.querySelector("button"))).toBe("revoke");
  });

  test("with no links working it says so", async () => {
    expect(text((await render(LinksAdmin, props({ links: [] }))).querySelector(".empty"))).toBe("no links are working right now.");
  });

  test("a failed issue reopens with what was typed and what's wrong", async () => {
    const failure: ActionFailure = { ok: false, section: "links", form: "link-new", errors: { days: "a number of days from 1 to 30" }, values: { days: "40", note: "for mum" } };
    const doc = await render(LinksAdmin, props({ failure }));
    expect(doc.querySelector("#link-new-days")!.getAttribute("value")).toBe("40");
    expect(text(doc.querySelector("#link-new-days-error"))).toBe("a number of days from 1 to 30");
  });
});
