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
  emit(obj) { for (const f of this.l.message || []) f({ data: this.blob ? new Blob([JSON.stringify(obj)]) : JSON.stringify(obj) }); }
}
let serverWs, xaiWs;
const openaiWs = [], geminiWs = [];
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
  if (url.includes("generativelanguage.googleapis.com")) { const w = new FakeWs(); geminiWs.push(w); return { webSocket: w, status: 101 }; }
  if (url.startsWith("https://api.openai.com/v1/realtime")) { const w = new FakeWs(); openaiWs.push(w); return { webSocket: w, status: 101 }; }
  if (url.includes("data.brreg.no")) {
    if (url.includes("enheter?navn=")) return OrigResponse.json({ _embedded: { enheter: [{ organisasjonsnummer: "912345678", navn: "FJELL RØR AS", naeringskode1: { beskrivelse: "Rørleggerarbeid" }, forretningsadresse: { poststed: "BERGEN" } }] } });
    if (url.includes("/enheter/912345678")) return OrigResponse.json({ organisasjonsnummer: "912345678", navn: "FJELL RØR AS", hjemmeside: "", epostadresse: "post@gmail.com",
      naeringskode1: { beskrivelse: "Rørleggerarbeid" }, forretningsadresse: { adresse: ["Fjellveien 12"], postnummer: "5019", poststed: "BERGEN", kommune: "BERGEN" } });
    return new OrigResponse("{}", { status: 404 });
  }
  if (url.includes("api.x.ai/v1/chat/completions") && String(opt.body || "").includes("Du lager en profil"))
    return OrigResponse.json({ choices: [{ message: { content: JSON.stringify({ navn: "Fjell Rør AS", kortnavn: "Fjell Rør", bransje: "rørleggerfirma", type: "befaring", tjenester: [["Rør", [["Lekkasje", "pris etter befaring"]]]], apent: {}, usikkert: [] }) } }], usage: {} });
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
await test("Petter svarer som kundens sekretær (instruksjoner, verktøy, hilsen)", async () => {
  xaiWs = null;
  await ring.fetch(new Request(streamUrl.replace("wss:", "https:"), { headers: { Upgrade: "websocket" } }), ringEnv);
  await vent(50);
  tlf = serverWs;
  assert.ok(xaiWs, "Grok startet");
  const okt = xaiWs.ut.find((m) => m.type === "session.update").session;
  assert.match(okt.instructions, /Lia Frisør/);
  assert.match(okt.instructions, /# Telefon/);
  assert.match(okt.instructions, /912 34 567/, "Petter vet hvilket nummer det ringes fra");
  assert.doesNotMatch(okt.instructions, /Orvelos demonummer|finn_firma/);
  const navn = okt.tools.map((t) => t.name);
  assert.deepEqual(navn.sort(), ["finn_ledige_tider", "legg_igjen_beskjed", "legg_paa", "send_timeforesporsel"]);
  assert.ok(okt.tools.every((t) => t.type === "function" && t.parameters), "verktøyene har realtime-formatet");
  const hei = xaiWs.ut.find((m) => m.item?.type === "force_message").item.content[0].text;
  assert.match(hei, /^Lia Frisør, god dag!/);
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

// 3b. Samme linje på et Twilio-nummer: webhooken må være signert av Twilio, og strømmen gjelder bare den samtalen
const { twilioSignaturOk } = await import("../worker/ringeagent-worker.js");
async function twilioSig(adresse, felt) {
  let data = adresse;
  for (const k of Object.keys(felt).sort()) data += k + felt[k];
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("hemmelig"), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)))));
}
async function twilioInn(felt, sig) {
  const adresse = "https://ring.example/twilio/innring";
  const r = await ring.fetch(new Request(adresse, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sig ?? await twilioSig(adresse, felt) }, body: new URLSearchParams(felt) }), ringEnv);
  return { status: r.status, xml: await r.text() };
}
const tParam = (xml) => Object.fromEntries([...xml.matchAll(/<Parameter name="([^"]+)" value="([^"]*)"\/>/g)].map((m) => [m[1], m[2]]));
await test("Twilio: signaturen regnes ut som Twilio gjør (kjent eksempel)", async () => {
  // Eksempelet fra Twilios dokumentasjon om webhook-sikkerhet.
  const ok = await twilioSignaturOk({ TWILIO_AUTH_TOKEN: "12345" }, "https://mycompany.com/myapp.php?foo=1&bar=2",
    { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" }, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  assert.equal(ok, true);
});
await test("Twilio: innringing uten gyldig signatur blir avvist", async () => {
  const r = await twilioInn({ CallSid: "CA1", From: "+4791234567", To: "+4756994025" }, "feil");
  assert.equal(r.status, 403);
});
let tStrom;
await test("Twilio: innringing til linjen kobles til strømmen med kundens id", async () => {
  const r = await twilioInn({ CallSid: "CAinn1", From: "+4791234567", To: "+4756994025" });
  assert.equal(r.status, 200);
  assert.match(r.xml, /<Connect><Stream url="wss:\/\/ring\.example\/media">/);
  tStrom = tParam(r.xml);
  assert.equal(tStrom.kunde, "lia-frisor");
  assert.equal(tStrom.modus, "inn");
});
await test("Twilio: strømmen for en annen samtale blir avvist", async () => {
  xaiWs = null;
  await ring.fetch(new Request("https://ring.example/media", { headers: { Upgrade: "websocket" } }), ringEnv);
  serverWs.emit({ event: "start", start: { callSid: "CAannen", streamSid: "MZ1", customParameters: tStrom } });
  await vent(30);
  assert.equal(xaiWs, null, "Petter skal ikke startes");
});
await test("Twilio: endret kunde-id blir avvist", async () => {
  xaiWs = null;
  await ring.fetch(new Request("https://ring.example/media", { headers: { Upgrade: "websocket" } }), ringEnv);
  serverWs.emit({ event: "start", start: { callSid: "CAinn1", streamSid: "MZ1", customParameters: { ...tStrom, kunde: "annen-kunde" } } });
  await vent(30);
  assert.equal(xaiWs, null, "Petter skal ikke startes");
});
await test("Twilio: Petter svarer som kundens sekretær og sender lyd med streamSid", async () => {
  xaiWs = null;
  await ring.fetch(new Request("https://ring.example/media", { headers: { Upgrade: "websocket" } }), ringEnv);
  const ws = serverWs;
  ws.emit({ event: "start", start: { callSid: "CAinn1", streamSid: "MZ1", customParameters: tStrom } });
  await vent(50);
  assert.ok(xaiWs, "Petter startet");
  const okt = xaiWs.ut.find((m) => m.type === "session.update").session;
  assert.match(okt.instructions, /Lia Frisør/);
  assert.match(xaiWs.ut.find((m) => m.item?.type === "force_message").item.content[0].text, /^Lia Frisør, god dag!/);
  xaiWs.emit({ type: "response.output_audio.delta", delta: "AAAA" });
  await vent(10);
  assert.ok(ws.ut.some((m) => m.event === "media" && m.streamSid === "MZ1"), "lyden går til Twilio-strømmen");
  ws.close();
});
await test("Twilio: Orvelos eget nummer (uten linje) svarer som demonummer", async () => {
  const r = await twilioInn({ CallSid: "CAdemo", From: "+4798765432", To: "+4755608323" });
  const p = tParam(r.xml);
  assert.equal(p.kunde, undefined);
  xaiWs = null;
  await ring.fetch(new Request("https://ring.example/media", { headers: { Upgrade: "websocket" } }), ringEnv);
  serverWs.emit({ event: "start", start: { callSid: "CAdemo", streamSid: "MZ2", customParameters: p } });
  await vent(30);
  const okt = xaiWs.ut.find((m) => m.type === "session.update").session;
  assert.match(okt.instructions, /Orvelos demonummer/);
  serverWs.close();
});
await test("Twilio: INNRING=av avviser samtalen", async () => {
  ringEnv.INNRING = "av";
  const r = await twilioInn({ CallSid: "CAav", From: "+4791111111", To: "+4756994025" });
  delete ringEnv.INNRING;
  assert.match(r.xml, /<Reject/);
});

// 3c. Demonummeret med OpenAI: Petter spør om mannlig eller kvinnelig sekretær, og Eva tar over ved «kvinnelig»
await test("Demo (OpenAI): Petter spør først om mannlig eller kvinnelig KI-sekretær", async () => {
  ringEnv.OPENAI_API_KEY = "o";
  try {
    const r = await twilioInn({ CallSid: "CAeva", From: "+4798765432", To: "+4755608323" });
    openaiWs.length = 0;
    await ring.fetch(new Request("https://ring.example/media", { headers: { Upgrade: "websocket" } }), ringEnv);
    const tlf = serverWs;
    tlf.emit({ event: "start", start: { callSid: "CAeva", streamSid: "MZ3", customParameters: tParam(r.xml) } });
    await vent(30);
    const petter = openaiWs[0];
    const okt = petter.ut.find((m) => m.type === "session.update").session;
    assert.equal(okt.audio.output.voice, "cedar");
    assert.ok(okt.tools.some((t) => t.name === "bytt_stemme"));
    assert.match(petter.ut.find((m) => m.type === "response.create").response.instructions, /Du har kommet til Petter.*mannlig eller kvinnelig sekretær/);
    // Innringeren sier «kvinnelig»: Petter bruker bytt_stemme, og en ny økt med stemmen marin hilser som Eva.
    petter.emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "Kvinnelig, takk." });
    petter.emit({ type: "response.function_call_arguments.done", name: "bytt_stemme", call_id: "c1", arguments: '{"stemme":"kvinne"}' });
    await vent(30);
    assert.equal(openaiWs.length, 2, "ny økt for Eva");
    const eva = openaiWs[1];
    const evaOkt = eva.ut.find((m) => m.type === "session.update").session;
    assert.equal(evaOkt.audio.output.voice, "marin");
    assert.match(evaOkt.instructions, /Du er Eva/);
    assert.match(evaOkt.instructions, /Kunde: Kvinnelig, takk/);
    assert.match(eva.ut.find((m) => m.type === "response.create").response.instructions, /Du har kommet til Eva/);
    assert.ok(petter.lukket, "Petters økt lukkes");
    assert.ok(!tlf.lukket, "telefonsamtalen fortsetter");
    assert.ok(!petter.ut.some((m) => m.item?.type === "function_call_output"), "ingen svar til den gamle økten");
    // Lyd fra Eva går til telefonen, og lyd fra kunden går til Eva.
    eva.emit({ type: "response.output_audio.delta", delta: "BBBB" });
    tlf.emit({ event: "media", media: { payload: "CCCC" } });
    await vent(10);
    assert.ok(tlf.ut.some((m) => m.event === "media" && m.media.payload === "BBBB"));
    assert.ok(eva.ut.some((m) => m.type === "input_audio_buffer.append" && m.audio === "CCCC"));
    tlf.close();
  } finally { delete ringEnv.OPENAI_API_KEY; }
});
await test("Kundens egen linje (OpenAI) spør ikke om stemme", async () => {
  ringEnv.OPENAI_API_KEY = "o";
  try {
    openaiWs.length = 0;
    await ring.fetch(new Request("https://ring.example/media", { headers: { Upgrade: "websocket" } }), ringEnv);
    serverWs.emit({ event: "start", start: { callSid: "CAinn1", streamSid: "MZ4", customParameters: tStrom } });
    await vent(50);
    const okt = openaiWs[0].ut.find((m) => m.type === "session.update").session;
    assert.ok(!okt.tools.some((t) => t.name === "bytt_stemme"));
    assert.doesNotMatch(okt.instructions, /mannlig eller kvinnelig/);
    serverWs.close();
  } finally { delete ringEnv.OPENAI_API_KEY; }
});

await test("Demo (Gemini): Petter er Puck, sier «god dag», og Eva (Aoede) tar over i en ny økt", async () => {
  ringEnv.GEMINI_API_KEY = "g"; ringEnv.GEMINI_STEMME = "Aoede"; // gammel verdi fra Ada-tiden skal ikke gjøre Petter til kvinne
  try {
    const r = await twilioInn({ CallSid: "CAgem", From: "+4798765400", To: "+4755608323" });
    geminiWs.length = 0;
    await ring.fetch(new Request("https://ring.example/media", { headers: { Upgrade: "websocket" } }), ringEnv);
    const tlf = serverWs;
    tlf.emit({ event: "start", start: { callSid: "CAgem", streamSid: "MZ6", customParameters: tParam(r.xml) } });
    await vent(30);
    const petter = geminiWs[0];
    petter.blob = true; // Cloudflare gir Gemini-svarene som Blob (binære rammer)
    const oppsett = petter.ut[0].setup;
    assert.equal(oppsett.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Puck");
    assert.ok(oppsett.tools[0].functionDeclarations.some((f) => f.name === "bytt_stemme"));
    assert.match(oppsett.systemInstruction.parts[0].text, /Hils med «God dag!»/);
    assert.match(oppsett.systemInstruction.parts[0].text, /Murer: baderom.*fasadeoppussing/, "fagkunnskap for murer");
    assert.match(oppsett.systemInstruction.parts[0].text, /firmaet med nøyaktig det navnet de bekreftet/);
    assert.match(oppsett.systemInstruction.parts[0].text, /ringer fra 987 65 400\. .*bruk dette nummeret/, "tilbyr nummeret de ringer fra");
    assert.match(oppsett.systemInstruction.parts[0].text, /Si aldri «okei»/);
    assert.match(oppsett.systemInstruction.parts[0].text, /uttales «Orvello»/);
    petter.emit({ setupComplete: {} });
    await vent(10);
    assert.match(petter.ut[1].clientContent.turns[0].parts[0].text, /God dag! Du har kommet til Petter, kå-i-sekretær for Orvello.*mannlig eller kvinnelig/);
    petter.emit({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: Buffer.alloc(4800).toString("base64") } }] } } });
    await vent(10);
    assert.ok(tlf.ut.some((m) => m.event === "media" && m.streamSid === "MZ6"), "lyden fra Gemini (Blob) når telefonen");
    petter.emit({ serverContent: { inputTranscription: { text: "Kvinnelig." } } });
    petter.emit({ serverContent: { turnComplete: true } });
    petter.emit({ toolCall: { functionCalls: [{ id: "g1", name: "bytt_stemme", args: { stemme: "kvinne" } }] } });
    await vent(30);
    assert.equal(geminiWs.length, 2, "ny økt for Eva");
    const eva = geminiWs[1];
    eva.blob = true;
    assert.equal(eva.ut[0].setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Aoede");
    assert.match(eva.ut[0].setup.systemInstruction.parts[0].text, /Du er Eva/);
    assert.match(eva.ut[0].setup.systemInstruction.parts[0].text, /Kunde: Kvinnelig/);
    assert.ok(petter.lukket && !tlf.lukket);
    assert.ok(!petter.ut.some((m) => m.toolResponse), "ingen svar til den gamle økten");
    tlf.emit({ event: "media", media: { payload: "//8=" } }); // venter til Eva er klar
    eva.emit({ setupComplete: {} });
    await vent(10);
    assert.match(eva.ut[1].clientContent.turns[0].parts[0].text, /Du har kommet til Eva/);
    assert.ok(eva.ut.some((m) => m.realtimeInput), "lyden fra kunden går til Eva");
    tlf.close();
  } finally { delete ringEnv.GEMINI_API_KEY; delete ringEnv.GEMINI_STEMME; }
});
await test("Demo (Gemini): «du passer fint» bytter ikke til Eva", async () => {
  ringEnv.GEMINI_API_KEY = "g";
  try {
    const r = await twilioInn({ CallSid: "CAgem2", From: "+4798765401", To: "+4755608323" });
    geminiWs.length = 0;
    await ring.fetch(new Request("https://ring.example/media", { headers: { Upgrade: "websocket" } }), ringEnv);
    const tlf = serverWs;
    tlf.emit({ event: "start", start: { callSid: "CAgem2", streamSid: "MZ7", customParameters: tParam(r.xml) } });
    await vent(30);
    const petter = geminiWs[0];
    assert.match(petter.ut[0].setup.systemInstruction.parts[0].text, /Bare hvis de tydelig sier kvinnelig/);
    assert.match(petter.ut[0].setup.systemInstruction.parts[0].text, /stemmer det\?/);
    petter.emit({ setupComplete: {} });
    await vent(10);
    petter.emit({ serverContent: { inputTranscription: { text: "Du passer fint, du." } } });
    petter.emit({ toolCall: { functionCalls: [{ id: "g2", name: "bytt_stemme", args: { stemme: "kvinne" } }] } });
    await vent(30);
    assert.equal(geminiWs.length, 1, "ingen ny økt");
    const svar = petter.ut.find((m) => m.toolResponse);
    assert.ok(svar && svar.toolResponse.functionResponses[0].response.ok === false, "byttet avvises");
    assert.match(svar.toolResponse.functionResponses[0].response.info, /Ikke bytt/);
    tlf.close();
  } finally { delete ringEnv.GEMINI_API_KEY; }
});
await test("Demo (Gemini): blir Petter stille etter et verktøysvar, dyttes han i gang", async () => {
  ringEnv.GEMINI_API_KEY = "g"; ringEnv.DYTT_MS = "100";
  try {
    const r = await twilioInn({ CallSid: "CAgem3", From: "+4798765402", To: "+4755608323" });
    geminiWs.length = 0;
    await ring.fetch(new Request("https://ring.example/media", { headers: { Upgrade: "websocket" } }), ringEnv);
    const tlf = serverWs;
    tlf.emit({ event: "start", start: { callSid: "CAgem3", streamSid: "MZ8", customParameters: tParam(r.xml) } });
    await vent(30);
    const petter = geminiWs[0];
    petter.emit({ setupComplete: {} });
    await vent(10);
    petter.emit({ toolCall: { functionCalls: [{ id: "g3", name: "noter_for_preben", args: { sammendrag: "test" } }] } });
    await vent(2600);
    const dytt = petter.ut.filter((m) => m.clientContent && /venter på svar/.test(m.clientContent.turns[0].parts[0].text));
    assert.equal(dytt.length, 1, "én dytt");
    tlf.close();
  } finally { delete ringEnv.GEMINI_API_KEY; delete ringEnv.DYTT_MS; }
});
await test("Kundens linje med kvinnestemme (Gemini) får Aoede", async () => {
  ringEnv.GEMINI_API_KEY = "g";
  try {
    const { geminiStemme } = await import("../worker/ringeagent-worker.js");
    assert.equal(geminiStemme({}, { oppsett: { stemme: "marin" } }), "Aoede");
    assert.equal(geminiStemme({}, { oppsett: { stemme: "cedar" } }), "Puck");
    assert.equal(geminiStemme({ GEMINI_STEMME: "Aoede" }, {}), "Puck");
  } finally { delete ringEnv.GEMINI_API_KEY; }
});

// 3d. Demonummeret: ukjent firma slås opp i Brønnøysund, og Petter lager sekretæren under samtalen
await test("Demo: ukjent firma gir treff fra Brønnøysund, og lag_demo lager sekretæren", async () => {
  const r = await twilioInn({ CallSid: "CAbrreg", From: "+4798700000", To: "+4755608323" });
  xaiWs = null;
  await ring.fetch(new Request("https://ring.example/media", { headers: { Upgrade: "websocket" } }), ringEnv);
  const tlf = serverWs;
  tlf.emit({ event: "start", start: { callSid: "CAbrreg", streamSid: "MZ5", customParameters: tParam(r.xml) } });
  await vent(30);
  const ai = xaiWs;
  assert.ok(ai.ut.find((m) => m.type === "session.update").session.tools.some((t) => t.name === "lag_demo"));
  const svar = async (navn, args, id) => {
    ai.emit({ type: "response.function_call_arguments.done", name: navn, call_id: id, arguments: JSON.stringify(args) });
    for (let i = 0; i < 50 && !ai.ut.some((m) => m.item?.call_id === id); i++) await vent(20);
    return JSON.parse(ai.ut.find((m) => m.item?.call_id === id).item.output);
  };
  const f = await svar("finn_firma", { navn: "Fjell Rør" }, "f1");
  assert.equal(f.funnet, false);
  assert.equal(f.brreg[0].orgnr, "912345678");
  assert.equal(f.brreg[0].sted, "Bergen");
  const feilNr = await svar("lag_demo", { orgnr: "999999999" }, "f2");
  assert.equal(feilNr.ok, false, "bare org.nr fra treffene");
  const laget = await svar("lag_demo", { orgnr: "912 345 678" }, "f3");
  assert.equal(laget.funnet, true);
  assert.match(laget.instruksjoner, /Fjell Rør/);
  assert.ok(ai.ut.some((m) => m.type === "session.update" && /sekretæren til Fjell Rør/.test(m.session.instructions || "")));
  const id = [...lager.keys()].find((k) => k.startsWith("kunde:p-fjell-ror-"));
  assert.ok(id, "prøve-sekretæren er lagret");
  assert.equal(JSON.parse(lager.get(id)).provDemo.kilde, "telefon");
  tlf.close();
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
