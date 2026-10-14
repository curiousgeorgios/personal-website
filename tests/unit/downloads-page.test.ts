import { describe, expect, test } from "vitest";
import Downloads from "../../src/components/photos/Downloads.astro";
import type { Entry, PublicPhoto } from "../../src/lib/photos/store";
import { render, text } from "./render";

const photo = (id: string, bytes: number): PublicPhoto => ({
  id, collection: "post", title: "", width: 4000, height: 6000, downloadBytes: bytes, date: "2025-02-02", place: "bondi, sydney",
  previews: (["webp", "avif"] as const).map((format) => ({ url: `/media/photos/previews/${id}/s/240.${format}`, width: 160, height: 240, format })),
});
const ENTRIES: Entry[] = [{ collection: "post", date: "2025-02-02", place: "bondi, sydney", publishedAt: 1738488468, photos: [photo("post-01", 12_400_000), photo("post-02", 960_000)] }];
// 03:30 UTC on 28 October 2026 is 2:30 pm in Sydney (AEDT)
const ok = (over: Record<string, unknown> = {}) => ({ view: { state: "ok", entries: ENTRIES, expiresAt: 1793158200, ...over } });
const labels = (doc: Document) => [...doc.querySelectorAll(".row > .label")].map(text);
const scripts = (doc: Document) => [...doc.querySelectorAll("script")].map((script) => script.getAttribute("src"));

describe("Downloads, signed in", () => {
  test("lists every photo under its entry's heading, each a plain download of its full-resolution jpeg", async () => {
    const doc = await render(Downloads, ok());
    expect(labels(doc)).toEqual(["downloads", "entries"]);
    expect(text(doc.querySelector("h1"))).toBe("photos, full size");
    expect(text(doc.querySelector("#post-post .entry-head"))).toBe("02.02.25 · bondi, sydney");
    const links = [...doc.querySelectorAll(".download-list a")];
    // The browser's session cookie lets them through: no token, code or address in any address on the page
    expect(links.map((a) => [a.getAttribute("href"), a.getAttribute("download"), text(a)])).toEqual([
      ["/photos/downloads/post-01", "post-01.jpg", "download jpeg · 12.4 mb, photo 1 of 2 from 02.02.25"],
      ["/photos/downloads/post-02", "post-02.jpg", "download jpeg · 1.0 mb, photo 2 of 2 from 02.02.25"],
    ]);
    expect(doc.querySelector('[href*="?"], [href*="token"], [src*="token"]')).toBeNull();
    // Each link's name says which photograph, in text only a screen reader reads, so a list of links tells them apart
    expect(links[0].querySelector(".sr-only")!.textContent).toBe(", photo 1 of 2 from 02.02.25");
    const img = doc.querySelector(".download-list img")!;
    expect([img.getAttribute("loading"), img.getAttribute("alt"), img.getAttribute("src")]).toEqual(["lazy", "photo 1 of 2 from 2 february 2025, bondi, sydney", "/media/photos/previews/post-01/s/240.webp"]);
  });

  test("says until when this browser is signed in, in sydney time, on either side of daylight saving", async () => {
    expect(text((await render(Downloads, ok())).querySelector(".intro"))).toBe(
      "full-resolution jpegs of every photo in the gallery. this browser is signed in until 28.10.26, 2:30 pm sydney time. please keep them to yourself.",
    );
    // 04:30 UTC in June is 2:30 pm in Sydney's winter (AEST)
    expect(text((await render(Downloads, ok({ expiresAt: 1781497800 }))).querySelector(".intro"))).toContain("signed in until 15.06.26, 2:30 pm sydney time.");
  });

  test("hands the script the session's end and a sign-out it reveals; without it, says the session ends by itself", async () => {
    const doc = await render(Downloads, ok());
    const main = doc.querySelector("main.downloads")!;
    expect([main.getAttribute("data-access"), main.getAttribute("data-expires")]).toEqual(["ok", "1793158200"]);
    const signOut = doc.querySelector("form#access-signout")!;
    expect([signOut.hasAttribute("hidden"), text(signOut.querySelector("button"))]).toEqual([true, "sign out"]);
    // The script sends a DELETE; should it ever submit natively it posts to the same-origin JSON route, never a get
    expect([signOut.getAttribute("method"), signOut.getAttribute("action")]).toEqual(["post", "/api/photos/access/session"]);
    expect(text(doc.querySelector("noscript"))).toBe("signing out needs javascript. this browser's session ends by itself at that time.");
    expect(scripts(doc)).toEqual([expect.stringContaining("Downloads.astro?astro&type=script")]);
    expect(doc.querySelector("#access-email, #access-code")).toBeNull();
  });

  test("a session with nothing published says so", async () => {
    const doc = await render(Downloads, ok({ entries: [] }));
    expect(text(doc.querySelector("#entries .empty"))).toBe("no photos up yet.");
  });
});

describe("Downloads, signed out", () => {
  test("offers the sign-in in two steps the script reveals, and lists nothing", async () => {
    const doc = await render(Downloads, { view: { state: "signin" } });
    expect(labels(doc)).toEqual(["downloads"]);
    expect(text(doc.querySelector("h1"))).toBe("photos, full size");
    expect(text(doc.querySelector(".intro"))).toBe(
      "full-resolution jpegs of george's photos, for the people he has approved. sign in with your approved email address and a six-digit code will be sent to it.",
    );
    expect(doc.querySelector(".download-list, #entries")).toBeNull();
    expect(doc.querySelector("main")!.getAttribute("data-access")).toBe("signin");
    const [emailForm, codeForm] = [doc.querySelector("form#access-email")!, doc.querySelector("form#access-code")!];
    // Hidden until the script runs, and never a get form: should one submit natively (JavaScript turned off after the
    // script showed it) it posts to its same-origin JSON route, which refuses a form post, so an address or code can't
    // end up in a URL
    expect([emailForm, codeForm].map((form) => [form.hasAttribute("hidden"), form.getAttribute("method"), form.getAttribute("action")])).toEqual([
      [true, "post", "/api/photos/access/code"],
      [true, "post", "/api/photos/access/session"],
    ]);
  });

  test("labels both fields for the keyboard, autofill and one-time codes, with their errors tied to them", async () => {
    const doc = await render(Downloads, { view: { state: "signin" } });
    const email = doc.querySelector("#access-email-address")!;
    expect(text(doc.querySelector('label[for="access-email-address"]'))).toBe("email address");
    expect(["type", "autocomplete", "autocapitalize", "spellcheck", "required"].map((name) => email.getAttribute(name))).toEqual(["email", "email", "none", "false", ""]);
    expect(email.getAttribute("aria-describedby")).toBe("access-email-error");
    expect(doc.querySelector("#access-email-error")!.getAttribute("role")).toBe("alert");
    expect(text(doc.querySelector("#access-email button[type=submit]"))).toBe("send a code");
    const code = doc.querySelector("#access-code-digits")!;
    expect(text(doc.querySelector('label[for="access-code-digits"]'))).toBe("six-digit code");
    expect(["inputmode", "autocomplete", "pattern", "maxlength"].map((name) => code.getAttribute(name))).toEqual(["numeric", "one-time-code", "[0-9]{6}", "6"]);
    expect(code.getAttribute("aria-describedby")).toBe("access-code-sent access-code-error");
    expect(doc.querySelector("#access-code-sent")!.getAttribute("role")).toBe("status");
    expect([...doc.querySelectorAll("#access-code button")].map(text)).toEqual(["sign in", "send a new code", "use a different address"]);
    // The resend starts disabled: the script counts down the server's 60 seconds before it opens
    expect(doc.querySelector("#access-code [data-resend]")!.hasAttribute("disabled")).toBe(true);
  });

  test("says honestly that signing in needs JavaScript, and how to ask for approval", async () => {
    const doc = await render(Downloads, { view: { state: "signin" } });
    expect(text(doc.querySelector("noscript"))).toBe("signing in needs javascript, which is off in this browser. turn it on for this page to sign in.");
    const ask = doc.querySelector(".row .where")!;
    expect(text(ask)).toBe("not approved yet? ask george at hello@curiousgeorge.dev.");
    expect(ask.querySelector("a")!.getAttribute("href")).toBe("mailto:hello@curiousgeorge.dev");
    expect(doc.querySelector("[data-access-status]")!.getAttribute("role")).toBe("status");
  });
});

test("when downloads aren't working it says so, and offers nothing", async () => {
  const doc = await render(Downloads, { view: { state: "down" } });
  expect(text(doc.querySelector("h1"))).toBe("photos, full size");
  expect(text(doc.querySelector(".intro"))).toBe("downloads aren't working right now. try again in a bit.");
  expect(doc.querySelector(".download-list, form, noscript")).toBeNull();
});
