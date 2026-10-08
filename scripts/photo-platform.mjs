import { getPlatformProxy, unstable_readConfig } from "wrangler";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";

export async function photoPlatform({ remote = false, persistTo = ".wrangler/state" } = {}) {
  const config = unstable_readConfig({ config: resolve("wrangler.jsonc") });
  const directory = resolve(".wrangler");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `photo-bindings-${randomUUID()}.json`);
  await writeFile(path, JSON.stringify({
    name: "photo-import-bindings", account_id: config.account_id,
    compatibility_date: config.compatibility_date,
    r2_buckets: config.r2_buckets.filter((b) => ["MEDIA", "PHOTO_PRINTS"].includes(b.binding)).map((b) => ({ ...b, remote })),
    d1_databases: config.d1_databases.map((b) => ({ ...b, remote })),
  }), { mode: 0o600 });
  try {
    const platform = await getPlatformProxy({ configPath: path, remoteBindings: remote, envFiles: [], persist: { path: resolve(persistTo, "v3") } });
    const dispose = platform.dispose.bind(platform);
    platform.dispose = async () => { try { await dispose(); } finally { await unlink(path); } };
    return platform;
  } catch (error) { await unlink(path); throw error; }
}
