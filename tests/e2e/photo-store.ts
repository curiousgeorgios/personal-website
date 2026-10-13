import { execFileSync } from "node:child_process";
import type { APIRequestContext } from "@playwright/test";
import { ADMIN } from "./admin";

/**
 * SQL on the admin server's own local store (4333), as spec 11.2's fixtures allow: reading a row, or setting test data.
 * The server is running on the same store; SQLite's locking keeps the two safe.
 */
export function adminD1<T = Record<string, unknown>>(sql: string): T[] {
  const output = execFileSync("bunx", ["wrangler", "d1", "execute", "curiousgeorge-logbook", "--local", "--persist-to", ".wrangler/admin", "--json", "--command", sql], { encoding: "utf8" });
  return (JSON.parse(output) as { results: T[] }[])[0]?.results ?? [];
}

/** Issues a catalogue link through the owner's JSON route on the admin server */
export async function catalogueLink(request: APIRequestContext): Promise<{ grantId: string; expiresAt: number; url: string }> {
  const issued = await request.post(`${ADMIN}/admin/photos/links`, { headers: { Origin: ADMIN }, data: {} });
  if (issued.status() !== 201) throw new Error(`issuing a link answered ${issued.status()}`);
  return issued.json();
}
