import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";
import { photoWorkspace } from "./photo-workspace";

const run = promisify(execFile);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const WRANGLER = join(REPO, "node_modules/.bin/wrangler");
const IMPORT = join(REPO, "scripts/import-photos.mjs");
const BONDI = { subLocality: null, locality: "Bondi Beach", subAdministrativeArea: "Waverley Council", administrativeArea: "NSW", isoCountryCode: "AU" };
let folders: string[] = [];
afterEach(async () => {
  for (const folder of folders) await rm(folder, { recursive: true, force: true });
  folders = [];
});

/** SQL against the temporary local store, through wrangler as the e2e fixtures do */
async function query(store: string, sql: string) {
  const { stdout } = await run(WRANGLER, ["d1", "execute", "curiousgeorge-logbook", "--local", "--persist-to", store, "--json", "--command", sql], { cwd: REPO });
  return (JSON.parse(stdout) as { results: Record<string, unknown>[] }[])[0].results;
}

// The real import, end to end, into a temporary local store (never .wrangler/state, never --remote)
test("photos:import writes posts before photographs, and a re-import keeps an edited title and place", { timeout: 180_000 }, async () => {
  const workspace = await photoWorkspace([{ post: "postA", publishedAt: "2025-02-03T00:30:00+11:00", slides: [{ slide: 1, width: 300, height: 450 }] }]);
  const store = await mkdtemp(join(tmpdir(), "photo-import-store-"));
  folders.push(workspace.dir, store);
  await workspace.prepare({ "postA-01-original.jpg": BONDI });
  await run(WRANGLER, ["d1", "migrations", "apply", "curiousgeorge-logbook", "--local", "--persist-to", store], { cwd: REPO });
  const importArgs = [IMPORT, "--manifest", join(workspace.output, "manifest.json"), "--selection", join(workspace.dir, "selection.json"), "--local", "--persist-to", store];
  await run(process.execPath, importArgs, { cwd: REPO });
  expect(await query(store, "SELECT collection, published_at, published_on, place FROM photo_posts")).toEqual([
    { collection: "postA", published_at: 1738503000, published_on: "2025-02-03", place: "bondi beach, sydney" },
  ]);
  expect(await query(store, "SELECT id, title, published, raw_review FROM photos")).toEqual([{ id: "postA-01", title: "", published: 0, raw_review: 0 }]);
  await query(store, "UPDATE photos SET title = 'the first swim' WHERE id = 'postA-01'; UPDATE photo_posts SET place = 'tamarama, sydney', place_edited = 1");
  await run(process.execPath, importArgs, { cwd: REPO });
  expect(await query(store, "SELECT title FROM photos")).toEqual([{ title: "the first swim" }]);
  expect(await query(store, "SELECT place FROM photo_posts")).toEqual([{ place: "tamarama, sydney" }]);
});
