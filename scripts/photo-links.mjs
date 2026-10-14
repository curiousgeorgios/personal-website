import { GRANT_ID } from "../src/lib/photos/tokens.ts";
import { photoPlatform } from "./photo-platform.mjs";

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
if (args.includes("--local") === args.includes("--remote") || !arg("--revoke")) {
  console.error("Human downloads now use approved email sign-in. Approve addresses in /admin.\nTo revoke an old catalogue link: bun run photos:link --local | --remote --revoke GRANT_ID [--persist-to DIR]");
  process.exit(1);
}
const id = arg("--revoke");
if (!GRANT_ID.test(id)) throw new Error("Invalid grant identifier");
const platform = await photoPlatform({ remote: args.includes("--remote"), persistTo: arg("--persist-to") ?? ".wrangler/state" });
try {
  const result = await platform.env.DB.prepare("UPDATE photo_download_grants SET revoked_at = ? WHERE id = ? AND photo_id IS NULL AND revoked_at IS NULL").bind(Math.floor(Date.now() / 1000), id).run();
  if (result.meta.changes) console.log("Legacy download link revoked.");
  else {
    const row = await platform.env.DB.prepare("SELECT photo_id FROM photo_download_grants WHERE id = ?").bind(id).first();
    console.log(row && row.photo_id !== null ? "That grant belongs to a print order; only print code revokes it." : "Grant unavailable or already revoked.");
  }
} finally { await platform.dispose(); }
