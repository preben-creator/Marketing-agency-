// Tester samtaleflyten i ringeagenten uten ekte telefon eller Grok:
// tidlig oppstart, avbrytelser, at ha det-replikken ikke kuttes, og at stillhet avslutter samtalen.
//   node tools/test-ringeagent.mjs
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const env = {
  XAI_API_KEY: "x", TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "hemmelig",
  TELNYX_API_KEY: "k", TELNYX_CONNECTION_ID: "c", TELNYX_FROM: "+4756994025",
  VARSEL_EPOST: "test@example.com", STILLE_MS: "1500",
};
const sign = (msg) => createHmac("sha256", env.TWILIO_AUTH_TOKEN).update(msg).digest("hex");
const vent = (ms) => new Promise((r) => setTimeout(r, ms));

class FakeWs {
  constructor() { this.l = {}; this.ut = []; this.readyState = 1; this.lukket = false; }
  accept() {}
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  send(d) { this.ut.push(JSON.parse(d)); }
  close() { if (this.lukket) return; this.lukket = true; this.readyState = 3; for (const f of this.l.close || []) f({}); }
  emit(obj) { for (const f of this.l.message || []) f({ data: JSON.stringify(obj) }); }
}

// Workerens WebSocketPair finnes ikke i Node, så vi lager en enkel variant.
let serverWs;
globalThis.WebSocketPair = function () { serverWs = new FakeWs(); return { 0: new FakeWs(), 1: serverWs }; };
const OrigResponse = globalThis.Response;
globalThis.Response = class extends OrigResponse {
  constructor(body, init = {}) { super(body, init.status === 101 ? { ...init, status: 200 } : init); }
};

let xaiWs;
const kall = [];
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  kall.push({ url, t: Date.now(), body: opt.body });
  if (url.startsWith("https://api.x.ai/v1/realtime")) { xaiWs = new FakeWs(); return { webSocket: xaiWs, status: 101 }; }
  return { ok: true, status: 200, text: async () => "{}", json: async () => ({}) };
};

const worker = (await import("../worker/ringeagent-worker.js")).default;

async function nySamtale() {
  kall.length = 0; xaiWs = null;
  const ts = String(Date.now());
  const q = new URLSearchParams({ til: "+4791234567", ts, sig: sign(`samtale|+4791234567|${ts}`), navn: "Kari", firma: "Kari Rør" });
  const t0 = Date.now();
  await worker.fetch(new Request(`https://ring.example/media?${q}`, { headers: { Upgrade: "websocket" } }), env);
  await vent(20);
  return { tlf: serverWs, t0 };
}
const lyd = (ms) => Buffer.alloc(Math.round(ms * 8)).toString("base64"); // PCMU: 8 byte per ms

// 1) Grok startes før telefonstrømmen sier «start», og lyden venter til strømmen er klar
{
  const { tlf } = await nySamtale();
  assert.ok(xaiWs, "Grok skal kobles til med en gang strømmen åpnes (Telnyx)");
  const okt = xaiWs.ut.find((m) => m.type === "session.update");
  assert.equal(okt.session.turn_detection.silence_duration_ms, 450);
  assert.ok(xaiWs.ut.some((m) => m.item?.type === "force_message"), "første replikk sendes");
  xaiWs.emit({ type: "response.created" });
  xaiWs.emit({ type: "response.output_audio.delta", delta: lyd(100) });
  assert.equal(tlf.ut.filter((m) => m.event === "media").length, 0, "ingen lyd før start");
  tlf.emit({ event: "start", start: { call_control_id: "cc1" } });
  assert.equal(tlf.ut.filter((m) => m.event === "media").length, 1, "lyden sendes når strømmen er klar");
  console.log("✓ Grok kobles til før «start», og lyden venter på strømmen");

  // 2) Avbrytelse: resten av svaret droppes til et nytt svar starter
  xaiWs.emit({ type: "response.output_audio.delta", delta: lyd(2000) });
  xaiWs.emit({ type: "input_audio_buffer.speech_started" });
  assert.ok(tlf.ut.some((m) => m.event === "clear"), "telefonlyden tømmes");
  const før = tlf.ut.filter((m) => m.event === "media").length;
  xaiWs.emit({ type: "response.output_audio.delta", delta: lyd(500) });
  assert.equal(tlf.ut.filter((m) => m.event === "media").length, før, "lyd fra avbrutt svar droppes");
  xaiWs.emit({ type: "response.created" });
  xaiWs.emit({ type: "response.output_audio.delta", delta: lyd(100) });
  assert.equal(tlf.ut.filter((m) => m.event === "media").length, før + 1, "nytt svar spilles");
  console.log("✓ Avbrytelse stopper lyden og dropper resten av det gamle svaret");

  // 3) legg_paa venter til ha det er spilt av
  xaiWs.emit({ type: "response.created" });
  xaiWs.emit({ type: "response.output_audio.delta", delta: lyd(1500) });
  const tLegg = Date.now();
  xaiWs.emit({ type: "response.function_call_arguments.done", name: "legg_paa", call_id: "1", arguments: "{}" });
  await vent(1200);
  assert.ok(!kall.some((k) => k.url.includes("/hangup")), "legger ikke på mens ha det spilles");
  await vent(1500);
  const h = kall.find((k) => k.url.includes("/hangup"));
  assert.ok(h, "legger på etterpå");
  assert.ok(h.t - tLegg >= 1500, `ventet ${h.t - tLegg} ms`);
  console.log(`✓ Legger på ${h.t - tLegg} ms etter legg_paa, når ha det er spilt av (1,5 sek lyd)`);
}

// 4) Stillhet: spør én gang, så legger den på
{
  const { tlf } = await nySamtale();
  tlf.emit({ event: "start", start: { call_control_id: "cc2" } });
  await vent(1700);
  assert.ok(xaiWs.ut.some((m) => m.type === "response.create" && /stille/.test(m.response?.instructions || "")), "spør om personen er der");
  await vent(1500);
  assert.ok(kall.some((k) => k.url.includes("cc2/actions/hangup")), "legger på etter stillhet");
  console.log("✓ Stillhet: spør om de er der, og legger på hvis ingen svarer");
}

// 5) Ugyldig signatur gir ingen Grok-tilkobling
{
  kall.length = 0; xaiWs = null;
  const q = new URLSearchParams({ til: "+4791234567", ts: String(Date.now()), sig: "feil" });
  await worker.fetch(new Request(`https://ring.example/media?${q}`, { headers: { Upgrade: "websocket" } }), env);
  await vent(20);
  assert.equal(xaiWs, null);
  assert.ok(serverWs.lukket);
  console.log("✓ Ugyldig signatur avvises før Grok kobles til");
}
console.log("\nAlle testene bestått");
process.exit(0);
