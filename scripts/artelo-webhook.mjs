// bun run prints:webhook --local [--origin URL] | --remote (spec 18.6): saves Artelo's OrderStatusChange webhook for every
// status and pipes the returned secret on standard input, never printing it. --remote stores it in Infisical's prod
// environment as ARTELO_WEBHOOK_SECRET (ADR-0029: Infisical's sync carries it to the Worker), for wrangler.jsonc's
// SITE_ORIGIN; --local hands it to PRINTS_SECRET_SINK, a command that reads it from standard input. The Artelo key comes
// from ARTELO_API_KEY, which `infisical run --env=prod --` supplies.
// Artelo's webhooks are listed first: a secret can't be read back once saved, so a second webhook for the same URL would
// leave one whose deliveries fail every signature check. If ours is already there, nothing is saved, and George deletes
// it in Artelo's dashboard and runs this again (Artelo documents no delete).
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { artelo, hasWebhook, readWebhooks, shapeOf } from "../src/lib/prints/artelo.ts";
import { ARTELO_STATUSES } from "../src/lib/prints/artelo-status.ts";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
if (remote === args.includes("--local")) {
  console.error("usage: bun run prints:webhook --local [--origin URL] | --remote");
  process.exit(2);
}
const key = process.env.ARTELO_API_KEY;
if (!key) {
  console.error("set ARTELO_API_KEY in the environment; it is never printed");
  process.exit(2);
}
const sink = remote ? ["infisical", "secrets", "set", "ARTELO_WEBHOOK_SECRET=@/dev/stdin", "--env=prod", "--silent"] : (process.env.PRINTS_SECRET_SINK ?? "").split(" ").filter(Boolean);
// Checked before Artelo is asked, so no webhook is saved whose secret has nowhere to go
if (sink.length === 0) {
  console.error("--local needs PRINTS_SECRET_SINK, a command that takes the secret on standard input");
  process.exit(2);
}
// The live origin is the one the Worker's daily check looks for, so it comes from the same place: wrangler.jsonc's vars
const origin = remote
  ? (await import("wrangler")).unstable_readConfig({ config: resolve("wrangler.jsonc") }).vars?.SITE_ORIGIN
  : args.includes("--origin") ? args[args.indexOf("--origin") + 1] : "http://localhost:4331";
if (typeof origin !== "string" || !/^https?:\/\/[^/\s]+$/.test(origin)) {
  console.error(remote ? "wrangler.jsonc has no SITE_ORIGIN var to save the webhook for" : "--origin takes an origin, such as http://localhost:4337");
  process.exit(2);
}
const url = `${origin}/api/prints/artelo`;
const deps = { config: { arteloBase: (process.env.ARTELO_API_BASE ?? "https://www.artelo.com/api/open").replace(/\/+$/, ""), secrets: { ARTELO_API_KEY: key } }, fetch: (input, init) => fetch(input, init) };

const listed = await artelo(deps, "GET", "/webhooks/get");
if (!listed.ok) {
  console.error(`couldn't list artelo's webhooks (artelo answered ${listed.status ?? "nothing"}); nothing was saved`);
  process.exit(1);
}
const hooks = readWebhooks(listed.body);
if (!hooks) {
  // Only its shape: what Artelo lists is never printed
  console.error(`artelo's webhook list couldn't be read (${shapeOf(listed.body)}); nothing was saved`);
  process.exit(1);
}
if (hasWebhook(hooks, url)) {
  console.error(`artelo already has a webhook for ${url}, and its secret can't be read back. nothing was saved: delete that webhook in artelo's dashboard, then run this again.`);
  process.exit(1);
}

// From here on Artelo may hold a webhook whose secret never arrives: the advice is to run this again, which then says so
const again = "run this again; if it says artelo already has the webhook, delete that one in artelo's dashboard first.";
// Ignored is a test order's end and isn't among Save Webhook's filter values; test orders never need a webhook
const saved = await artelo(deps, "POST", "/webhooks/save", { topic: "OrderStatusChange", url, filters: { statuses: ARTELO_STATUSES.filter((status) => status !== "Ignored") } });
if (!saved.ok) {
  console.error(`artelo answered ${saved.status ?? "nothing readable"}; nothing was stored. ${again}`);
  process.exit(1);
}
const body = saved.body;
const secret = typeof body?.secret === "string" ? body.secret : typeof body?.data?.secret === "string" ? body.data.secret : null;
if (!secret) {
  console.error(`artelo's answer had no secret; nothing was stored. ${again}`);
  process.exit(1);
}
// The child gets the secret on standard input and an environment without the Artelo key, which it has no use for
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== "ARTELO_API_KEY"));
const put = spawnSync(sink[0], sink.slice(1), { input: secret, stdio: ["pipe", "ignore", "inherit"], env });
if (put.status !== 0) {
  console.error(`storing the secret failed. ${again}`);
  process.exit(1);
}
console.log(remote ? "webhook saved; its secret is stored in infisical, whose sync carries it to the worker." : "webhook saved; its secret went to the local sink.");
