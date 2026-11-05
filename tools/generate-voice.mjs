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

const AI_VOICE = process.env.AI_VOICE || "ara";     // sekretæren
const CUST_VOICE = process.env.CUST_VOICE || "leo"; // kunden
const LANGUAGE = process.env.TTS_LANGUAGE || "no";  // norsk er ikke offisielt støttet; prøv "no", ellers "auto"

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const m = html.match(/const SCENARIOS = (\{[\s\S]*?\n  \});/);
if (!m) { console.error("Fant ikke SCENARIOS i index.html"); process.exit(1); }
const SCENARIOS = Function(`return (${m[1].replace(/;$/, "")})`)();

async function tts(text, voice) {
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
  const s = SCENARIOS.ror;
  const line = s.steps.find((x) => x[0] === "ai")[1].replaceAll("{firm}", s.firm);
  writeFileSync(new URL("audio/test.mp3", root), await tts(line, AI_VOICE));
  console.log("Skrev audio/test.mp3:", line);
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
  for (const [i, step] of s.steps.entries()) {
    if (step[0] !== "ai" && step[0] !== "cust") continue;
    const text = step[1].replaceAll("{firm}", s.firm);
    chars += text.length;
    writeFileSync(new URL(`${i}.mp3`, dir), await tts(text, step[0] === "ai" ? AI_VOICE : CUST_VOICE));
    done.push(i);
    process.stdout.write(".");
  }
  manifest[k] = { firm: s.firm, steps: done, voices: { ai: AI_VOICE, cust: CUST_VOICE } };
  console.log(` ${k}: ${done.length} replikker`);
}
writeFileSync(manifestUrl, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Ferdig. ${chars} tegn ≈ $${((chars * 15) / 1e6).toFixed(3)}`);
