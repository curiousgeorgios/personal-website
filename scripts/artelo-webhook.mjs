// bun run prints:webhook --local [--origin URL] | --remote (spec 18.6): saves Artelo's OrderStatusChange webhook for every
// status and pipes the returned secret straight to the Worker's secret store on standard input, never printing it.
// --remote stores it with wrangler secret put ARTELO_WEBHOOK_SECRET; --local hands it to PRINTS_SECRET_SINK, a command
// that reads it from standard input. The Artelo key comes from ARTELO_API_KEY.
import { spawnSync } from "node:child_process";
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
const sink = remote ? ["bunx", "wrangler", "secret", "put", "ARTELO_WEBHOOK_SECRET"] : (process.env.PRINTS_SECRET_SINK ?? "").split(" ").filter(Boolean);
// Checked before Artelo is asked, so no webhook is saved whose secret has nowhere to go
if (sink.length === 0) {
  console.error("--local needs PRINTS_SECRET_SINK, a command that takes the secret on standard input");
  process.exit(2);
}
const origin = remote ? "https://curiousgeorge.dev" : (args.includes("--origin") ? args[args.indexOf("--origin") + 1] : "http://localhost:4331");
if (!/^https?:\/\/[^/\s]+$/.test(origin ?? "")) {
  console.error("--origin takes an origin, such as http://localhost:4337");
  process.exit(2);
}
const base = (process.env.ARTELO_API_BASE ?? "https://www.artelo.com/api/open").replace(/\/+$/, "");
const response = await fetch(`${base}/webhooks/save`, {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
  // Ignored is a test order's end and isn't among Save Webhook's filter values; test orders never need a webhook
  body: JSON.stringify({ topic: "OrderStatusChange", url: `${origin}/api/prints/artelo`, filters: { statuses: ARTELO_STATUSES.filter((status) => status !== "Ignored") } }),
  signal: AbortSignal.timeout(15_000),
  // The key goes to the configured host and nowhere else
  redirect: "manual",
}).catch(() => null);
if (!response?.ok) {
  console.error(`artelo answered ${response?.status ?? "nothing"}; nothing was stored on the worker`);
  process.exit(1);
}
const body = await response.json().catch(() => null);
const secret = typeof body?.secret === "string" ? body.secret : typeof body?.data?.secret === "string" ? body.data.secret : null;
if (!secret) {
  console.error("artelo's answer had no secret; nothing was stored on the worker");
  process.exit(1);
}
const put = spawnSync(sink[0], sink.slice(1), { input: secret, stdio: ["pipe", "ignore", "inherit"] });
if (put.status !== 0) {
  console.error("storing the secret failed; run this again");
  process.exit(1);
}
console.log(remote ? "webhook saved; its secret is stored on the worker." : "webhook saved; its secret went to the local sink.");
