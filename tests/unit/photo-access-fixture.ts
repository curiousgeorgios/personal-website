import { CHALLENGE_COOKIE, SESSION_COOKIE, approveEmail, requestPhotoCode, verifyPhotoCode } from "../../src/lib/photos/access";

export async function photoAccessFixture(db: D1Database, secret: string, now: number, email = "recipient@example.test") {
  const approval = await approveEmail(db, secret, email, now);
  let code = "";
  const deps = { db, secret, now: () => now, sendCode: async (_email: string, value: string) => { code = value; return true; } };
  const challenge = await requestPhotoCode(deps, email, "192.0.2.1");
  if (challenge.state !== "accepted") throw new Error("Fixture could not request code");
  const session = await verifyPhotoCode(deps, new Request("https://curiousgeorge.dev", { headers: { Cookie: `${CHALLENGE_COOKIE}=${challenge.challenge}` } }), code);
  if (!session) throw new Error("Fixture could not verify code");
  return { approval, token: session.token, cookie: `${SESSION_COOKIE}=${session.token}` };
}
