import { describe, expect, test } from "vitest";
import { CODE_SENT, codeDigits, codeRequestOutcome, inTime, resendLabel, retryAfterOf, sessionOutcome, SIGN_IN_DOWN } from "../../src/lib/photos/access-ui";

describe("asking for a code", () => {
  test("a 202 says the server's same sentence for every address, how long the code lasts and when to resend", () => {
    expect(codeRequestOutcome(202, { message: "If this email address has been approved, a sign-in code will arrive shortly.", expiresIn: 600, resendAfter: 60 }, null)).toEqual({
      ok: true, message: `${CODE_SENT} it works for 10 minutes, once.`, resendAfter: 60,
    });
    // Missing numbers fall back to the contract's 10 minutes and 60 seconds
    expect(codeRequestOutcome(202, null, null)).toEqual({ ok: true, message: `${CODE_SENT} it works for 10 minutes, once.`, resendAfter: 60 });
  });

  test("never echoes the server's error text, so an unapproved address and an approved one read the same", () => {
    expect(codeRequestOutcome(400, { error: "Bad email." }, null)).toEqual({ ok: false, error: "that doesn't look like an email address. check it and try again.", retryAfter: 0 });
    expect(codeRequestOutcome(429, { error: "Too many." }, "45")).toEqual({ ok: false, error: "that's a lot of codes in a short time. try again in 45 seconds.", retryAfter: 45 });
    for (const status of [500, 503, 404]) expect(codeRequestOutcome(status, { error: "x" }, null)).toEqual({ ok: false, error: SIGN_IN_DOWN, retryAfter: 0 });
  });
});

describe("signing in with a code", () => {
  test("only an authenticated 200 signs in", () => {
    expect(sessionOutcome(200, { authenticated: true, expiresAt: 1793158200 }, null)).toEqual({ ok: true });
    expect(sessionOutcome(200, { authenticated: false }, null)).toEqual({ ok: false, error: SIGN_IN_DOWN, retryAfter: 0 });
  });

  test("a wrong, used or old code says so without saying which; too many tries waits as long as the server asks", () => {
    expect(sessionOutcome(403, { error: "Invalid code." }, null)).toEqual({ ok: false, error: "that code didn't work. it may be mistyped, used or out of date. check it, or send a new one.", retryAfter: 0 });
    expect(sessionOutcome(400, null, null)).toEqual({ ok: false, error: "the code is the six digits in the email.", retryAfter: 0 });
    expect(sessionOutcome(429, null, "120")).toEqual({ ok: false, error: "too many tries. send a new code in 2 minutes.", retryAfter: 120 });
    expect(sessionOutcome(503, null, null)).toEqual({ ok: false, error: SIGN_IN_DOWN, retryAfter: 0 });
  });
});

describe("the words and the code field", () => {
  test("counts down the resend, then opens it", () => {
    expect([resendLabel(60), resendLabel(1), resendLabel(0)]).toEqual(["send a new code in 60s", "send a new code in 1s", "send a new code"]);
  });

  test("reads Retry-After as seconds, and anything else as the fallback", () => {
    expect([retryAfterOf("30"), retryAfterOf(" 7 "), retryAfterOf("Wed, 21 Oct 2026 07:28:00 GMT"), retryAfterOf(null), retryAfterOf("-1", 90)]).toEqual([30, 7, 60, 60, 90]);
  });

  test("says durations in plain words", () => {
    expect([inTime(600), inTime(60), inTime(45), inTime(1), inTime(90)]).toEqual(["10 minutes", "1 minute", "45 seconds", "1 second", "90 seconds"]);
  });

  test("keeps a typed or pasted code to its six digits", () => {
    expect([codeDigits("123 456"), codeDigits("12-34-56-78"), codeDigits("abc"), codeDigits("０12345")]).toEqual(["123456", "123456", "", "12345"]);
  });
});
