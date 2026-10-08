import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { standIn, unique } from "./prints";
import { FIXTURE_SECRETS, STAND_IN } from "./prints-site";

// Both scripts against the stand-in and the prints server's own store; never against Artelo or George's stores
test.skip(({ browserName }) => browserName !== "chromium", "the print specs run in chromium");

/** Runs a script without blocking this process (the proxy below lives in it), with its own dev registry */
function run(args: string[], env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const registry = mkdtempSync(join(tmpdir(), "prints-scripts-registry-"));
  const child = spawn("node", args, { env: { ...process.env, ARTELO_API_KEY: FIXTURE_SECRETS.ARTELO_API_KEY, CI: "", WRANGLER_REGISTRY_PATH: registry, ...env } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const timer = setTimeout(() => child.kill(), 170_000);
  return new Promise((resolve) => child.on("close", (status) => {
    clearTimeout(timer);
    resolve({ status, stdout, stderr });
  }));
}

/**
 * Between a script and the stand-in, chosen by the first path segment:
 * - every mode makes production US$5.00 a print (the catalogue's shipping matching Price Check's freight), so every margin
 *   clears and only what the mode changes can fail the run;
 * - "missing": Get Orders' name filter finds nothing; "renamed": each order is listed with our id under name, beside a
 *   buyer's details; "unreadable": Get Orders answers no list;
 * - "flaky": the first try of every request answers 429; "busy": the catalogue's costs always answer 503;
 * - "hooks-unreadable": Get Webhooks answers no list; "hooks-down": it answers 503.
 * In process, so the scripts run through run()'s async spawn
 */
async function proxy() {
  const tried = new Set<string>();
  let requests = 0;
  const server = createServer(async (request, response) => {
    requests += 1;
    const [, mode, ...rest] = (request.url ?? "/").split("/");
    const path = `/${rest.join("/")}`;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const route = `${request.method} ${path.split("?")[0]}`;
    const attempt = `${request.method} ${path} ${Buffer.concat(chunks).toString("utf8")}`;
    const answer = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (mode === "flaky" && !tried.has(attempt)) {
      tried.add(attempt);
      return answer(429, { message: "too many requests" });
    }
    if (mode === "busy" && route === "POST /catalog/get-costs") return answer(503, { message: "unavailable" });
    if (mode === "hooks-unreadable" && route === "GET /webhooks/get") return answer(200, { hooks: "?" });
    if (mode === "hooks-down" && route === "GET /webhooks/get") return answer(503, { message: "unavailable" });
    const upstream = await fetch(`${STAND_IN}${path}`, {
      method: request.method, headers: { authorization: request.headers.authorization ?? "", "content-type": "application/json" }, body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
    });
    let value: unknown = await upstream.json().catch(() => null);
    if (upstream.ok && route === "POST /orders/price-check") {
      const costs = (value as { orderCosts: { productionCost: number; total: number } }).orderCosts;
      const production = costs.productionCost / 8;
      value = { orderCosts: { ...costs, productionCost: production, total: Math.round((costs.total - costs.productionCost + production) * 100) / 100 } };
    }
    if (upstream.ok && route === "POST /catalog/get-costs") value = { productionCost: 5, shippingCost: 30 };
    if (upstream.ok && route === "GET /orders/get" && mode === "missing") value = [];
    if (upstream.ok && route === "GET /orders/get" && mode === "unreadable") value = { orders: "?", customer: { name: "Ada Lovelace" } };
    if (upstream.ok && route === "GET /orders/get" && mode === "renamed") {
      value = (value as { orderId: string }[]).map(({ orderId, ...entry }) => ({ ...entry, name: orderId, customerAddress: { name: "Ada Lovelace", street1: "12 Example Street", city: "Bondi Beach" } }));
    }
    answer(upstream.status, value);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { base: (mode: string) => `http://127.0.0.1:${port}/${mode}`, requests: () => requests, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test.describe("prints:webhook", () => {
  /** A sink that stores what it reads, and whether the artelo key reached it */
  const sinkIn = (folder: string) => {
    const sink = join(folder, "sink.mjs");
    const stored = join(folder, "secret.json");
    writeFileSync(sink, `import { readFileSync, writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(stored)}, JSON.stringify({ secret: readFileSync(0, "utf8"), key: process.env.ARTELO_API_KEY ?? null }));`);
    return { sink, stored };
  };
  /** Its own origin each time, so parallel and retried tests never meet each other's webhooks */
  const origin = () => `http://webhook-${unique()}.localhost:4337`;
  const hooksFor = async (url: string) => (await standIn<{ url: string; topic: string; filters: { statuses: string[] }; secret: string }[]>("/__hooks")).filter((entry) => entry.url === url);

  test("saves the webhook for every real status and pipes its secret straight to the store, printing one line", async () => {
    const { sink, stored } = sinkIn(mkdtempSync(join(tmpdir(), "prints-webhook-")));
    const site = origin();
    const result = await run(["scripts/artelo-webhook.mjs", "--local", "--origin", site], { ARTELO_API_BASE: STAND_IN, PRINTS_SECRET_SINK: `node ${sink}` });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("webhook saved; its secret went to the local sink.\n");
    const [hook, ...more] = await hooksFor(`${site}/api/prints/artelo`);
    expect(more).toEqual([]);
    expect(hook).toMatchObject({ topic: "OrderStatusChange", filters: { statuses: ["ImagesProcessing", "Received", "PendingFulfillmentAction", "InProduction", "Shipped", "Delivered", "Canceled"] } });
    // The secret on standard input, and the artelo key kept from the child
    expect(JSON.parse(readFileSync(stored, "utf8"))).toEqual({ secret: hook.secret, key: null });
    expect(result.stdout + result.stderr).not.toContain(hook.secret);
  });

  test("refuses to save anything when the secret has nowhere to go", async () => {
    const site = origin();
    const result = spawnSync("node", ["scripts/artelo-webhook.mjs", "--local", "--origin", site], { env: { ...process.env, ARTELO_API_KEY: FIXTURE_SECRETS.ARTELO_API_KEY, ARTELO_API_BASE: STAND_IN, PRINTS_SECRET_SINK: "" }, encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(await hooksFor(`${site}/api/prints/artelo`)).toEqual([]);
  });

  test("a failed store, then a rerun, leaves one webhook: the rerun sees ours and tells george to delete it in artelo", async () => {
    const folder = mkdtempSync(join(tmpdir(), "prints-webhook-"));
    const failing = join(folder, "failing.mjs");
    writeFileSync(failing, "process.exit(1);");
    const { sink, stored } = sinkIn(folder);
    const site = origin();
    const url = `${site}/api/prints/artelo`;
    const first = await run(["scripts/artelo-webhook.mjs", "--local", "--origin", site], { ARTELO_API_BASE: STAND_IN, PRINTS_SECRET_SINK: `node ${failing}` });
    expect(first.status).toBe(1);
    expect(first.stderr).toContain("storing the secret failed. run this again; if it says artelo already has the webhook, delete that one in artelo's dashboard first.");
    const second = await run(["scripts/artelo-webhook.mjs", "--local", "--origin", site], { ARTELO_API_BASE: STAND_IN, PRINTS_SECRET_SINK: `node ${sink}` });
    expect(second.status).toBe(1);
    expect(second.stdout).toBe("");
    expect(second.stderr).toBe(`artelo already has a webhook for ${url}, and its secret can't be read back. nothing was saved: delete that webhook in artelo's dashboard, then run this again.\n`);
    expect(await hooksFor(url)).toHaveLength(1);
    expect(existsSync(stored)).toBe(false);
  });

  test("saves nothing when artelo's webhook list can't be read or can't be had", async () => {
    const between = await proxy();
    try {
      for (const [mode, line] of [
        ["hooks-unreadable", "artelo's webhook list couldn't be read (an object with keys hooks); nothing was saved\n"],
        ["hooks-down", "couldn't list artelo's webhooks (artelo answered 503); nothing was saved\n"],
      ]) {
        const { sink, stored } = sinkIn(mkdtempSync(join(tmpdir(), "prints-webhook-")));
        const site = origin();
        const result = await run(["scripts/artelo-webhook.mjs", "--local", "--origin", site], { ARTELO_API_BASE: between.base(mode), PRINTS_SECRET_SINK: `node ${sink}` });
        expect(result.status).toBe(1);
        expect(result.stderr).toBe(line);
        expect(await hooksFor(`${site}/api/prints/artelo`)).toEqual([]);
        expect(existsSync(stored)).toBe(false);
      }
    } finally {
      await between.close();
    }
  });
});

/** prints:check against a store (the prints server's own, read only) */
const printCheck = (base: string, store = ".wrangler/prints") => run(["scripts/print-check.mjs", "--local", "--persist-to", store], { ARTELO_API_BASE: base, PRINTS_CHECK_PACE_MS: "0", PRINTS_CHECK_RETRY_MS: "0" });

test.describe("prints:check", () => {
  // One at a time: each opens the prints server's store beside the running server
  test.describe.configure({ mode: "default" });
  test.setTimeout(180_000);

  /** One run through a fresh proxy */
  const through = async (mode: string) => {
    const between = await proxy();
    try {
      return await printCheck(between.base(mode));
    } finally {
      await between.close();
    }
  };

  test("prints every answer, fails a margin under 15%, prints antarctica's refusal and checks the lookup", async () => {
    const result = await printCheck(STAND_IN);
    // The stand-in's US$40.00 production a print sinks the small unframed margin, so the run fails, as it should
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("rate a$1.50 per us$1, buffer 8%");
    expect(result.stdout).toMatch(/FAIL 2:3 small x8x12 unframed to sydney opera house: the margin is -?\d+%, under 15%/);
    // A loss reads as one, rather than stopping the run
    expect(result.stdout).toMatch(/2:3 small x8x12 unframed to sydney opera house: production us\$40\.00 \(\$61\.80\), price \$59, card fee \$2\.37, freight shortfall \$0, margin -\$5\.17 \(-9%\), delivery \$49/);
    expect(result.stdout).toContain("two prints to the white house: freight us$30.00 together; alone us$30.00 and us$30.00");
    expect(result.stdout).toContain("antarctica: artelo answered 400 artelo doesn't deliver to antarctica");
    // The test order's artelo id, so george can find it there
    expect(result.stdout).toMatch(/^lookup check: test order artelo-\d+ created \(Received\)$/m);
    expect(result.stdout).toContain("lookup check: ok");
    expect(result.stdout + result.stderr).not.toContain(FIXTURE_SECRETS.ARTELO_API_KEY);
  });

  test("passes when every margin clears and get orders finds the just-created order by name, with our id under orderId", async () => {
    const result = await through("cheap");
    expect(result.stdout).not.toContain("FAIL");
    expect(result.stdout).toContain("lookup check: ok");
    expect(result.stdout).toMatch(/\n0 failed, \d+ warnings?\n$/);
    expect(result.status).toBe(0);
  });

  for (const [mode, line] of [
    ["missing", /^FAIL lookup check: get orders' name filter didn't find check-\d+ just after it was created, so placing could create an order twice: don't open prints$/m],
    ["renamed", /^FAIL lookup check: get orders listed 1 entry, the first with keys id, status, name, customerAddress; none holds check-\d+ under orderId, so placing can't match it: don't open prints$/m],
    ["unreadable", /^FAIL lookup check: get orders' answer for check-\d+ couldn't be read \(an object with keys orders, customer\), so every order would stall at its lookup: don't open prints$/m],
  ] as const) {
    test(`fails on the lookup alone, printing no buyer's details, when get orders ${{ missing: "doesn't find the order by name", renamed: "lists it without our id under orderId", unreadable: "answers no list" }[mode]} (spec 25 assumption 8)`, async () => {
      const result = await through(mode);
      expect(result.stdout).toMatch(line);
      expect(result.stdout).not.toContain("lookup check: ok");
      // Only the answer's shape: never a value from what get orders listed
      expect(result.stdout + result.stderr).not.toMatch(/Lovelace|Example Street|Bondi/);
      expect(result.stdout).toMatch(/\n1 failed, \d+ warnings?\n$/);
      expect(result.status).toBe(1);
    });
  }

  test("a 429 or 5xx is asked once more, so a busy moment doesn't fail the run", async () => {
    const result = await through("flaky");
    expect(result.stdout).not.toContain("FAIL");
    expect(result.stdout).toContain("lookup check: ok");
    expect(result.status).toBe(0);
  });

  test("an answer that never comes reads as couldn't check, never as artelo refusing the size table", async () => {
    const result = await through("busy");
    expect(result.stdout).toContain("FAIL 2:3 small x8x12 unframed: couldn't check its catalogue costs to AU (503: unavailable)");
    expect(result.stdout).not.toContain("refused its catalogue costs");
    expect(result.status).toBe(1);
  });

  test("a store without the print tables says to apply the migrations, and asks artelo nothing", async () => {
    const between = await proxy();
    try {
      const result = await printCheck(between.base("cheap"), mkdtempSync(join(tmpdir(), "prints-check-empty-")));
      expect(result.stderr).toContain("the store has no print tables: apply the migrations first");
      expect(result.status).toBe(2);
      expect(between.requests()).toBe(0);
    } finally {
      await between.close();
    }
  });
});
