import { photoSigningKey, GRANT_ID } from "./tokens";

export const CODE_SECONDS = 600;
export const RESEND_SECONDS = 60;
export const SESSION_SECONDS = 14 * 86400;
export const SESSION_COOKIE = "__Host-photo-session";
export const CHALLENGE_COOKIE = "__Host-photo-login";
const TOKEN = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();

export interface PhotoSession { approvalId: string; expiresAt: number }
export interface PhotoApproval { id: string; email: string; createdAt: number }
export interface PhotoAccessDeps {
  db: D1Database;
  secret: string | undefined;
  now: () => number;
  sendCode: (email: string, code: string) => Promise<boolean>;
  client?: (request: Request) => string;
}

export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)) return null;
  const local = email.split("@")[0];
  return local.length <= 64 && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..") ? email : null;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const tokenHash = async (token: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))));

async function keyedHash(secret: string | undefined, purpose: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(photoSigningKey(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`photo-email-access:v1:${purpose}:${value}`))));
}

export function readPhotoCookie(request: Request, name: string): string {
  const matches = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  const value = matches.length === 1 ? matches[0].slice(name.length + 1) : "";
  return TOKEN.test(value) ? value : "";
}

export const photoCookie = (name: string, value: string, seconds: number) =>
  `${name}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;

export async function approvedEmails(db: D1Database): Promise<PhotoApproval[]> {
  const { results } = await db.prepare("SELECT id, email, created_at AS createdAt FROM photo_access_approvals WHERE revoked_at IS NULL ORDER BY created_at DESC, id").all<PhotoApproval>();
  return results;
}

export async function approveEmail(db: D1Database, secret: string | undefined, email: string, now: number): Promise<PhotoApproval> {
  const normalised = normaliseEmail(email);
  if (!normalised) throw new Error("Invalid email address");
  email = normalised;
  const emailHash = await keyedHash(secret, "email", email);
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO photo_access_approvals (id, email_hash, email, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(email_hash) DO NOTHING`)
    .bind(id, emailHash, email, now).run();
  const approval = await db.prepare("SELECT id, email, created_at AS createdAt FROM photo_access_approvals WHERE email_hash = ? AND revoked_at IS NULL").bind(emailHash).first<PhotoApproval>();
  if (!approval) throw new Error("Approval unavailable");
  return approval;
}

export async function revokeEmail(db: D1Database, id: string, now: number): Promise<boolean> {
  if (!GRANT_ID.test(id)) return false;
  const result = await db.batch([
    db.prepare("DELETE FROM photo_access_sessions WHERE approval_id = ?").bind(id),
    db.prepare("DELETE FROM photo_login_challenges WHERE approval_id = ?").bind(id),
    db.prepare("UPDATE photo_access_approvals SET revoked_at = ?, email_hash = NULL, email = NULL WHERE id = ? AND revoked_at IS NULL").bind(now, id),
  ]);
  return result[2].meta.changes > 0;
}

export async function photoSession(db: D1Database, request: Request, now = Math.floor(Date.now() / 1000)): Promise<PhotoSession | null> {
  const token = readPhotoCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return db.prepare(`SELECT s.approval_id AS approvalId, s.expires_at AS expiresAt FROM photo_access_sessions s
    JOIN photo_access_approvals a ON a.id = s.approval_id WHERE s.token_hash = ? AND s.expires_at > ? AND a.revoked_at IS NULL`)
    .bind(await tokenHash(token), now).first<PhotoSession>();
}

async function limitWait(db: D1Database, key: string, max: number, now: number, seconds: number): Promise<number> {
  const row = await db.prepare(`INSERT INTO photo_login_limits (key, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires_at <= ? THEN 1 ELSE count + 1 END,
      expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END RETURNING count, expires_at AS expiresAt`)
    .bind(key, now + seconds, now, now).first<{ count: number; expiresAt: number }>();
  if (!row) throw new Error("Sign-in limit unavailable");
  return row.count <= max ? 0 : Math.max(1, row.expiresAt - now);
}

function randomCode(): string {
  const values = new Uint32Array(1);
  // Rejection sampling keeps all six-digit codes equally likely.
  do { crypto.getRandomValues(values); } while (values[0] >= 4_294_000_000);
  return String(values[0] % 1_000_000).padStart(6, "0");
}

export type CodeRequest = { state: "accepted"; challenge: string } | { state: "limited"; retryAfter: number };
export async function requestPhotoCode(deps: PhotoAccessDeps, email: string, client: string): Promise<CodeRequest> {
  const normalised = normaliseEmail(email);
  if (!normalised) throw new Error("Invalid email address");
  email = normalised;
  const now = deps.now();
  const emailHash = await keyedHash(deps.secret, "email", email);
  const clientHash = await keyedHash(deps.secret, "client", client);
  // D1 counters are atomic across regions, rather than per-isolate or per-browser.
  const limits: [string, number, number][] = [[`ip:${clientHash}`, 20, 3600], [`cooldown:${emailHash}`, 1, RESEND_SECONDS], [`hour:${emailHash}`, 3, 3600], [`day:${emailHash}`, 10, 86400]];
  for (const [key, max, seconds] of limits) {
    const retryAfter = await limitWait(deps.db, key, max, now, seconds);
    if (retryAfter) return { state: "limited", retryAfter };
  }
  const challenge = randomToken();
  const id = await tokenHash(challenge);
  const approval = await deps.db.prepare("SELECT id FROM photo_access_approvals WHERE email_hash = ? AND revoked_at IS NULL").bind(emailHash).first<{ id: string }>();
  // Unapproved addresses get the same response and cookie, without receiving mail or creating an account.
  if (!approval) return { state: "accepted", challenge };
  const code = randomCode();
  const codeHash = await keyedHash(deps.secret, "code", `${id}:${code}`);
  await deps.db.prepare(`INSERT INTO photo_login_challenges (id, email_hash, approval_id, code_hash, requested_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email_hash) DO UPDATE SET id = excluded.id, approval_id = excluded.approval_id,
      code_hash = excluded.code_hash, requested_at = excluded.requested_at, expires_at = excluded.expires_at,
      delivered = 0, attempts = 0, consumed_at = NULL, session_hash = NULL`)
    .bind(id, emailHash, approval.id, codeHash, now, now + CODE_SECONDS).run();
  let delivered = false;
  try { delivered = await deps.sendCode(email, code); }
  catch { console.error("photos: sign-in email unavailable"); }
  if (delivered) await deps.db.prepare("UPDATE photo_login_challenges SET delivered = 1 WHERE id = ?").bind(id).run();
  else await deps.db.prepare("DELETE FROM photo_login_challenges WHERE id = ?").bind(id).run();
  return { state: "accepted", challenge };
}

export async function verifyPhotoCode(deps: PhotoAccessDeps, request: Request, code: string): Promise<{ token: string; expiresAt: number } | null> {
  const challenge = readPhotoCookie(request, CHALLENGE_COOKIE);
  if (!challenge || !/^\d{6}$/.test(code)) return null;
  const id = await tokenHash(challenge);
  const codeHash = await keyedHash(deps.secret, "code", `${id}:${code}`);
  const token = randomToken(), hash = await tokenHash(token), now = deps.now();
  const previous = readPhotoCookie(request, SESSION_COOKIE);
  const previousHash = previous ? await tokenHash(previous) : "";
  const result = await deps.db.batch([
    deps.db.prepare(`UPDATE photo_login_challenges SET attempts = attempts + 1,
      consumed_at = CASE WHEN code_hash = ? THEN ? ELSE NULL END,
      session_hash = CASE WHEN code_hash = ? THEN ? ELSE NULL END
      WHERE id = ? AND delivered = 1 AND expires_at > ? AND attempts < 5 AND consumed_at IS NULL
      AND EXISTS (SELECT 1 FROM photo_access_approvals a WHERE a.id = approval_id AND a.revoked_at IS NULL)`)
      .bind(codeHash, now, codeHash, hash, id, now),
    deps.db.prepare(`INSERT INTO photo_access_sessions (token_hash, approval_id, created_at, expires_at)
      SELECT session_hash, approval_id, ?, ? FROM photo_login_challenges
      WHERE id = ? AND session_hash = ? AND consumed_at = ?`)
      .bind(now, now + SESSION_SECONDS, id, hash, now),
    deps.db.prepare("DELETE FROM photo_access_sessions WHERE token_hash = ? AND EXISTS (SELECT 1 FROM photo_access_sessions WHERE token_hash = ?)")
      .bind(previousHash, hash),
  ]);
  return result[1].meta.changes > 0 ? { token, expiresAt: now + SESSION_SECONDS } : null;
}

export async function logoutPhotoSession(db: D1Database, request: Request): Promise<void> {
  const session = readPhotoCookie(request, SESSION_COOKIE), challenge = readPhotoCookie(request, CHALLENGE_COOKIE);
  await db.batch([
    db.prepare("DELETE FROM photo_access_sessions WHERE token_hash = ?").bind(session ? await tokenHash(session) : ""),
    db.prepare("DELETE FROM photo_login_challenges WHERE id = ?").bind(challenge ? await tokenHash(challenge) : ""),
  ]);
}

export async function cleanPhotoAccess(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM photo_access_sessions WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM photo_login_challenges WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM photo_login_limits WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM photo_access_approvals WHERE revoked_at < ?").bind(now - 30 * 86400),
  ]);
}
