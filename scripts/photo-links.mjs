import { readFile, writeFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { signPhotoToken, DEFAULT_LINK_SECONDS, MAX_LINK_SECONDS, GRANT_ID } from "../src/lib/photos/tokens.ts";
import { photoPlatform } from "./photo-platform.mjs";

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
if (args.includes("--local") === args.includes("--remote") || (!arg("--revoke") && !arg("--output"))) {
  console.error("usage: bun run photos:link --local | --remote --output private-link.json [--photo ID] [--days 7] [--origin URL] [--persist-to DIR]\n       bun run photos:link --local | --remote --revoke GRANT_ID");
  process.exit(1);
}
const platform = await photoPlatform({ remote: args.includes("--remote"), persistTo: arg("--persist-to") ?? ".wrangler/state" });
try {
  if (arg("--revoke")) {
    const id = arg("--revoke");
    if (!GRANT_ID.test(id)) throw new Error("Invalid grant identifier");
    const result = await platform.env.DB.prepare("UPDATE photo_download_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(Math.floor(Date.now()/1000), id).run();
    console.log(result.meta.changes ? "Download link revoked." : "Grant unavailable or already revoked.");
  } else {
    let secret = process.env.PHOTO_LINK_SECRET;
    if (!secret && args.includes("--local")) {
      const vars = await readFile(".dev.vars", "utf8");
      secret = /^PHOTO_LINK_SECRET=([a-f0-9]{64})$/m.exec(vars)?.[1];
    }
    if (!secret) throw new Error("Set PHOTO_LINK_SECRET; remote issuance must use the production signing key");
    const duration = arg("--days") === null ? DEFAULT_LINK_SECONDS : Number(arg("--days"))*86400;
    if (!Number.isSafeInteger(duration) || duration < 60 || duration > MAX_LINK_SECONDS) throw new Error("Expiry must be 60 seconds to 30 days");
    const photoId = arg("--photo");
    if (photoId && !await platform.env.DB.prepare("SELECT id FROM photos WHERE id = ? AND published = 1").bind(photoId).first()) throw new Error("Photo is unavailable or unpublished");
    const grant = { grantId: randomUUID(), photoId, expiresAt: Math.floor(Date.now()/1000) + duration };
    const token = await signPhotoToken(secret, grant);
    const origin = new URL(arg("--origin") ?? (args.includes("--remote") ? "https://curiousgeorge.dev" : "http://localhost:4331"));
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" || (origin.protocol !== "https:" && !(args.includes("--local") && ["localhost", "127.0.0.1"].includes(origin.hostname)))) throw new Error("Invalid link origin");
    const url = new URL(photoId === null ? "/api/photos/downloads" : `/photos/downloads/${photoId}`, origin);
    url.searchParams.set("token", token);
    // Create the private output first, so a typo cannot leave a usable grant with its link lost.
    const output = resolve(arg("--output"));
    const repo = resolve(fileURLToPath(new URL("../", import.meta.url)));
    if (output.startsWith(`${repo}/`) && !output.startsWith(`${repo}/.wrangler/`)) throw new Error("Write signed links outside the checkout or inside ignored .wrangler storage");
    await writeFile(output, JSON.stringify({ grantId: grant.grantId, expiresAt: grant.expiresAt, url: url.href }, null, 2)+"\n", { mode: 0o600, flag: "wx" });
    await chmod(output, 0o600);
    await platform.env.DB.prepare("INSERT INTO photo_download_grants (id, photo_id, expires_at) VALUES (?, ?, ?)").bind(grant.grantId, grant.photoId, grant.expiresAt).run();
    console.log("Signed link written to the private output file. The URL was not printed.");
  }
} finally { await platform.dispose(); }
