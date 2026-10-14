import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { sqliteD1 } from "./sqlite-d1";
import { CHALLENGE_COOKIE, CODE_SECONDS, SESSION_COOKIE, SESSION_SECONDS, approveEmail, approvedEmails, cleanPhotoAccess, logoutPhotoSession, normaliseEmail, photoSession, requestPhotoCode, revokeEmail, verifyPhotoCode, type PhotoAccessDeps } from "../../src/lib/photos/access";
import { logoutResponse, requestCodeResponse, sessionResponse, verifyCodeResponse } from "../../src/lib/photos/access-http";

const SECRET = "a1".repeat(32), EMAIL = "person@example.test", NOW = 1_800_000_000;
let deps: PhotoAccessDeps, now: number, sent: { email: string; code: string }[], log: ReturnType<typeof vi.spyOn>;
const req = (cookie = "", body?: unknown, origin = "https://curiousgeorge.dev") => new Request("https://curiousgeorge.dev/api/photos/access/session", {
  method: body === undefined ? "GET" : "POST",
  headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const cookie = (name: string, value: string) => `${name}=${value}`;

beforeEach(() => {
  now = NOW; sent = []; log = vi.spyOn(console, "error").mockImplementation(() => {});
  deps = { db: sqliteD1(), secret: SECRET, now: () => now, sendCode: vi.fn(async (email, code) => { sent.push({ email, code }); return true; }) };
});
afterEach(() => log.mockRestore());

async function approvedCode() {
  const approval = await approveEmail(deps.db, deps.secret, EMAIL, now);
  const challenge = await requestPhotoCode(deps, EMAIL, "192.0.2.1");
  if (challenge.state !== "accepted") throw new Error("Fixture could not request code");
  return { approval, challenge: challenge.challenge, code: sent.at(-1)!.code };
}

test("validates addresses without folding Unicode, changing plus aliases or permitting headers", () => {
  expect(normaliseEmail(" Person+Prints@EXAMPLE.test ")).toBe("person+prints@example.test");
  for (const value of [null, "", "not-email", "a@localhost", "a\r\nb@example.test", "K@example.test", ".a@example.test", "a..b@example.test", "a.@example.test", `${"x".repeat(65)}@example.test`]) expect(normaliseEmail(value)).toBeNull();
});

test("approving twice is idempotent and revocation erases the address", async () => {
  const approval = await approveEmail(deps.db, SECRET, EMAIL, now);
  expect(await approveEmail(deps.db, SECRET, EMAIL, now + 10)).toEqual(approval);
  expect(await approvedEmails(deps.db)).toEqual([approval]);
  expect(await revokeEmail(deps.db, approval.id, now)).toBe(true);
  expect(await approvedEmails(deps.db)).toEqual([]);
  expect(await deps.db.prepare("SELECT email, email_hash FROM photo_access_approvals WHERE id = ?").bind(approval.id).first()).toEqual({ email: null, email_hash: null });
  expect(await revokeEmail(deps.db, approval.id, now)).toBe(false);
  expect(await revokeEmail(deps.db, "bad-id", now)).toBe(false);
});

test("unapproved addresses receive the same response without mail or an account", async () => {
  const response = await requestCodeResponse(deps, req("", { email: EMAIL }));
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ expiresIn: 600, resendAfter: 60 });
  expect(response.headers.get("set-cookie")).toContain(`${CHALLENGE_COOKIE}=`);
  expect(sent).toEqual([]);
  expect(await approvedEmails(deps.db)).toEqual([]);
  expect((await deps.db.prepare("SELECT COUNT(*) AS count FROM photo_login_challenges").first())?.count).toBe(0);
});

test("a code creates a fixed 14-day session once, without storing the code or raw cookie", async () => {
  const { challenge, code, approval } = await approvedCode();
  expect(code).toMatch(/^\d{6}$/);
  const request = req(cookie(CHALLENGE_COOKIE, challenge));
  const session = await verifyPhotoCode(deps, request, code);
  expect(session?.expiresAt).toBe(NOW + SESSION_SECONDS);
  const sessionRequest = req(cookie(SESSION_COOKIE, session!.token));
  expect(await photoSession(deps.db, sessionRequest, now)).toEqual({ approvalId: approval.id, expiresAt: NOW + SESSION_SECONDS });
  expect(await photoSession(deps.db, sessionRequest, now + SESSION_SECONDS - 1)).not.toBeNull();
  expect(await photoSession(deps.db, sessionRequest, now + SESSION_SECONDS)).toBeNull();
  expect(await verifyPhotoCode(deps, request, code)).toBeNull();
  const challenges = await deps.db.prepare("SELECT * FROM photo_login_challenges").all();
  const sessions = await deps.db.prepare("SELECT * FROM photo_access_sessions").all();
  expect(JSON.stringify(challenges.results)).not.toContain(challenge);
  expect(JSON.stringify(challenges.results)).not.toContain(`\"${code}\"`);
  expect(JSON.stringify(sessions.results)).not.toContain(session!.token);
  expect(JSON.stringify(sessions.results)).not.toContain(EMAIL);
});

test("simultaneous correct verifications consume the code only once", async () => {
  const { challenge, code } = await approvedCode();
  const results = await Promise.all(Array.from({ length: 6 }, () => verifyPhotoCode(deps, req(cookie(CHALLENGE_COOKIE, challenge)), code)));
  expect(results.filter(Boolean)).toHaveLength(1);
  expect((await deps.db.prepare("SELECT COUNT(*) AS count FROM photo_access_sessions").first())?.count).toBe(1);
});

test("a code is bound to its requesting browser and expires after ten minutes", async () => {
  const { challenge, code } = await approvedCode();
  expect(await verifyPhotoCode(deps, req(), code)).toBeNull();
  expect(await verifyPhotoCode(deps, req(cookie(CHALLENGE_COOKIE, "f".repeat(64))), code)).toBeNull();
  expect(await verifyPhotoCode(deps, req(`${cookie(CHALLENGE_COOKIE, challenge)}; ${cookie(CHALLENGE_COOKIE, challenge)}`), code)).toBeNull();
  now += CODE_SECONDS;
  expect(await verifyPhotoCode(deps, req(cookie(CHALLENGE_COOKIE, challenge)), code)).toBeNull();
});

test("five incorrect guesses lock the challenge, including simultaneous guesses", async () => {
  const { challenge, code } = await approvedCode();
  const wrong = code === "000000" ? "111111" : "000000";
  await Promise.all(Array.from({ length: 10 }, () => verifyPhotoCode(deps, req(cookie(CHALLENGE_COOKIE, challenge)), wrong)));
  expect(await verifyPhotoCode(deps, req(cookie(CHALLENGE_COOKIE, challenge)), code)).toBeNull();
  expect((await deps.db.prepare("SELECT attempts FROM photo_login_challenges").first())?.attempts).toBe(5);
});

test("resend cooldown and email limits hold across clients and concurrent requests", async () => {
  await approveEmail(deps.db, SECRET, EMAIL, now);
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => requestPhotoCode(deps, EMAIL, `192.0.2.${i}`)));
  expect(results.filter((result) => result.state === "accepted")).toHaveLength(1);
  expect(sent).toHaveLength(1);
  for (let i = 0; i < 2; i++) { now += 60; expect((await requestPhotoCode(deps, EMAIL, "192.0.2.50")).state).toBe("accepted"); }
  now += 60;
  expect((await requestPhotoCode(deps, EMAIL, "192.0.2.51")).state).toBe("limited");
  expect(sent).toHaveLength(3);
});

test("client limits prevent spraying different email addresses", async () => {
  for (let i = 0; i < 20; i++) expect((await requestPhotoCode(deps, `person${i}@example.test`, "192.0.2.1")).state).toBe("accepted");
  expect((await requestPhotoCode(deps, "other@example.test", "192.0.2.1")).state).toBe("limited");
  const stored = await deps.db.prepare("SELECT * FROM photo_login_limits").all();
  expect(JSON.stringify(stored.results)).not.toContain("192.0.2.1");
  expect(JSON.stringify(stored.results)).not.toContain("example.test");
});

test("resending invalidates the previous challenge and code", async () => {
  const first = await approvedCode();
  now += 60;
  const second = await requestPhotoCode(deps, EMAIL, "192.0.2.1");
  if (second.state !== "accepted") throw new Error("Fixture could not resend");
  expect(await verifyPhotoCode(deps, req(cookie(CHALLENGE_COOKIE, first.challenge)), first.code)).toBeNull();
  expect(await verifyPhotoCode(deps, req(cookie(CHALLENGE_COOKIE, second.challenge)), sent.at(-1)!.code)).not.toBeNull();
});

test("failed or pending email delivery cannot produce a session and never logs the code/address", async () => {
  deps.sendCode = vi.fn(async () => { throw new Error(`private ${EMAIL} 123456`); });
  await approveEmail(deps.db, SECRET, EMAIL, now);
  const result = await requestPhotoCode(deps, EMAIL, "192.0.2.1");
  expect(result.state).toBe("accepted");
  expect((await deps.db.prepare("SELECT COUNT(*) AS count FROM photo_login_challenges").first())?.count).toBe(0);
  expect(log.mock.calls).toEqual([["photos: sign-in email unavailable"]]);
});

test("a challenge remains unusable until email delivery succeeds", async () => {
  let finish!: () => void, started!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const sending = new Promise<void>((resolve) => { started = resolve; });
  let value = "";
  deps.sendCode = async (_email, code) => { value = code; started(); await pending; return true; };
  await approveEmail(deps.db, SECRET, EMAIL, now);
  const request = requestPhotoCode(deps, EMAIL, "192.0.2.1");
  await sending;
  expect((await deps.db.prepare("SELECT delivered, consumed_at FROM photo_login_challenges").first())).toEqual({ delivered: 0, consumed_at: null });
  expect((await deps.db.prepare("SELECT COUNT(*) AS count FROM photo_access_sessions").first())?.count).toBe(0);
  finish();
  const result = await request;
  if (result.state !== "accepted") throw new Error("Fixture was limited");
  expect(await verifyPhotoCode(deps, req(cookie(CHALLENGE_COOKIE, result.challenge)), value)).not.toBeNull();
});

test("a failed session insert rolls back code consumption so it can be retried once", async () => {
  const { challenge, code } = await approvedCode();
  await deps.db.prepare("CREATE TRIGGER reject_photo_session BEFORE INSERT ON photo_access_sessions BEGIN SELECT RAISE(ABORT, 'fixture failure'); END").run();
  await expect(verifyPhotoCode(deps, req(cookie(CHALLENGE_COOKIE, challenge)), code)).rejects.toThrow("fixture failure");
  expect(await deps.db.prepare("SELECT consumed_at, attempts FROM photo_login_challenges").first()).toEqual({ consumed_at: null, attempts: 0 });
  await deps.db.prepare("DROP TRIGGER reject_photo_session").run();
  expect(await verifyPhotoCode(deps, req(cookie(CHALLENGE_COOKIE, challenge)), code)).not.toBeNull();
  expect(await verifyPhotoCode(deps, req(cookie(CHALLENGE_COOKIE, challenge)), code)).toBeNull();
});

test("the daily address limit survives hourly resets", async () => {
  await approveEmail(deps.db, SECRET, EMAIL, now);
  for (let i = 0; i < 10; i++) {
    now = NOW + Math.floor(i / 3) * 3600 + (i % 3) * 60;
    expect((await requestPhotoCode(deps, EMAIL, "192.0.2.1")).state).toBe("accepted");
  }
  now += 60;
  expect((await requestPhotoCode(deps, EMAIL, "192.0.2.1")).state).toBe("limited");
  expect(sent).toHaveLength(10);
});

test("revocation removes sessions and pending codes; reapproval never revives them", async () => {
  const { challenge, code, approval } = await approvedCode();
  const session = await verifyPhotoCode(deps, req(cookie(CHALLENGE_COOKIE, challenge)), code);
  now += 60;
  const next = await requestPhotoCode(deps, EMAIL, "192.0.2.1");
  await revokeEmail(deps.db, approval.id, now);
  expect(await photoSession(deps.db, req(cookie(SESSION_COOKIE, session!.token)), now)).toBeNull();
  const renewed = await approveEmail(deps.db, SECRET, EMAIL, now);
  expect(renewed.id).not.toBe(approval.id);
  expect(await photoSession(deps.db, req(cookie(SESSION_COOKIE, session!.token)), now)).toBeNull();
  if (next.state === "accepted") expect(await verifyPhotoCode(deps, req(cookie(CHALLENGE_COOKIE, next.challenge)), sent.at(-1)!.code)).toBeNull();
});

test("successful sign-in rotates the previous browser session; logout revokes it server-side", async () => {
  const first = await approvedCode();
  const session = await verifyPhotoCode(deps, req(cookie(CHALLENGE_COOKIE, first.challenge)), first.code);
  now += 60;
  const next = await requestPhotoCode(deps, EMAIL, "192.0.2.1");
  if (next.state !== "accepted") throw new Error("Fixture could not resend");
  const nextSession = await verifyPhotoCode(deps, req(`${cookie(CHALLENGE_COOKIE, next.challenge)}; ${cookie(SESSION_COOKIE, session!.token)}`), sent.at(-1)!.code);
  expect(await photoSession(deps.db, req(cookie(SESSION_COOKIE, session!.token)), now)).toBeNull();
  const nextRequest = req(cookie(SESSION_COOKIE, nextSession!.token));
  expect(await photoSession(deps.db, nextRequest, now)).not.toBeNull();
  await logoutPhotoSession(deps.db, nextRequest);
  expect(await photoSession(deps.db, nextRequest, now)).toBeNull();
});

test("HTTP auth writes refuse missing/foreign Origin and use private Secure HttpOnly cookies", async () => {
  for (const origin of ["", "null", "https://elsewhere.test"]) {
    expect((await requestCodeResponse(deps, req("", { email: EMAIL }, origin))).status).toBe(403);
    expect((await verifyCodeResponse(deps, req("", { code: "123456" }, origin))).status).toBe(403);
    expect((await logoutResponse(deps.db, req("", {}, origin))).status).toBe(403);
  }
  await approveEmail(deps.db, SECRET, EMAIL, now);
  const response = await requestCodeResponse(deps, req("", { email: EMAIL }));
  const challenge = response.headers.get("set-cookie")!.split(";")[0];
  expect(response.headers.get("set-cookie")).toMatch(/Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax/);
  const verified = await verifyCodeResponse(deps, req(challenge, { code: sent[0].code }));
  expect(verified.status).toBe(200);
  expect(verified.headers.get("set-cookie")).toContain("Max-Age=1209600; HttpOnly; Secure; SameSite=Lax");
  expect(verified.headers.get("cache-control")).toBe("private, no-store");
  expect(verified.headers.get("referrer-policy")).toBe("no-referrer");
  const sessionCookie = verified.headers.get("set-cookie")!.match(/__Host-photo-session=[a-f0-9]{64}/)![0];
  const state = await sessionResponse(deps.db, req(sessionCookie), now);
  expect(await state.json()).toEqual({ authenticated: true, expiresAt: NOW + SESSION_SECONDS });
  const logout = await logoutResponse(deps.db, req(sessionCookie, {}));
  expect(logout.status).toBe(204);
  expect(logout.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=; Path=/; Max-Age=0`);
});

test("cleanup removes expired authentication data and old revoked records, retaining active access", async () => {
  const { challenge, code } = await approvedCode();
  await verifyPhotoCode(deps, req(cookie(CHALLENGE_COOKIE, challenge)), code);
  await cleanPhotoAccess(deps.db, NOW + SESSION_SECONDS);
  for (const table of ["photo_login_challenges", "photo_access_sessions", "photo_login_limits"]) expect((await deps.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first())?.count).toBe(0);
  expect(await approvedEmails(deps.db)).toHaveLength(1);
});
