// Lokal test av en hel telefonsamtale med Ada på Gemini Live, gjennom ringeagentens egen koblSamtale.
// En falsk Telnyx-strøm sender innringerens lyd (μ-law 8 kHz) og stillhet; ingenting ringes, SMS og e-post stoppes.
//
// Oppsett (én gang, i en egen mappe):  npm i ws https-proxy-agent
// Mappen med innringerlyd trenger linjer.json (replikkene) og k1.ulaw, k2.ulaw ... (8 kHz μ-law, f.eks. fra ffmpeg).
// Kjør:  GEMINI_API_KEY=... node tools/test-ada-gemini.mjs "$PWD/worker/ringeagent-worker.js" <mappe>
// Skriver svartidene, samtalen som tekst og <mappe>/samtale.pcm (8 kHz 16 bit, slik det høres i telefonen).
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import fs from "node:fs";
import crypto from "node:crypto";
const [,, workerPath, dir] = process.argv;
const agent = process.env.HTTPS_PROXY ? new HttpsProxyAgent(process.env.HTTPS_PROXY) : undefined;
globalThis.fetch = async (url, opt = {}) => {
  const h = opt.headers || {};
  if (h.Upgrade === "websocket") {
    const ws = new WebSocket(String(url).replace(/^https/, "wss"), { headers: { "x-goog-api-key": h["x-goog-api-key"] }, agent });
    await new Promise((ok, feil) => { ws.once("open", ok); ws.once("error", feil); ws.once("unexpected-response", (q, r) => feil(new Error("HTTP " + r.statusCode))); });
    ws.accept = () => {};
    return { webSocket: ws, status: 101 };
  }
  console.log("  (fetch stoppet i testen:", String(url).slice(0, 70) + ")"); if (/formsubmit/.test(url)) { try { const b = JSON.parse(opt.body); console.log(b.Samtale); } catch { console.log(String(opt.body).slice(0, 2000)); } }
  return new Response("{}", { status: 200 });
};
const m = await import(workerPath.startsWith("/") ? "file://" + workerPath : workerPath);
const linjer = JSON.parse(fs.readFileSync(dir + "/linjer.json", "utf8"));
const env = { GEMINI_API_KEY: process.env.GEMINI_API_KEY, TWILIO_AUTH_TOKEN: "test" };
const ts = String(Date.now()), til = "+4790000000";
const sig = crypto.createHmac("sha256", "test").update(`samtale|${til}|${ts}`).digest("hex");

const t0 = Date.now(); const pos = () => Math.floor((Date.now() - t0) * 8);
// To spor (innringer og Ada) som mikses til slutt, slik at ingen av dem skriver over den andre.
const ULAW = new Int16Array(256);
for (let i = 0; i < 256; i++) { const u = ~i & 0xff, ex = (u >> 4) & 7, ma = u & 15, v = (((ma << 3) + 0x84) << ex) - 0x84; ULAW[i] = u & 0x80 ? -v : v; }
const sporAda = new Int16Array(8000 * 300), sporInn = new Int16Array(8000 * 300);
const skriv = (spor, bytes, fra) => { for (let i = 0; i < bytes.length && fra + i < spor.length; i++) spor[fra + i] = ULAW[bytes[i]]; };
let adaPos = 0, sisteAda = 0, slutt = 0;
const lytt = {}; let lukket = false;
const tlf = {
  addEventListener: (t, f) => { (lytt[t] ||= []).push(f); },
  send: (s) => {
    const e = JSON.parse(s);
    if (e.event === "media") {
      const b = Buffer.from(e.media.payload, "base64");
      if (!sisteAda || Date.now() - sisteAda > 1500) forste.push(Date.now());
      adaPos = Math.max(adaPos, pos()); skriv(sporAda, b, adaPos); adaPos += b.length; sisteAda = Date.now();
    } else if (e.event === "clear") { sporAda.fill(0, pos(), adaPos); adaPos = pos(); console.log("  [clear]"); }
  },
  close: () => { lukket = true; },
};
const forste = [];
const emit = (o) => (lytt.message || []).forEach((f) => f({ data: JSON.stringify(o) }));
const vent = (ms) => new Promise((r) => setTimeout(r, ms));
const p = m.koblSamtale(env, tlf, { til, ts, sig, navn: "Ola Hansen", firma: "Hansen Rør" });
await vent(300); emit({ event: "start", start: { call_control_id: "c1" } });
// Telefonlinje: send stillhet hele tiden (20 ms), og innringerens lyd når det er hans tur.
let kø = Buffer.alloc(0);
const takt = setInterval(() => {
  let bit = kø.subarray(0, 160); kø = kø.subarray(160);
  if (bit.length < 160) bit = Buffer.concat([bit, Buffer.alloc(160 - bit.length, 0xff)]);
  skriv(sporInn, bit, pos()); emit({ event: "media", media: { track: "inbound", payload: bit.toString("base64") } });
}, 20);
const svartider = [];
for (let i = 0; i < linjer.length && !lukket; i++) {
  // vent til Ada har snakket ferdig (1,2 s uten lyd etter at hun har begynt)
  for (let k = 0; k < 300 && !(sisteAda && Date.now() - sisteAda > 1200 && Date.now() * 8 > 0 && adaPos <= pos()); k++) await vent(100);
  const lyd = fs.readFileSync(`${dir}/k${i + 1}.ulaw`);
  console.log("Kunde:", linjer[i]);
  kø = Buffer.concat([kø, lyd]);
  const ferdig = Date.now() + lyd.length / 8;
  await vent(lyd.length / 8);
  const forFor = forste.length;
  for (let k = 0; k < 100 && forste.length === forFor && !lukket; k++) await vent(50);
  if (forste.length > forFor) svartider.push((forste[forste.length - 1] - ferdig) / 1000);
  await vent(400);
}
for (let k = 0; k < 120 && !lukket; k++) await vent(100);
clearInterval(takt);
(lytt.close || []).forEach((f) => f({}));
const lengde = Math.min(sporAda.length, Math.max(adaPos, pos()) + 4000), miks = Buffer.alloc(lengde * 2);
for (let i = 0; i < lengde; i++) miks.writeInt16LE(Math.max(-32768, Math.min(32767, sporAda[i] + sporInn[i])), i * 2);
fs.writeFileSync(dir + "/samtale.pcm", miks); // 8 kHz, 16 bit: ffmpeg -f s16le -ar 8000 -ac 1 -i samtale.pcm samtale.mp3
console.log("Svartider (s):", svartider.map((x) => x.toFixed(2)).join(", "), "lagt på av Ada:", lukket);
setTimeout(() => process.exit(0), 1500);
