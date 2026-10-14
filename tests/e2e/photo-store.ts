import { execFileSync } from "node:child_process";
import type { APIRequestContext } from "@playwright/test";
import { PHOTO_ACCESS, photoCodeMail } from "./photo-access-site";

/**
 * SQL on the admin server's own local store (4333), as spec 11.2's fixtures allow: reading a row, or setting test data.
 * The server is running on the same store; SQLite's locking keeps the two safe.
 */
export function adminD1<T = Record<string, unknown>>(sql: string): T[] {
  const output = execFileSync("bunx", ["wrangler", "d1", "execute", "curiousgeorge-logbook", "--local", "--persist-to", ".wrangler/admin", "--json", "--command", sql], { encoding: "utf8" });
  return (JSON.parse(output) as { results: T[] }[])[0]?.results ?? [];
}

/** Signs in through the actual code routes, using only the synthetic HTTPS fixture and its mail sink. */
export async function approvedDownloadSession(request: APIRequestContext): Promise<{ approvalId: string; url: string }> {
  const client = crypto.randomUUID(), email = `e2e-${client}@example.test`;
  const headers = { Origin: PHOTO_ACCESS, "X-Test-Client": client };
  const approval = await request.post(`${PHOTO_ACCESS}/admin/photos/access`, { headers, data: { email } });
  if (approval.status() !== 201) throw new Error(`approving access answered ${approval.status()}`);
  const { approval: { id } } = await approval.json();
  const sent = await request.post(`${PHOTO_ACCESS}/api/photos/access/code`, { headers, data: { email } });
  if (sent.status() !== 202) throw new Error(`requesting a code answered ${sent.status()}`);
  const code = (await photoCodeMail(email)).at(-1)?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error("No code arrived at the synthetic mail sink");
  const session = await request.post(`${PHOTO_ACCESS}/api/photos/access/session`, { headers, data: { code } });
  if (session.status() !== 200) throw new Error(`verifying a code answered ${session.status()}`);
  return { approvalId: id, url: `${PHOTO_ACCESS}/photos/downloads` };
}
