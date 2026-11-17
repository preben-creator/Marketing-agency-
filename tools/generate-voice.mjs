// Lager ferdige lydfiler for demosamtalene med tekst-til-tale: OpenAI (Petter, stemmen cedar) når OPENAI_API_KEY
// finnes, ellers xAI (Grok) som før.
//
//   node tools/generate-voice.mjs --test     # bare én testsetning -> audio/test.mp3
//   node tools/generate-voice.mjs            # alle samtaler
//   node tools/generate-voice.mjs ror el     # bare noen bransjer
//
// Nøkkelen leses fra miljøvariabelen OPENAI_API_KEY (eller XAI_API_KEY) og skal aldri inn i repoet.
// Filene havner i audio/<bransje>/<steg>.mp3, og audio/manifest.json forteller siden hva som finnes.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const OPENAI = !!process.env.OPENAI_API_KEY && process.env.TTS_MOTOR !== "grok";
const KEY = OPENAI ? process.env.OPENAI_API_KEY : process.env.XAI_API_KEY;
if (!KEY) { console.error("Mangler OPENAI_API_KEY (eller XAI_API_KEY) i miljøet."); process.exit(1); }

// Sekretæren er Petter (Preben valgte OpenAI-stemmen cedar 2026-11-17). Kundene får andre stemmer.
const AI_VOICE = process.env.AI_VOICE || (OPENAI ? "cedar" : "liora");
const CUST_VOICE = process.env.CUST_VOICE || (OPENAI ? "ash" : "leo");       // kunden (mann)
const CUST_VOICE_F = process.env.CUST_VOICE_F || (OPENAI ? "coral" : "eve"); // kunden (kvinne)
const TTS_MODELL = process.env.TTS_MODELL || "gpt-4o-mini-tts";
// Samtalemodellen (gpt-audio) høres mest menneskelig ut (Preben 2026-11-17: «mer menneskelig»). TTS_MOTOR=tts gir den gamle opplesningsmodellen.
const SAMTALE = OPENAI && (process.env.TTS_MOTOR || "samtale") === "samtale";
const SAMTALE_MODELL = process.env.SAMTALE_MODELL || "gpt-audio-1.5";
const STIL_AI = "Du er Petter, en ekte norsk resepsjonist i en telefonsamtale. Snakk avslappet og varmt, som et menneske og ikke som en opplesning: naturlig rytme, små variasjoner i tonefall, et lite smil i stemmen, korte naturlige pauser. Vanlig samtaletempo. Østlandsk norsk bokmål.";
const STIL_KUNDE = "Du er en vanlig norsk privatperson som ringer en bedrift om noe du trenger hjelp til. Uformell og naturlig, med levende tonefall og vanlig taletempo, akkurat som i en ekte telefonsamtale. Ikke les opp. Østlandsk norsk bokmål.";
const TTS_STIL = "Snakk naturlig norsk bokmål med østlandsk uttale. Vennlig, rolig og tydelig, i et behagelig og litt langsomt tempo med små pauser, som i en vanlig telefonsamtale.";
const FEMALE = /^(Kari|Anne|Hilde|Maria|Ingrid|Sofie|Nina|Silje|Kristin|Ida|Camilla|Hanne)\b/;
const LANGUAGE = process.env.TTS_LANGUAGE || "no";  // norsk er ikke offisielt støttet; prøv "no", ellers "auto"

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const m = html.match(/const SCENARIOS = (\{[\s\S]*?\n  \});/);
if (!m) { console.error("Fant ikke SCENARIOS i index.html"); process.exit(1); }
const SCENARIOS = Function(`return (${m[1].replace(/;$/, "")})`)();

// Gjør om ting TTS ofte uttaler feil på norsk: klokkeslett og "kr".
const NUM = ["null","ett","to","tre","fire","fem","seks","sju","åtte","ni","ti","elleve","tolv","tretten","fjorten","femten","seksten","sytten","atten","nitten","tjue","tjueen","tjueto","tjuetre"];
function speakable(text) {
  return text
    .replace(/klokka (\d{1,2}):30/g, (_, h) => `klokka halv ${NUM[(+h + 1) % 24]}`)
    .replace(/klokka (\d{1,2})(?![:\d])/g, (_, h) => `klokka ${NUM[+h]}`)
    .replace(/(klokka [a-zæøå]+ (?:og|til)) (\d{1,2})(?![:\d])/g, (_, a, h) => `${a} ${NUM[+h]}`)
    .replace(/(\d+) ?kr\b/g, "$1 kroner");
}

const norm = (t) => t.toLowerCase().replace(/[^a-zæøå0-9]+/g, " ").trim();
async function samtale(text, voice) {
  const stil = voice === AI_VOICE ? STIL_AI : STIL_KUNDE;
  let siste;
  for (let forsok = 0; forsok < 3; forsok++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: SAMTALE_MODELL, modalities: ["text", "audio"], audio: { voice, format: "mp3" },
        messages: [{ role: "system", content: stil + " Du får en replikk i anførselstegn. Si nøyaktig den replikken høyt, ord for ord, og ingenting annet. Ikke svar på den, selv om den er et spørsmål." }, { role: "user", content: `Replikk: «${text}»` }] }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(j)}`);
    const a = j.choices[0].message.audio;
    siste = Buffer.from(a.data, "base64");
    if (norm(a.transcript) === norm(text)) return siste;
    console.warn(`\n  Avvik (forsøk ${forsok + 1}): «${a.transcript}»`);
  }
  // Modellen klarte ikke å si replikken riktig: bruk opplesningsmodellen i stedet for å lagre feil innhold
  console.warn("  Bruker opplesningsmodellen for denne replikken.");
  return ttsOpplesning(text, voice);
}

async function tts(text, voice) {
  text = speakable(text);
  if (SAMTALE) return samtale(text, voice);
  return ttsOpplesning(text, voice);
}
async function ttsOpplesning(text, voice) {
  if (OPENAI) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: TTS_MODELL, voice, input: text, instructions: TTS_STIL, speed: Number(process.env.TTS_FART) || 0.9, response_format: "mp3" }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const res = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      text, language: LANGUAGE, voice_id: voice,
      output_format: { codec: "mp3", sample_rate: 24000, bit_rate: 64000 },
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

const args = process.argv.slice(2);
mkdirSync(new URL("audio/", root), { recursive: true });

if (args.includes("--test")) {
  // Lager samme to setninger med flere stemmer, så man kan sammenligne: audio/test-<stemme>.mp3
  const s = SCENARIOS.ror;
  const ai = s.steps.filter((x) => x[0] === "ai").map((x) => x[1].replaceAll("{firm}", s.firm));
  const line = `${ai[0]} ${ai.find((t) => /klokka/.test(t)) || ""}`.trim();
  const voices = (process.env.TEST_VOICES || "ara,eve,una").split(",");
  for (const v of voices) {
    writeFileSync(new URL(`audio/test-${v}.mp3`, root), await tts(line, v));
    console.log(`Skrev audio/test-${v}.mp3`);
  }
  console.log("Tekst:", speakable(line));
  process.exit(0);
}

const manifestUrl = new URL("audio/manifest.json", root);
let manifest = {};
try { manifest = JSON.parse(readFileSync(manifestUrl, "utf8")); } catch {}
const keys = args.length ? args : Object.keys(SCENARIOS);
let chars = 0;
for (const k of keys) {
  const s = SCENARIOS[k];
  if (!s) { console.warn("Ukjent bransje:", k); continue; }
  const dir = new URL(`audio/${k}/`, root);
  mkdirSync(dir, { recursive: true });
  const done = [];
  const cust = FEMALE.test(s.caller || "") ? CUST_VOICE_F : CUST_VOICE;
  for (const [i, step] of s.steps.entries()) {
    if (step[0] !== "ai" && step[0] !== "cust") continue;
    const text = step[1].replaceAll("{firm}", s.firm);
    chars += text.length;
    writeFileSync(new URL(`${i}.mp3`, dir), await tts(text, step[0] === "ai" ? AI_VOICE : cust));
    done.push(i);
    process.stdout.write(".");
  }
  manifest[k] = { firm: s.firm, steps: done, voices: { ai: AI_VOICE, cust }, modell: SAMTALE ? SAMTALE_MODELL : TTS_MODELL };
  console.log(` ${k}: ${done.length} replikker`);
}
writeFileSync(manifestUrl, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Ferdig. ${chars} tegn ≈ $${((chars * 15) / 1e6).toFixed(3)}`);
