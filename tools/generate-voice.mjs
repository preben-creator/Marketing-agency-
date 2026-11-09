// Lager ferdige lydfiler for demosamtalene med xAI (Grok) tekst-til-tale.
//
//   node tools/generate-voice.mjs --test     # bare én testsetning -> audio/test.mp3
//   node tools/generate-voice.mjs            # alle samtaler
//   node tools/generate-voice.mjs ror el     # bare noen bransjer
//
// Nøkkelen leses fra miljøvariabelen XAI_API_KEY og skal aldri inn i repoet.
// Filene havner i audio/<bransje>/<steg>.mp3, og audio/manifest.json forteller siden hva som finnes.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const KEY = process.env.XAI_API_KEY;
if (!KEY) { console.error("Mangler XAI_API_KEY i miljøet."); process.exit(1); }

const AI_VOICE = process.env.AI_VOICE || "liora";   // sekretæren (Preben valgte Liora 2026-11-09)
const CUST_VOICE = process.env.CUST_VOICE || "leo"; // kunden (mann)
const CUST_VOICE_F = process.env.CUST_VOICE_F || "eve"; // kunden (kvinne)
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

async function tts(text, voice) {
  text = speakable(text);
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
  manifest[k] = { firm: s.firm, steps: done, voices: { ai: AI_VOICE, cust } };
  console.log(` ${k}: ${done.length} replikker`);
}
writeFileSync(manifestUrl, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Ferdig. ${chars} tegn ≈ $${((chars * 15) / 1e6).toFixed(3)}`);
