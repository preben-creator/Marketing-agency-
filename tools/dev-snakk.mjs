// Lokal test av den snakkbare demoen: XAI_API_KEY=... node tools/dev-snakk.mjs  ->  http://localhost:8787/?k=test
import http from "http"; import fs from "fs";
import worker from "../worker/sekretar-worker.js";
const page = new URL("../snakk/index.html", import.meta.url);
const env = { XAI_API_KEY: process.env.XAI_API_KEY, DEMO_KODE: "test" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost:8787");
  if (u.pathname === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(fs.readFileSync(page)); }
  const body = []; for await (const c of req) body.push(c);
  const r = await worker.fetch(new Request(u, { method: req.method, headers: req.headers, body: req.method === "POST" ? Buffer.concat(body) : undefined }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, () => console.log("http://localhost:8787/?k=test"));
