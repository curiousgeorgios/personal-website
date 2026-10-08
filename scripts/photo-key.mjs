import { randomBytes } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";

let text = "";
try { text = await readFile(".dev.vars", "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (/^PHOTO_LINK_SECRET=/m.test(text)) {
  console.log("PHOTO_LINK_SECRET already exists in .dev.vars; kept the existing key.");
} else {
  await writeFile(".dev.vars", `${text}${text.endsWith("\n") || !text ? "" : "\n"}PHOTO_LINK_SECRET=${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
  await chmod(".dev.vars", 0o600);
  console.log("Created a local PHOTO_LINK_SECRET in ignored .dev.vars. No key was printed.");
}
