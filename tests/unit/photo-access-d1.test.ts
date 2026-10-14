import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy, type PlatformProxy } from "wrangler";
import { CHALLENGE_COOKIE, SESSION_COOKIE, approveEmail, photoSession, requestPhotoCode, revokeEmail, verifyPhotoCode } from "../../src/lib/photos/access";

let directory: string, platform: PlatformProxy<{ DB: D1Database }>;
const SECRET = "1".repeat(64), NOW = 1_800_000_000;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "photo-auth-d1-"));
  const config = join(directory, "wrangler.json");
  await writeFile(config, JSON.stringify({ name: "photo-auth-d1-test", compatibility_date: "2026-10-01", d1_databases: [{ binding: "DB", database_name: "photo-auth-synthetic", database_id: "00000000-0000-4000-8000-000000000001" }] }));
  platform = await getPlatformProxy({ configPath: config, envFiles: [], persist: false, remoteBindings: false });
  const migration = await readFile(new URL("../../migrations/0010_photo_email_access.sql", import.meta.url), "utf8");
  for (const statement of migration.split(";").map((sql) => sql.trim()).filter(Boolean)) await platform.env.DB.prepare(statement).run();
}, 30_000);
afterAll(async () => { if (platform) await platform.dispose(); if (directory) await rm(directory, { recursive: true, force: true }); });

test("the real local D1 binding consumes a concurrent code exactly once and revokes the resulting session", async () => {
  const db = platform.env.DB;
  const approval = await approveEmail(db, SECRET, "d1-recipient@example.test", NOW);
  let code = "";
  const deps = { db, secret: SECRET, now: () => NOW, sendCode: async (_email: string, value: string) => { code = value; return true; } };
  const challenge = await requestPhotoCode(deps, "d1-recipient@example.test", "192.0.2.1");
  if (challenge.state !== "accepted") throw new Error("Fixture was limited");
  const request = new Request("https://curiousgeorge.dev", { headers: { Cookie: `${CHALLENGE_COOKIE}=${challenge.challenge}` } });
  const results = await Promise.all(Array.from({ length: 5 }, () => verifyPhotoCode(deps, request, code)));
  const sessions = results.filter((session) => session !== null);
  expect(sessions).toHaveLength(1);
  const signedIn = new Request("https://curiousgeorge.dev", { headers: { Cookie: `${SESSION_COOKIE}=${sessions[0]!.token}` } });
  expect(await photoSession(db, signedIn, NOW)).not.toBeNull();
  expect(await revokeEmail(db, approval.id, NOW)).toBe(true);
  expect(await photoSession(db, signedIn, NOW)).toBeNull();
}, 15_000);

test("the real local D1 cooldown holds across simultaneous client requests", async () => {
  let sends = 0;
  const deps = { db: platform.env.DB, secret: SECRET, now: () => NOW, sendCode: async () => { sends++; return true; } };
  await approveEmail(deps.db, SECRET, "d1-cooldown@example.test", NOW);
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => requestPhotoCode(deps, "d1-cooldown@example.test", `192.0.2.${i + 10}`)));
  expect(results.filter((result) => result.state === "accepted")).toHaveLength(1);
  expect(sends).toBe(1);
}, 15_000);
