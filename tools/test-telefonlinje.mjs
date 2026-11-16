// Tester telefonlinjen for kunder uten ekte telefon, Grok eller SMS:
//   - Preben legger inn et nummer på /lag (del 4) -> linje:<nummer> i KV, ett nummer kan bare ha én kunde
//   - /telefon/* i orvelo-sekretar krever signatur, og svarer bare når linjen er slått på
//   - en innringing til nummeret blir besvart som kundens egen sekretær (instruksjoner, verktøy, første replikk)
//   - verktøyene (ledige tider, booking) kjøres i orvelo-sekretar, timen havner i kalenderen, firmaet får e-post
//   - etter samtalen logges den til ukesrapporten og kvalitetssjekken, uten innringerens nummer
//   - Orvelos eget demonummer (uten linje) virker som før
//
//   node tools/test-telefonlinje.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lager = new Map();
const KV = {
  get: async (k, t) => (lager.has(k) ? (t === "json" ? JSON.parse(lager.get(k)) : lager.get(k)) : null),
  put: async (k, v) => { lager.set(k, String(v)); },
  delete: async (k) => { lager.delete(k); },
  list: async ({ prefix = "" } = {}) => ({ keys: [...lager.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
};
const demo = JSON.parse(readFileSync(new URL("./demo-profiler.json", import.meta.url)));
await KV.put("kunde:lia-frisor", JSON.stringify({ ...demo["demo-frisor"], id: "lia-frisor" }));
await KV.put("kunde:annen-kunde", JSON.stringify({ ...demo["demo-rorlegger"], id: "annen-kunde" }));
await KV.put("chat:lia-frisor", JSON.stringify({ varselEpost: "lia@example.com" }));

const felles = { TWILIO_AUTH_TOKEN: "hemmelig", KUNDER: KV };
const sekEnv = { ...felles, XAI_API_KEY: "x", ADMIN_KODE: "admin", VARSEL_EPOST: "preben@example.com" };
const ringEnv = { ...felles, XAI_API_KEY: "x", TWILIO_ACCOUNT_SID: "AC", TELNYX_API_KEY: "k", TELNYX_CONNECTION_ID: "c",
  TELNYX_FROM: "+4756994025", VARSEL_EPOST: "preben@example.com", STILLE_MS: "60000" };
const vent = (ms) => new Promise((r) => setTimeout(r, ms));

// --- etterligninger: WebSocket, Telnyx, xAI, e-post ---
class FakeWs {
  constructor() { this.l = {}; this.ut = []; this.readyState = 1; this.lukket = false; }
  accept() {}
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  send(d) { this.ut.push(JSON.parse(d)); }
  close() { if (this.lukket) return; this.lukket = true; this.readyState = 3; for (const f of this.l.close || []) f({}); }
  emit(obj) { for (const f of this.l.message || []) f({ data: JSON.stringify(obj) }); }
}
let serverWs, xaiWs;
globalThis.WebSocketPair = function () { serverWs = new FakeWs(); return { 0: new FakeWs(), 1: serverWs }; };
const OrigResponse = globalThis.Response;
globalThis.Response = class extends OrigResponse {
  constructor(body, init = {}) { super(body, init.status === 101 ? { ...init, status: 200 } : init); }
};
const kall = [];
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  kall.push({ url, body: opt.body });
  if (url.startsWith("https://api.x.ai/v1/realtime")) { xaiWs = new FakeWs(); return { webSocket: xaiWs, status: 101 }; }
  if (url.includes("api.x.ai/v1/chat/completions")) return OrigResponse.json({ choices: [{ message: { role: "assistant", content: '{"tema":"Bestilte dameklipp","kategori":"booking"}' } }], usage: {} });
  if (url.includes("raw.githubusercontent.com")) return new OrigResponse("<html></html>");
  if (url.includes("orvelo-sekretar")) throw new Error("Skal gå via service-bindingen, ikke workers.dev");
  return new OrigResponse("{}", { status: 200, headers: { "Content-Type": "application/json" } });
};

const sek = (await import("../worker/sekretar-worker.js")).default;
const ring = (await import("../worker/ringeagent-worker.js")).default;
const ventPaa = [];
const ctx = { waitUntil: (p) => ventPaa.push(p) };
ringEnv.SEKRETAR = { fetch: (req) => sek.fetch(req, sekEnv, ctx) };

let feil = 0;
async function test(navn, f) {
  try { await f(); console.log("OK   " + navn); }
  catch (e) { feil++; console.log("FEIL " + navn + "\n     " + (e && e.message)); }
}
async function sekKall(sti, body, hoder = {}) {
  const r = await sek.fetch(new Request("https://sek.example" + sti, { method: "POST", headers: { "Content-Type": "application/json", ...hoder }, body: JSON.stringify(body) }), sekEnv, ctx);
  await Promise.all(ventPaa.splice(0));
  return { status: r.status, d: await r.json().catch(() => ({})) };
}
const admin = (id, tillegg) => sekKall("/tillegg/admin", { kode: "admin", id, ...(tillegg ? { tillegg } : {}) });

// 1. Linjen settes på /lag
await test("Nummeret på /lag lager linje:<nummer> -> kunde", async () => {
  const r = await admin("lia-frisor", { kalender: { pa: true }, telefon: { nummer: "56 99 40 25" } });
  assert.equal(r.status, 200, JSON.stringify(r.d));
  assert.equal(r.d.tillegg.telefon.nummer, "+4756994025");
  assert.equal(await KV.get("linje:+4756994025"), "lia-frisor");
});
await test("Samme nummer kan ikke brukes av en annen kunde", async () => {
  const r = await admin("annen-kunde", { telefon: { nummer: "+4756994025" } });
  assert.equal(r.status, 409);
  assert.equal(await KV.get("linje:+4756994025"), "lia-frisor");
});
await test("Ugyldig nummer blir tomt (linjen av)", async () => {
  const r = await admin("annen-kunde", { telefon: { nummer: "123" } });
  assert.equal(r.d.tillegg.telefon.nummer, "");
});

// 2. /telefon/* krever signatur
await test("/telefon/oppsett uten signatur blir avvist", async () => {
  const r = await sekKall("/telefon/oppsett", { kunde: "lia-frisor" });
  assert.equal(r.status, 401);
});
await test("/telefon/oppsett med feil signatur blir avvist", async () => {
  const r = await sekKall("/telefon/oppsett", { kunde: "lia-frisor" }, { "X-Orvelo-Ts": String(Date.now()), "X-Orvelo-Sig": "0".repeat(64) });
  assert.equal(r.status, 401);
});

// 3. En ekte innringing til linjen, fra Telnyx til ferdig booking
let streamUrl = "";
await test("Innringing til linjen besvares med kundens id i signert strøm", async () => {
  kall.length = 0;
  const h = { data: { event_type: "call.initiated", payload: { direction: "incoming", call_control_id: "v3:abc", from: "+4791234567", to: "+4756994025" } } };
  await ring.fetch(new Request("https://ring.example/telnyx", { method: "POST", body: JSON.stringify(h) }), ringEnv);
  const svar = kall.find((k) => k.url.includes("/actions/answer"));
  assert.ok(svar, "Telnyx skal få answer");
  streamUrl = JSON.parse(svar.body).stream_url;
  assert.match(streamUrl, /kunde=lia-frisor/);
});
await test("Endret kunde-id i strømmen blir avvist", async () => {
  const u = new URL(streamUrl.replace("wss:", "https:"));
  u.searchParams.set("kunde", "annen-kunde");
  xaiWs = null;
  await ring.fetch(new Request(u, { headers: { Upgrade: "websocket" } }), ringEnv);
  await vent(20);
  assert.equal(xaiWs, null, "Grok skal ikke startes");
});

let tlf;
await test("Liora svarer som kundens sekretær (instruksjoner, verktøy, hilsen)", async () => {
  xaiWs = null;
  await ring.fetch(new Request(streamUrl.replace("wss:", "https:"), { headers: { Upgrade: "websocket" } }), ringEnv);
  await vent(50);
  tlf = serverWs;
  assert.ok(xaiWs, "Grok startet");
  const okt = xaiWs.ut.find((m) => m.type === "session.update").session;
  assert.match(okt.instructions, /Lia Frisør/);
  assert.match(okt.instructions, /# Telefon/);
  assert.match(okt.instructions, /912 34 567/, "Liora vet hvilket nummer det ringes fra");
  assert.doesNotMatch(okt.instructions, /Orvelos demonummer|finn_firma/);
  const navn = okt.tools.map((t) => t.name);
  assert.deepEqual(navn.sort(), ["finn_ledige_tider", "legg_igjen_beskjed", "legg_paa", "send_timeforesporsel"]);
  assert.ok(okt.tools.every((t) => t.type === "function" && t.parameters), "verktøyene har realtime-formatet");
  const hei = xaiWs.ut.find((m) => m.item?.type === "force_message").item.content[0].text;
  assert.match(hei, /^Lia Frisør, hei!/);
  assert.match(hei, /digitale assistenten/);
  tlf.emit({ event: "start", start: { call_control_id: "v3:abc" } });
});

const onsdag = (() => { const d = new Date(); do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== 3); return d.toISOString().slice(0, 10); })(); // en onsdag
async function verktoy(navn, args) {
  const for_ = xaiWs.ut.length;
  xaiWs.emit({ type: "response.function_call_arguments.done", name: navn, call_id: "c" + Math.random(), arguments: JSON.stringify(args) });
  for (let i = 0; i < 100 && !xaiWs.ut.slice(for_).some((m) => m.item?.type === "function_call_output"); i++) await vent(10);
  await Promise.all(ventPaa.splice(0));
  return JSON.parse(xaiWs.ut.slice(for_).find((m) => m.item?.type === "function_call_output").item.output);
}
let tid = "";
await test("finn_ledige_tider kjøres i orvelo-sekretar med kundens åpningstider", async () => {
  const r = await verktoy("finn_ledige_tider", { dato: onsdag, behandling: "Dameklipp" });
  assert.ok(Array.isArray(r.ledige) && r.ledige.length, JSON.stringify(r));
  tid = r.ledige[0];
});
await test("send_timeforesporsel booker i kalenderen og varsler firmaet", async () => {
  kall.length = 0;
  const r = await verktoy("send_timeforesporsel", { navn: "Kari", mobil: "91234567", behandling: "Dameklipp", dato: onsdag, klokkeslett: tid });
  assert.equal(r.booket, true, JSON.stringify(r));
  const timer = await KV.get("timer:lia-frisor", "json");
  assert.equal(timer.length, 1);
  assert.equal(timer[0].kilde, "telefon");
  const epost = kall.find((k) => /formsubmit|resend/.test(k.url) && /telefonen/.test(k.body || ""));
  assert.ok(epost, "firmaet får e-post om timen fra telefonen");
});
await test("Ukjent verktøy kjøres ikke", async () => {
  const r = await verktoy("finn_firma", { navn: "Annen kunde" });
  assert.ok(r.feil);
});
await test("Etter samtalen: logg til ukesrapport og kvalitetssjekk, uten nummeret", async () => {
  xaiWs.emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "Hei, jeg vil bestille dameklipp. Nummeret er 912 34 567." });
  xaiWs.emit({ type: "response.output_audio_transcript.done", transcript: "Timen er booket." });
  tlf.emit({ event: "stop" });
  for (let i = 0; i < 100 && ![...lager.keys()].some((k) => k.startsWith("spor:")); i++) { await vent(10); await Promise.all(ventPaa.splice(0)); }
  const logg = [...lager.entries()].filter(([k]) => k.startsWith("logg:lia-frisor:")).map(([, v]) => JSON.parse(v));
  assert.equal(logg.length, 1);
  assert.equal(logg[0].kanal, "telefon");
  assert.equal(logg[0].bookinger.length, 1);
  const spor = [...lager.entries()].filter(([k]) => k.startsWith("spor:")).map(([, v]) => v);
  assert.equal(spor.length, 1);
  assert.doesNotMatch(spor[0], /912 34 567/);
  assert.match(spor[0], /"kanal":"telefon"/);
  assert.ok(!kall.some((k) => /formsubmit/.test(k.url) && /Innringing/.test(k.body || "")), "Preben får ikke utskriften på e-post");
});

// 4. Linjen slås av
await test("Tomt nummer slår av linjen og fjerner linje:<nummer>", async () => {
  const r = await admin("lia-frisor", { kalender: { pa: true }, telefon: { nummer: "" } });
  assert.equal(r.d.tillegg.telefon.nummer, "");
  assert.equal(await KV.get("linje:+4756994025"), null);
});
await test("Uten linje er nummeret Orvelos demonummer som før", async () => {
  kall.length = 0;
  const h = { data: { event_type: "call.initiated", payload: { direction: "incoming", call_control_id: "v3:def", from: "+4798765432", to: "+4756994025" } } };
  await ring.fetch(new Request("https://ring.example/telnyx", { method: "POST", body: JSON.stringify(h) }), ringEnv);
  const u = JSON.parse(kall.find((k) => k.url.includes("/actions/answer")).body).stream_url;
  assert.doesNotMatch(u, /kunde=/);
  xaiWs = null;
  await ring.fetch(new Request(u.replace("wss:", "https:"), { headers: { Upgrade: "websocket" } }), ringEnv);
  await vent(30);
  const okt = xaiWs.ut.find((m) => m.type === "session.update").session;
  assert.match(okt.instructions, /Orvelos demonummer/);
  assert.ok(okt.tools.some((t) => t.name === "finn_firma"));
  serverWs.close();
});
await test("Fikk ikke hentet sekretæren: kort beskjed og legg på", async () => {
  await KV.put("linje:+4755000000", "finnes-ikke");
  kall.length = 0;
  const h = { data: { event_type: "call.initiated", payload: { direction: "incoming", call_control_id: "v3:ghi", from: "+4741111111", to: "+4755000000" } } };
  await ring.fetch(new Request("https://ring.example/telnyx", { method: "POST", body: JSON.stringify(h) }), ringEnv);
  const u = JSON.parse(kall.find((k) => k.url.includes("/actions/answer")).body).stream_url;
  xaiWs = null;
  await ring.fetch(new Request(u.replace("wss:", "https:"), { headers: { Upgrade: "websocket" } }), ringEnv);
  await vent(30);
  const okt = xaiWs.ut.find((m) => m.type === "session.update").session;
  assert.equal(okt.tools.length, 0);
  assert.match(xaiWs.ut.find((m) => m.item?.type === "force_message").item.content[0].text, /teknisk problem/);
  serverWs.close();
});

console.log(`\n${feil ? feil + " feil" : "Alt OK"}`);
process.exit(feil ? 1 : 0);
