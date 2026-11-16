// Måler svartiden til stemme-sekretæren (Grok realtime), slik snakk/index.html bruker den.
// Sender et ekte talt spørsmål (PCM 24 kHz mono) i sanntid, så stillhet som en mikrofon,
// og måler: token, tilkobling, hilsen, og tiden fra kunden slutter å snakke til første lyd fra sekretæren.
//
//   XAI_API_KEY=... node tools/maal-stemme.mjs sporsmal.pcm            (standard server_vad)
//   VAD='{"type":"server_vad","silence_duration_ms":300}' RUNDER=3 node tools/maal-stemme.mjs sporsmal.pcm
import { readFileSync } from "node:fs";
const KEY = process.env.XAI_API_KEY;
const pcm = readFileSync(process.argv[2]);
const RUNDER = Number(process.env.RUNDER) || 3;
const VAD = process.env.VAD ? JSON.parse(process.env.VAD) : { type: "server_vad" };
const INSTR = process.env.INSTR_FIL ? readFileSync(process.env.INSTR_FIL, "utf8") : "Du er en vennlig norsk resepsjonist for Lia Frisør. Herreklipp koster 450 kr. Svar kort på norsk.";
const sov = (ms) => new Promise((r) => setTimeout(r, ms));

async function enRunde() {
  const m = {};
  let t = performance.now();
  const r = await fetch("https://api.x.ai/v1/realtime/client_secrets", { method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ expires_after: { seconds: 60 } }) });
  const tok = (await r.json()).value; m.token = performance.now() - t;
  t = performance.now();
  const ws = new WebSocket("wss://api.x.ai/v1/realtime?model=grok-voice-latest", [`xai-client-secret.${tok}`]);
  await new Promise((ok, feil) => { ws.onopen = ok; ws.onerror = feil; });
  m.koble = performance.now() - t;
  let venter = null; const hendelser = [];
  ws.onmessage = (e) => { const d = JSON.parse(e.data); hendelser.push([performance.now(), d.type]);
    if (d.type === "response.function_call_arguments.done") {
      ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: d.call_id, output: JSON.stringify({ ledige: ["09:00", "12:30", "16:00"] }) } }));
      ws.send(JSON.stringify({ type: "response.create" }));
    }
    if (venter && venter.test(d.type)) { const v = venter; venter = null; v.ok(performance.now()); } };
  const vent = (re, ms = 20000) => new Promise((ok) => { venter = { test: (x) => re.test(x), ok }; setTimeout(() => ok(NaN), ms); });
  ws.send(JSON.stringify({ type: "session.update", session: { voice: "ara", instructions: INSTR, turn_detection: VAD,
    tools: [{ type: "function", name: "finn_ledige_tider", description: "Finn ledige tider en dato", parameters: { type: "object", properties: { dato: { type: "string" } }, required: ["dato"] } }],
    audio: { input: { format: { type: "audio/pcm", rate: 24000 }, transcription: { language_hint: "no" } }, output: { format: { type: "audio/pcm", rate: 24000 } } } } }));
  t = performance.now();
  ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "force_message", role: "assistant", interruptible: true,
    content: [{ type: "output_text", text: "Hei, du har kommet til Lia Frisør! Hva kan jeg hjelpe deg med?" }] } }));
  m.hilsen = (await vent(/output_audio\.delta|audio\.delta/)) - t;
  await sov(4000); // la hilsenen bli ferdig
  const BIT = 4800; // 100 ms
  for (let i = 0; i < pcm.length; i += BIT) { ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm.subarray(i, i + BIT).toString("base64") })); await sov(100); }
  const slutt = performance.now();
  const stille = Buffer.alloc(BIT).toString("base64");
  const forsteLyd = vent(/output_audio\.delta|audio\.delta/);
  let ferdig = false; forsteLyd.then(() => (ferdig = true));
  (async () => { for (let i = 0; i < 150 && !ferdig; i++) { ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: stille })); await sov(100); } })();
  const lyd = await forsteLyd;
  m.svar = lyd - slutt;
  const stopp = hendelser.find(([tt, ty]) => tt > slutt - 2000 && ty === "input_audio_buffer.speech_stopped");
  m.vad = stopp ? stopp[0] - slutt : NaN;
  ws.close();
  return m;
}
const alle = [];
for (let i = 0; i < RUNDER; i++) { const m = await enRunde(); alle.push(m); console.log(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +(v / 1000).toFixed(2)]))); }
const med = (k) => { const s = alle.map((x) => x[k]).filter((x) => !isNaN(x)).sort((a, b) => a - b); return s.length ? +(s[Math.floor((s.length - 1) / 2)] / 1000).toFixed(2) : null; };
console.log("MEDIAN (s):", { token: med("token"), koble: med("koble"), hilsen: med("hilsen"), vad_oppdaget: med("vad"), forste_lyd_etter_kunden_sluttet: med("svar") });
