// Måler hvor lang tid KI-sekretæren (chatten) bruker på å svare, med ekte Grok og ekte instruksjoner.
// Kjører samme løkke som /chat/melding i workeren (Grok -> verktøy -> Grok), i prøvemodus, og tar tiden på hvert kall.
//
//   XAI_API_KEY=... node tools/maal-svartid.mjs                       standardmodellen i workeren, 3 runder
//   STROM=1 ...                                                     strømmet svar: måler også når første tekst kommer
//   XAI_API_KEY=... MODELLER=grok-4-fast-non-reasoning,grok-4.20-0309-non-reasoning RUNDER=5 node tools/maal-svartid.mjs
//
// Skriver en tabell med median og verste tid per modell og scenario, i sekunder.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const her = dirname(fileURLToPath(import.meta.url));
if (!process.env.XAI_API_KEY) { console.error("Mangler XAI_API_KEY"); process.exit(1); }

const kilde = readFileSync(join(her, "../worker/sekretar-worker.js"), "utf8")
  + "\nexport { chatInstruksjoner, chatVerktoy, grokChat, grokChatStrom, normaliser, leggTilDager, osloNaa, ukedag, CHAT_STANDARD_MODELL };\n";
const tmp = join(mkdtempSync(join(tmpdir(), "sekr-")), "w.mjs");
writeFileSync(tmp, kilde);
const W = await import(tmp);

const PROFILER = JSON.parse(readFileSync(join(her, "demo-profiler.json"), "utf8"));
const RUNDER = Number(process.env.RUNDER) || 3;
const MODELLER = (process.env.MODELLER || W.CHAT_STANDARD_MODELL).split(",").map((s) => s.trim()).filter(Boolean);

function neste(dag) {
  const idag = W.osloNaa().iso;
  for (let i = 1; i < 8; i++) { const d = W.leggTilDager(idag, i); if (W.ukedag(d) === dag) return d; }
}
const dagNavn = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

const SCENARIER = [
  { navn: "pris (frisør)", kunde: "demo-frisor", sier: "hva koster herreklipp?" },
  { navn: "ledig tid (frisør)", kunde: "demo-frisor", sier: () => `har dere ledig time ${dagNavn(neste(5))}?` },
  { navn: "nye pasienter (tannlege)", kunde: "demo-tannlege", sier: "tar dere imot nye pasienter?" },
  { navn: "akutt lekkasje (rør)", kunde: "demo-rorlegger", sier: "det lekker vann under kjøkkenvasken, kan noen komme i kveld?" },
];

// Fanger tiden på hvert Grok-kall uten å endre workeren: vi pakker fetch inn.
const ekteFetch = globalThis.fetch;
let kallTider = [];
globalThis.fetch = async (u, o) => {
  const t0 = performance.now();
  const r = await ekteFetch(u, o);
  if (String(u).includes("/chat/completions")) {
    const d = String(o && o.body).includes('"stream":true') ? {} : await r.clone().json().catch(() => ({}));
    kallTider.push({ ms: performance.now() - t0, modell: d.model, inn: d.usage?.prompt_tokens, ut: d.usage?.completion_tokens,
      tenk: d.usage?.completion_tokens_details?.reasoning_tokens || 0, cache: d.usage?.prompt_tokens_details?.cached_tokens || 0 });
  }
  return r;
};

async function enRunde(sc, modell) {
  const env = { XAI_API_KEY: process.env.XAI_API_KEY, CHAT_MODELL: modell, KUNDER: { get: async () => null, put: async () => {} } };
  const profil = W.normaliser(PROFILER[sc.kunde]);
  const kx = { env, id: sc.kunde, profil, chat: {}, prov: true, ctx: null, url: null, varsler: [], handlinger: [], bookinger: [], beskjeder: [], innboks: [] };
  const meldinger = [{ role: "system", content: W.chatInstruksjoner(profil, true) }, { role: "user", content: typeof sc.sier === "function" ? sc.sier() : sc.sier }];
  kallTider = [];
  const t0 = performance.now();
  let svar = "", forste = null;
  for (let runde = 0; runde < 5; runde++) {
    const m = process.env.STROM ? await W.grokChatStrom(env, meldinger, () => { if (forste === null) forste = (performance.now() - t0) / 1000; })
      : await W.grokChat(env, meldinger);
    const kall = Array.isArray(m.tool_calls) ? m.tool_calls : [];
    if (!kall.length) { svar = String(m.content || ""); break; }
    meldinger.push({ role: "assistant", content: m.content || "", tool_calls: kall });
    for (const k of kall) {
      let a = {}; try { a = JSON.parse(k.function?.arguments || "{}"); } catch {}
      const res = await W.chatVerktoy(k.function?.name, a, kx);
      meldinger.push({ role: "tool", tool_call_id: k.id, content: JSON.stringify(res) });
    }
  }
  return { totalt: (performance.now() - t0) / 1000, forste: forste ?? (performance.now() - t0) / 1000, kall: kallTider.slice(), svar };
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
const s1 = (x) => x.toFixed(1).replace(".", ",");

const rader = [];
for (const modell of MODELLER) {
  for (const sc of SCENARIER) {
    const tider = [], forste = [], kall = [], tenk = [], inn = [];
    let faktisk = "", eks = "";
    for (let i = 0; i < RUNDER; i++) {
      try {
        const r = await enRunde(sc, modell);
        tider.push(r.totalt); forste.push(r.forste); kall.push(r.kall.length); faktisk = r.kall[0]?.modell || "";
        tenk.push(r.kall.reduce((s, k) => s + k.tenk, 0)); inn.push(r.kall[0]?.inn || 0);
        eks = r.svar.replace(/\s+/g, " ").slice(0, 110);
      } catch (e) { console.error(modell, sc.navn, e.message); }
    }
    if (!tider.length) continue;
    const rad = { modell, faktisk, scenario: sc.navn, forste: med(forste), median: med(tider), verst: Math.max(...tider), kall: med(kall), tenk: med(tenk), inn: med(inn), eks };
    rader.push(rad);
    console.log(`${modell.padEnd(30)} ${sc.navn.padEnd(26)} første tekst ${s1(rad.forste)} s  ferdig ${s1(rad.median)} s  verst ${s1(rad.verst)} s  Grok-kall ${rad.kall}  tenke-tokens ${rad.tenk}  prompt ${rad.inn}  (svarte med ${faktisk})`);
    console.log(`    «${eks}»`);
  }
}
writeFileSync(process.env.UT || join(tmpdir(), "svartid.json"), JSON.stringify(rader, null, 2));
