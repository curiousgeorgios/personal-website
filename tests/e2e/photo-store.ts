import { execFileSync } from "node:child_process";

/**
 * SQL on the admin server's own local store (4333), as spec 11.2's fixtures allow: reading a row, or setting test data.
 * The server is running on the same store; SQLite's locking keeps the two safe.
 */
export function adminD1<T = Record<string, unknown>>(sql: string): T[] {
  const output = execFileSync("bunx", ["wrangler", "d1", "execute", "curiousgeorge-logbook", "--local", "--persist-to", ".wrangler/admin", "--json", "--command", sql], { encoding: "utf8" });
  return (JSON.parse(output) as { results: T[] }[])[0]?.results ?? [];
}
