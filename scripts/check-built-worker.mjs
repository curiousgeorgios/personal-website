// Spec 13.3: the built Worker must keep its cron, its three rate limits and its email binding, and its entry must
// export scheduled. Run after a build: bun run check does, and so do both CI jobs.
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync("dist/server/wrangler.json", "utf8"));
const problems = [];
if (JSON.stringify(config.triggers?.crons) !== JSON.stringify(["*/5 * * * *"])) problems.push(`the cron is ${JSON.stringify(config.triggers?.crons)}, not every five minutes`);
const limits = { QUOTE_LIMIT: [10, 60], CHECKOUT_LIMIT: [6, 60], ARTELO_LIMIT: [30, 10] };
for (const [name, [limit, period]] of Object.entries(limits)) {
  const binding = config.ratelimits?.find((entry) => entry.name === name);
  if (!binding || binding.simple?.limit !== limit || binding.simple?.period !== period) problems.push(`the ${name} rate limit is missing or changed`);
}
if (!config.send_email?.some((entry) => entry.name === "EMAIL")) problems.push("the EMAIL binding is missing");
const entry = readFileSync(`dist/server/${config.main}`, "utf8");
if (!/\bscheduled\b/.test(entry)) problems.push(`${config.main} doesn't export a scheduled handler`);
if (problems.length > 0) {
  console.error(`the built worker lost what prints need:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("the built worker keeps its cron, rate limits, email binding and scheduled handler");
