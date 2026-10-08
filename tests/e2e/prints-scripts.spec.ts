import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { standIn } from "./prints";
import { FIXTURE_SECRETS, PRINTS, STAND_IN } from "./prints-site";

// Both scripts against the stand-in and the prints server's own store; never against Artelo or George's stores
test.skip(({ browserName }) => browserName !== "chromium", "the print specs run in chromium");

test("prints:webhook saves the webhook for every real status and pipes its secret straight to the store, printing one line", async () => {
  const folder = mkdtempSync(join(tmpdir(), "prints-webhook-"));
  const sink = join(folder, "sink.mjs");
  const stored = join(folder, "secret.txt");
  writeFileSync(sink, `import { readFileSync, writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(stored)}, readFileSync(0));`);
  const result = spawnSync("node", ["scripts/artelo-webhook.mjs", "--local", "--origin", PRINTS], {
    env: { ...process.env, ARTELO_API_KEY: FIXTURE_SECRETS.ARTELO_API_KEY, ARTELO_API_BASE: STAND_IN, PRINTS_SECRET_SINK: `node ${sink}` }, encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("webhook saved; its secret went to the local sink.\n");
  const hook = (await standIn<{ url: string; topic: string; filters: { statuses: string[] }; secret: string }[]>("/__hooks")).findLast((entry) => entry.url === `${PRINTS}/api/prints/artelo`)!;
  expect(hook).toMatchObject({ topic: "OrderStatusChange", filters: { statuses: ["ImagesProcessing", "Received", "PendingFulfillmentAction", "InProduction", "Shipped", "Delivered", "Canceled"] } });
  expect(readFileSync(stored, "utf8")).toBe(hook.secret);
  expect(result.stdout + result.stderr).not.toContain(hook.secret);
});

test("prints:webhook refuses to save anything when the secret has nowhere to go", async () => {
  const before = (await standIn<unknown[]>("/__hooks")).length;
  const result = spawnSync("node", ["scripts/artelo-webhook.mjs", "--local"], { env: { ...process.env, ARTELO_API_KEY: FIXTURE_SECRETS.ARTELO_API_KEY, ARTELO_API_BASE: STAND_IN, PRINTS_SECRET_SINK: "" }, encoding: "utf8" });
  expect(result.status).toBe(2);
  expect((await standIn<unknown[]>("/__hooks")).length).toBe(before);
});

/**
 * Between the script and the stand-in, chosen by the first path segment: "cheap" makes production US$5.00 a print (the
 * catalogue's shipping matching Price Check's freight), so every margin clears and only the lookup can fail the run;
 * "missing" is cheap with Get Orders' name filter finding nothing; "renamed" is cheap with each order listed without our id
 * under orderId. In process, so the script runs with an async spawn
 */
async function proxy() {
  const server = createServer(async (request, response) => {
    const [, mode, ...rest] = (request.url ?? "/").split("/");
    const path = `/${rest.join("/")}`;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const upstream = await fetch(`${STAND_IN}${path}`, {
      method: request.method, headers: { authorization: request.headers.authorization ?? "", "content-type": "application/json" }, body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
    });
    let value: unknown = await upstream.json().catch(() => null);
    const route = `${request.method} ${path.split("?")[0]}`;
    if (upstream.ok && route === "POST /orders/price-check") {
      const costs = (value as { orderCosts: { productionCost: number; total: number } }).orderCosts;
      const production = costs.productionCost / 8;
      value = { orderCosts: { ...costs, productionCost: production, total: Math.round((costs.total - costs.productionCost + production) * 100) / 100 } };
    }
    if (upstream.ok && route === "POST /catalog/get-costs") value = { productionCost: 5, shippingCost: 30 };
    if (upstream.ok && route === "GET /orders/get" && mode === "missing") value = [];
    if (upstream.ok && route === "GET /orders/get" && mode === "renamed") value = (value as { orderId: string }[]).map(({ orderId, ...entry }) => ({ ...entry, name: orderId }));
    response.writeHead(upstream.status, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { base: (mode: string) => `http://127.0.0.1:${port}/${mode}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** prints:check against the prints server's own store (read only), with its own dev registry; never blocks this process */
function printCheck(base: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const registry = mkdtempSync(join(tmpdir(), "prints-check-registry-"));
  const child = spawn("node", ["scripts/print-check.mjs", "--local", "--persist-to", ".wrangler/prints"], {
    env: { ...process.env, ARTELO_API_KEY: FIXTURE_SECRETS.ARTELO_API_KEY, ARTELO_API_BASE: base, PRINTS_CHECK_PACE_MS: "0", CI: "", WRANGLER_REGISTRY_PATH: registry },
  });
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

test.describe("prints:check", () => {
  // One at a time: each opens the prints server's store beside the running server
  test.describe.configure({ mode: "default" });

  test("prints every answer, fails a margin under 15%, prints antarctica's refusal and checks the lookup", async () => {
    test.setTimeout(180_000);
    const result = await printCheck(STAND_IN);
    // The stand-in's US$40.00 production a print sinks the small unframed margin, so the run fails, as it should
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("rate a$1.50 per us$1, buffer 8%");
    expect(result.stdout).toMatch(/FAIL 2:3 small x8x12 unframed to sydney opera house: the margin is -?\d+%, under 15%/);
    // A loss reads as one, rather than stopping the run
    expect(result.stdout).toMatch(/2:3 small x8x12 unframed to sydney opera house: production us\$40\.00 \(\$61\.80\), price \$59, card fee \$2\.37, freight shortfall \$0, margin -\$5\.17 \(-9%\), delivery \$49/);
    expect(result.stdout).toContain("two prints to the white house: freight us$30.00 together; alone us$30.00 and us$30.00");
    expect(result.stdout).toContain("antarctica: artelo answered 400 artelo doesn't deliver to antarctica");
    expect(result.stdout).toContain("lookup check: ok");
    expect(result.stdout + result.stderr).not.toContain(FIXTURE_SECRETS.ARTELO_API_KEY);
  });

  test("passes when every margin clears and get orders finds the just-created order by name, with our id under orderId", async () => {
    test.setTimeout(180_000);
    const between = await proxy();
    try {
      const result = await printCheck(between.base("cheap"));
      expect(result.stdout).not.toContain("FAIL");
      expect(result.stdout).toContain("lookup check: ok");
      expect(result.stdout).toMatch(/\n0 failed, \d+ warnings?\n$/);
      expect(result.status).toBe(0);
    } finally {
      await between.close();
    }
  });

  for (const [mode, line] of [
    ["missing", /^FAIL lookup check: get orders' name filter didn't find check-\d+ just after it was created, so placing could create an order twice: don't open prints$/m],
    ["renamed", /^FAIL lookup check: get orders listed check-\d+ without its id under orderId \(.*"name":"check-\d+".*\), so placing can't match it: don't open prints$/m],
  ] as const) {
    test(`fails on the lookup alone when get orders ${mode === "missing" ? "doesn't find the order by name" : "lists it without our id under orderId"} (spec 25 assumption 8)`, async () => {
      test.setTimeout(180_000);
      const between = await proxy();
      try {
        const result = await printCheck(between.base(mode));
        expect(result.stdout).toMatch(line);
        expect(result.stdout).not.toContain("lookup check: ok");
        expect(result.stdout).toMatch(/\n1 failed, \d+ warnings?\n$/);
        expect(result.status).toBe(1);
      } finally {
        await between.close();
      }
    });
  }
});
