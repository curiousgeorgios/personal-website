import { describe, expect, test } from "vitest";
import AccessAdmin from "../../src/components/admin/AccessAdmin.astro";
import { render, text } from "./render";

// Approved at 14:30 UTC on 7 October, which is the 8th in Sydney
const APPROVALS = [
  { id: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", email: "mum@example.com", createdAt: "2026-10-07 14:30:00" },
  { id: "0a1b2c3d-4e5f-4061-8273-94a5b6c7d8e9", email: "a.friend@example.org", createdAt: 1791383400 },
];

describe("AccessAdmin", () => {
  test("approves an address with a plain email field the script reveals, and says that approving sends nothing", async () => {
    const doc = await render(AccessAdmin, { approvals: APPROVALS });
    const form = doc.querySelector("form#access-new")!;
    expect([form.hasAttribute("hidden"), form.hasAttribute("data-access-approve")]).toEqual([true, true]);
    expect(text(form.querySelector("h3"))).toBe("approve an email address");
    const field = doc.querySelector("#access-new-email")!;
    expect(["type", "autocapitalize", "autocorrect", "spellcheck", "maxlength"].map((name) => field.getAttribute(name))).toEqual(["email", "none", "off", "false", "254"]);
    expect(text(doc.querySelector('label[for="access-new-email"]'))).toBe("email address");
    expect(text(doc.querySelector("#access-new-email-hint"))).toBe(
      "they sign in at /photos/downloads with a code sent to this address, for 14 days at a time. approving sends nothing: share the page with them yourself.",
    );
    expect(text(form.querySelector("button[type=submit]"))).toBe("approve");
    expect(doc.querySelector("#access-new-error")!.getAttribute("role")).toBe("alert");
  });

  test("lists each approved address with the day it was approved and a revoke that asks first", async () => {
    const doc = await render(AccessAdmin, { approvals: APPROVALS });
    const rows = [...doc.querySelectorAll(".access-admin .entry")];
    expect(rows.map((row) => text(row.querySelector("p")))).toEqual(["mum@example.com · approved 08.10.26", "a.friend@example.org · approved 08.10.26"]);
    const revoke = rows[0].querySelector("form[data-access-revoke]")!;
    expect([revoke.getAttribute("data-access-revoke"), revoke.hasAttribute("hidden")]).toEqual([APPROVALS[0].id, true]);
    expect(text(revoke.querySelector(".confirm"))).toBe("yes, stop this address signing in");
    expect(revoke.querySelector('input[type="checkbox"]')!.getAttribute("aria-describedby")).toBe(`access-${APPROVALS[0].id}-error`);
    expect(text(revoke.querySelector("button"))).toBe("revoke");
    // Never a get form, and never the admin form handler: should one submit natively it posts to the owner's JSON route,
    // which refuses a form post, so no address ends up in a URL
    for (const form of doc.querySelectorAll("form")) expect([form.getAttribute("method"), form.getAttribute("action")]).toEqual(["post", "/admin/photos/access"]);
  });

  test("says when no one is approved, when the list couldn't load, and what needs JavaScript", async () => {
    expect(text((await render(AccessAdmin, { approvals: [] })).querySelector(".empty"))).toBe("no one is approved yet.");
    const down = await render(AccessAdmin, { approvals: null });
    expect([...down.querySelectorAll("p.error:not([hidden])")].map(text)).toContain("the approved addresses couldn't load. reload the page to try again.");
    expect(text(down.querySelector("noscript"))).toBe("approving and revoking need javascript, which is off in this browser.");
  });
});
