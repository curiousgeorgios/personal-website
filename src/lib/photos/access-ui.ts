// What the downloads page's sign-in says (spec 5.2 as amended). Pure, so the browser script and the unit tests share it;
// every message is the site's own, whatever the server's error text, so the page keeps one voice.

export const SIGN_IN_DOWN = "signing in isn't working right now. try again in a bit.";
/** After a code is asked for, whether or not the address is approved: the server's own sentence, which never says which */
export const CODE_SENT = "if this email address has been approved, a sign-in code will arrive shortly.";

export type CodeRequest = { ok: true; message: string; resendAfter: number } | { ok: false; error: string; retryAfter: number };
export type SessionAttempt = { ok: true } | { ok: false; error: string; retryAfter: number };

const seconds = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.ceil(value) : fallback);
/** Retry-After as seconds; a date or anything unreadable gives the fallback */
export const retryAfterOf = (header: string | null, fallback = 60) => (header && /^\d{1,6}$/.test(header.trim()) ? Number(header.trim()) : fallback);

/** in 10 minutes, in 1 minute, in 45 seconds */
export function inTime(total: number): string {
  if (total >= 60 && total % 60 === 0) return `${total / 60} minute${total === 60 ? "" : "s"}`;
  return `${total} second${total === 1 ? "" : "s"}`;
}

/** POST /api/photos/access/code's answer, as the page says it */
export function codeRequestOutcome(status: number, body: unknown, retryAfter: string | null): CodeRequest {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (status === 202) {
    const expiresIn = seconds(record.expiresIn, 600);
    return { ok: true, message: `${CODE_SENT} it works for ${inTime(expiresIn)}, once.`, resendAfter: seconds(record.resendAfter, 60) };
  }
  if (status === 400) return { ok: false, error: "that doesn't look like an email address. check it and try again.", retryAfter: 0 };
  if (status === 429) {
    const wait = retryAfterOf(retryAfter);
    return { ok: false, error: `that's a lot of codes in a short time. try again in ${inTime(wait)}.`, retryAfter: wait };
  }
  return { ok: false, error: SIGN_IN_DOWN, retryAfter: 0 };
}

/** POST /api/photos/access/session's answer, as the page says it */
export function sessionOutcome(status: number, body: unknown, retryAfter: string | null): SessionAttempt {
  if (status === 200 && body && typeof body === "object" && (body as Record<string, unknown>).authenticated === true) return { ok: true };
  if (status === 400) return { ok: false, error: "the code is the six digits in the email.", retryAfter: 0 };
  if (status === 403) return { ok: false, error: "that code didn't work. it may be mistyped, used or out of date. check it, or send a new one.", retryAfter: 0 };
  if (status === 429) {
    const wait = retryAfterOf(retryAfter);
    return { ok: false, error: `too many tries. send a new code in ${inTime(wait)}.`, retryAfter: wait };
  }
  return { ok: false, error: SIGN_IN_DOWN, retryAfter: 0 };
}

/** The resend button's words while it waits: send a new code in 42s, then send a new code */
export const resendLabel = (left: number) => (left > 0 ? `send a new code in ${left}s` : "send a new code");

/** What a pasted or typed code becomes: its digits, at most six */
export const codeDigits = (value: string) => value.replace(/\D/g, "").slice(0, 6);
