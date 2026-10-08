// A stand-in for every provider the print code calls (spec 23.3), so no print spec reaches a real service. It starts as
// the exchange rate (Frankfurter's shape); later tasks add Artelo's API, Stripe's three endpoints and the mail sink with
// route(), above the last line. Everything it receives is kept in memory for the specs: GET /__requests.
import { createHmac, createHash } from "node:crypto";
import { createServer } from "node:http";
import { FIXTURE_SECRETS, FIXTURE_STRIPE_KEY, STAND_IN } from "../e2e/prints-site.ts";

const PORT = 4401;
/** What arrived, for the specs to read */
const received = { fx: 0, priceChecks: [], orders: [], webhooks: [], mail: [] };
const routes = [];

/** A handler for a method and an exact path or a pattern: it gets { url, body, headers, match } and returns [status, value, headers?] */
function route(method, path, handler) {
  routes.push({ method, path, handler });
}
const today = () => new Date().toISOString().slice(0, 10);
const keyed = (headers, key) => headers.authorization === `Bearer ${key}`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sign = (secret, text) => createHmac("sha256", secret).update(text).digest("hex");

route("GET", "/fx", () => {
  received.fx += 1;
  return [200, { amount: 1, base: "USD", date: today(), rates: { AUD: 1.5 } }];
});
route("GET", "/__requests", () => [200, received]);

function start() {
  createServer(async (request, response) => {
    const url = new URL(request.url, STAND_IN);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    for (const { method, path, handler } of routes) {
      if (method !== request.method) continue;
      const match = typeof path === "string" ? (path === url.pathname ? [url.pathname] : null) : path.exec(url.pathname);
      if (!match) continue;
      try {
        const [status, value, headers = {}] = await handler({ url, body, headers: request.headers, match });
        const plain = typeof value === "string";
        response.writeHead(status, { "content-type": plain ? "text/html; charset=utf-8" : "application/json", "cache-control": "no-store", ...headers });
        response.end(plain ? value : JSON.stringify(value));
      } catch (error) {
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end(String(error?.stack ?? error));
      }
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "nothing here" }));
  }).listen(PORT, "127.0.0.1", () => console.log(`print stand-in on ${STAND_IN}`));
}

// Routes added by later tasks go above this line
start();
