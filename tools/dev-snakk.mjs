// Lokal test av den snakkbare demoen: XAI_API_KEY=... node tools/dev-snakk.mjs  ->  http://localhost:8787/?k=test
// /lag, /rediger og /avtale/ny virker lokalt med admin-koden "admin" (alt lagres bare i minnet).
// Filer fra GitHub (snakk/lag.html, avtale/*.html) leses fra denne mappen i stedet, og e-postvarsler skrives bare ut i terminalen.
import http from "http"; import fs from "fs";
import worker from "../worker/sekretar-worker.js";
const page = new URL("../snakk/index.html", import.meta.url);
const lager = new Map(), meta = new Map(); // i stedet for Cloudflare KV
const env = { XAI_API_KEY: process.env.XAI_API_KEY, DEMO_KODE: "test", ADMIN_KODE: "admin",
  KUNDER: {
    get: async (k, t) => (lager.has(k) ? (t === "json" ? JSON.parse(lager.get(k)) : lager.get(k)) : null),
    put: async (k, v, o) => { lager.set(k, v); meta.set(k, o && o.metadata); },
    list: async ({ prefix = "" } = {}) => ({ keys: [...lager.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: meta.get(name) })), list_complete: true }),
  } };
const ekteFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const href = typeof input === "string" ? input : input.url;
  const gh = "https://raw.githubusercontent.com/preben-creator/marketing-agency-/main/";
  if (href.startsWith(gh)) {
    const f = new URL("../" + href.slice(gh.length), import.meta.url);
    return fs.existsSync(f) ? new Response(fs.readFileSync(f, "utf8")) : new Response("ikke funnet", { status: 404 });
  }
  if (href.startsWith("https://formsubmit.co/")) { console.log("[e-postvarsel]", init && init.body); return new Response("{}"); }
  return ekteFetch(input, init);
};
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost:8787");
  if (u.pathname === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(fs.readFileSync(page)); }
  const body = []; for await (const c of req) body.push(c);
  const r = await worker.fetch(new Request(u, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => k !== "origin")), body: req.method === "POST" ? Buffer.concat(body) : undefined }), env, { waitUntil: () => {} });
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, () => console.log("http://localhost:8787/?k=test  ·  lag ny: http://localhost:8787/lag  ·  tilbud: http://localhost:8787/avtale/ny (kode: admin)"));
