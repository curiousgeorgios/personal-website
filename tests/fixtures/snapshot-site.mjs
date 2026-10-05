// A small site for the snapshot specs to capture (tests/e2e/snapshots-live.spec.ts), so nothing real is visited.
//   /             a detailed page: its screenshot is far over the 10KB floor. Its script tag points at
//                 /ingest/static/array.js, where a first-party analytics proxy would sit, so the capture must block it
//   /ingest/...   counted, and never reached while the capture blocks every /ingest/ path (spec 9)
//   /ingest-hits  how many /ingest/ requests arrived, as plain text; not under /ingest/, so neither blocked nor counted
//   /busy         a page that asks for /busy-ping every 500ms for ever, so its network never goes quiet: it's shot at
//                 the 15s cap, which only works if the wait's TimeoutError keeps its name through wrangler's bundle
//   /busy-ping    a tiny 200 for /busy
//   /blank        an empty body, which the capture reads as blank before any shot
//   anything else is a 404
import { createServer } from "node:http";

const PORT = 4400;
const tiles = Array.from({ length: 48 }, (_, i) => `<div style="background:hsl(${i * 7.5} 60% ${40 + (i % 5) * 8}%)"></div>`).join("");
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>a fixture for snapshots</title>
<style>body{margin:0;font:18px/1.5 system-ui;background:linear-gradient(135deg,#f4efe6,#d9e4f5)}main{padding:48px}
h1{font-size:64px;margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(8,1fr);gap:12px}.grid div{height:90px;border-radius:8px}</style>
<script async src="/ingest/static/array.js"></script>
</head><body><main><h1>a fixture page</h1><p>${"a line of text so the capture has something to show. ".repeat(24)}</p>
<div class="grid">${tiles}</div></main></body></html>`;
const busy = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>a busy fixture</title>
<style>body{margin:0;font:18px/1.5 system-ui}main{padding:48px}h1{font-size:64px;margin:0 0 24px}</style>
<script>setInterval(() => fetch("/busy-ping", { cache: "no-store" }).catch(() => {}), 500);</script>
</head><body><main><h1>a busy fixture page</h1><p>${"its network never goes quiet, so it's shot at the cap. ".repeat(24)}</p></main></body></html>`;
const blank = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>a blank fixture</title></head><body></body></html>`;

const html = "text/html; charset=utf-8";
const routes = {
  "/": [html, page],
  "/busy": [html, busy],
  "/busy-ping": ["text/plain; charset=utf-8", "ok"],
  "/blank": [html, blank],
};

let ingestHits = 0;

createServer((request, response) => {
  if (request.url.startsWith("/ingest/")) ingestHits += 1;
  if (request.url === "/ingest-hits") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end(String(ingestHits));
    return;
  }
  const found = routes[request.url];
  response.writeHead(found ? 200 : 404, { "content-type": found ? found[0] : html, "cache-control": "no-store" });
  response.end(found ? found[1] : "<!doctype html><title>missing</title><p>nothing here</p>");
}).listen(PORT, "127.0.0.1", () => console.log(`snapshot fixture site on http://127.0.0.1:${PORT}`));
