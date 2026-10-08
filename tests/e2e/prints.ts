import { execFileSync } from "node:child_process";
import { STAND_IN } from "./prints-site";

// Helpers for the print specs. They write only to the prints servers' own stores and read the stand-in.

/** A suffix unique to this attempt, so parallel and retried tests never collide */
export const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;

/** SQL on a prints server's own local store: reading a row, or setting test data (spec 11.2's rule) */
export function printsD1<T = Record<string, unknown>>(sql: string, store = ".wrangler/prints"): T[] {
  const output = execFileSync("bunx", ["wrangler", "d1", "execute", "curiousgeorge-logbook", "--local", "--persist-to", store, "--json", "--command", sql], { encoding: "utf8" });
  return (JSON.parse(output) as { results: T[] }[])[0]?.results ?? [];
}

/** JSON from the stand-in */
export async function standIn<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${STAND_IN}${path}`, init);
  if (!response.ok) throw new Error(`the stand-in answered ${response.status} on ${path}`);
  return (await response.json()) as T;
}
