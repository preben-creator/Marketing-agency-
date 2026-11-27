// Test av stemmene Petter (cedar) og Eva (marin) med ekte OpenAI Realtime: holder de seg til norsk?
// Hver stemme får de samme instruksjonene som på telefonen (demonummeret og en kundes egen linje), og en
// innringer som skriver replikker med engelske ord i. Lyden fra hvert svar skrives om til tekst igjen med
// whisper-1, som også sier hvilket språk det hørtes ut som. Testen feiler hvis et svar ikke høres norsk ut
// eller inneholder engelske ord.
//
//   npm i --no-save ws        (én gang)
//   OPENAI_API_KEY=... node tools/test-stemmer.mjs [utmappe]
// Skriver én WAV-fil per stemme og scenario til utmappen (standard: stemmetest/), så du kan høre på dem.
// Koster rundt 1–2 kroner per kjøring.
import WebSocket from "ws";
import fs from "node:fs";
import { openaiSesjon, rolleInstruks, SPRAK_REGEL } from "../worker/ringeagent-worker.js";
import { telefonInstruksjoner, normaliser } from "../worker/sekretar-worker.js";

const NOKKEL = process.env.OPENAI_API_KEY;
if (!NOKKEL) { console.log("Hopper over: OPENAI_API_KEY mangler."); process.exit(0); }
const UT = process.argv[2] || "stemmetest";
fs.mkdirSync(UT, { recursive: true });
const MODELL = process.env.OPENAI_MODELL || "gpt-realtime-2.1";
const agent = process.env.HTTPS_PROXY ? new (await import("https-proxy-agent")).HttpsProxyAgent(process.env.HTTPS_PROXY) : undefined;
const profiler = JSON.parse(fs.readFileSync(new URL("./demo-profiler.json", import.meta.url)));

// Engelske ord vi ikke vil høre (hele ord, uansett store/små bokstaver).
const ENGELSK = /\b(okay|ok|sure|great|perfect|sorry|appointment|anyway|thanks|thank you|yes|yeah|hello|hi there|of course|absolutely|awesome|nice|cool|well|so,)\b/i;
const REPLIKKER = {
  demo: [
    "Hei, jeg lurer på hva en herreklipp koster?",
    "Okay, perfect. Kan jeg booke en appointment på fredag?",
    "Great. Har dere parkering der?",
    "Hva er adressen deres, og når åpner dere på lørdag?",
    "Thanks, det var alt. Ha det!",
  ],
  linje: [
    "Hei, det lekker under vasken på kjøkkenet. Kan dere komme?",
    "Okay, sure. Hva koster det cirka?",
    "Perfect, jeg heter Kari Nilsen og bor i Fjellveien 12.",
    "Thanks! Ha det bra.",
  ],
};
const SCENARIER = [];
// PROV_STEMME=ash prøver en annen OpenAI-stemme i stedet for cedar (Petter), for å sammenligne.
for (const agentNavn of ["Petter", "Eva"]) {
  const stemme = agentNavn === "Eva" ? "marin" : process.env.PROV_STEMME || "cedar";
  SCENARIER.push({ navn: `${agentNavn}-demo`, stemme, replikker: REPLIKKER.demo, start: "Si nøyaktig dette, og ikke noe mer: «Lia Frisør, hei! Hva kan jeg hjelpe deg med?»",
    kunde: { inn: true, velgStemme: true, agent: agentNavn, rolle: rolleInstruks(profiler["demo-frisor"]) } });
  const p = normaliser(profiler["demo-rorlegger"]);
  SCENARIER.push({ navn: `${agentNavn}-kundelinje`, stemme, replikker: REPLIKKER.linje,
    start: `Start samtalen med å si nøyaktig dette, og ikke noe mer: «${p.kortnavn || p.navn}, hei! Du snakker med den digitale assistenten. Hva kan jeg hjelpe deg med?»`,
    kunde: { oppsett: { instruksjoner: telefonInstruksjoner(p, true, false, "+4741234567"), verktoy: [], keyterms: [], stemme } } });
}

const ULAW = new Int16Array(256);
for (let i = 0; i < 256; i++) { const u = ~i & 0xff, e = (u >> 4) & 7, m = u & 15, v = (((m << 3) + 0x84) << e) - 0x84; ULAW[i] = u & 0x80 ? -v : v; }
function wav(ulaw) {
  const pcm = Buffer.alloc(ulaw.length * 2);
  for (let i = 0; i < ulaw.length; i++) pcm.writeInt16LE(ULAW[ulaw[i]], i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24); h.writeUInt32LE(16000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
async function whisper(lyd) {
  const fd = new FormData();
  fd.append("file", new Blob([wav(lyd)], { type: "audio/wav" }), "svar.wav");
  fd.append("model", "whisper-1");
  fd.append("response_format", "verbose_json");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${NOKKEL}` }, body: fd });
  if (!r.ok) throw new Error("whisper " + r.status + " " + (await r.text()).slice(0, 200));
  return r.json();
}

async function kjor(sc) {
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODELL)}`, { headers: { Authorization: `Bearer ${NOKKEL}` }, agent });
  await new Promise((ok, feil) => { ws.once("open", ok); ws.once("error", feil); });
  const okt = openaiSesjon({}, sc.kunde);
  okt.audio.input.turn_detection = null; // innringeren skriver i testen
  okt.tool_choice = "none";
  okt.tools = [];
  if (!okt.instructions.includes(SPRAK_REGEL)) throw new Error("Språkregelen mangler i instruksjonene");
  if (!process.env.PROV_STEMME && okt.audio.output.voice !== sc.stemme) throw new Error(`Feil stemme: ${okt.audio.output.voice}`);
  okt.audio.output.voice = sc.stemme;
  ws.send(JSON.stringify({ type: "session.update", session: okt }));
  const svar = async (instruks) => new Promise((ok, feil) => {
    const lyd = []; let tekst = "";
    const h = (m) => {
      const e = JSON.parse(m);
      if (e.type === "response.output_audio.delta") lyd.push(Buffer.from(e.delta, "base64"));
      else if (e.type === "response.output_audio_transcript.done") tekst = e.transcript || "";
      else if (e.type === "error") { ws.off("message", h); feil(new Error(JSON.stringify(e.error))); }
      else if (e.type === "response.done") { ws.off("message", h); ok({ lyd: Buffer.concat(lyd), tekst }); }
    };
    ws.on("message", h);
    ws.send(JSON.stringify({ type: "response.create", ...(instruks ? { response: { instructions: instruks } } : {}) }));
  });
  const runder = [{ kunde: "(starter)", ...(await svar(sc.start)) }];
  for (const r of sc.replikker) {
    ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: r }] } }));
    runder.push({ kunde: r, ...(await svar()) });
  }
  ws.close();
  const stille = Buffer.alloc(4000, 0xff); // et halvt sekund stillhet mellom svarene
  fs.writeFileSync(`${UT}/${sc.navn}.wav`, wav(Buffer.concat(runder.flatMap((r) => [r.lyd, stille]))));
  return runder;
}

let feil = 0, antall = 0;
const bare = process.env.SCENARIO; // f.eks. SCENARIO=Petter-kundelinje
for (const sc of SCENARIER.filter((x) => !bare || x.navn === bare)) {
  console.log(`\n=== ${sc.navn} (${sc.stemme}) ===`);
  let runder;
  try { runder = await kjor(sc); } catch (e) { feil++; console.log("FEIL kunne ikke kjøre: " + e.message); continue; }
  for (const r of runder) {
    antall++;
    if (!r.lyd.length) { feil++; console.log(`FEIL ingen lyd etter «${r.kunde}»`); continue; }
    const w = await whisper(r.lyd);
    const sprak = String(w.language || "").toLowerCase();
    const problem = [];
    if (!/^(norwegian|nynorsk|no|nn|nb)$/.test(sprak)) problem.push(`hørtes ut som ${sprak || "ukjent språk"}`);
    const eng = (r.tekst.match(ENGELSK) || w.text.match(ENGELSK) || [])[0];
    if (eng) problem.push(`engelsk ord «${eng}»`);
    if (problem.length) feil++;
    console.log(`${problem.length ? "FEIL" : "OK  "} Kunde: ${r.kunde}`);
    console.log(`     Svar: ${r.tekst.trim()}`);
    console.log(`     Hørt (${sprak}): ${String(w.text).trim()}${problem.length ? "\n     -> " + problem.join(", ") : ""}`);
  }
}
console.log(`\n${antall - feil} av ${antall} svar holdt seg til norsk. Lydfilene ligger i ${UT}/.`);
console.log(feil ? `${feil} feil` : "Alt OK");
process.exit(feil ? 1 : 0);
