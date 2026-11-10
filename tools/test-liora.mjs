// Testsamtaler med Liora (ekte Grok-stemme, samme oppsett som telefonen bruker), men med tekst inn i stedet for lyd.
// Måler hvor fort hun begynner å snakke, og en annen Grok-modell vurderer svarene.
// Ringer ingen og sender ingenting.
//
//   XAI_API_KEY=... node tools/test-liora.mjs           alle testene
//   XAI_API_KEY=... node tools/test-liora.mjs akutt     bare tester med «akutt» i navnet
//   RUNDER=3 ...                                         kjør hver test flere ganger
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sesjon, rolleInstruks, innringInstruks, forsteReplikk } from "../worker/ringeagent-worker.js";

const her = dirname(fileURLToPath(import.meta.url));
const KEY = process.env.XAI_API_KEY;
if (!KEY) { console.error("Mangler XAI_API_KEY"); process.exit(1); }
const PROFILER = JSON.parse(readFileSync(join(her, "demo-profiler.json"), "utf8"));
const UT = { navn: "Kari", firma: "Kari Rør AS", til: "+4791234567" };

const TESTER = [
  { navn: "ut-hva-er-dette", kunde: UT, sier: ["Ja, det passer. Hva er dette egentlig?"],
    krav: "Liora forklarer kort (høyst tre setninger) hva en KI-sekretær fra Orvelo gjør for en bedrift, og avslutter med ett spørsmål. Ingen lange lister." },
  { navn: "ut-pris", kunde: UT, sier: ["Ja. Hva koster det?"],
    krav: "Liora sier at det starter på 790 kroner i måneden, pluss moms (eks. mva.), uten oppstartskostnad. Hun leser ikke opp en lang liste og finner ikke på andre priser." },
  { navn: "ut-eget-nummer", kunde: UT, sier: ["Ja. Kan den svare på telefonnummeret mitt når jeg står i en jobb?"],
    krav: "Liora er ærlig om at svar på bedriftens eget telefonnummer ikke er klart ennå (under utvikling), og forklarer at kundene i dag når sekretæren via lenke eller knapp på nettsiden. Hun lover ikke at den svarer på nummeret i dag." },
  { navn: "ut-ikke-interessert", kunde: UT, sier: ["Nei takk, jeg er ikke interessert."], verktoy: ["noter_for_preben", "legg_paa"],
    krav: "Liora takker høflig uten å mase eller prøve å overtale, sier ha det og avslutter samtalen." },
  { navn: "ut-darlig-tid", kunde: UT, sier: ["Jeg har egentlig ikke tid nå, jeg står midt i en jobb."], verktoy: ["send_bookinglenke"],
    krav: "Liora respekterer at kunden har dårlig tid, tilbyr eller sender en SMS med bookinglenke, og holder det svært kort." },
  { navn: "ut-mote", kunde: UT, sier: ["Ja, det høres interessant ut. Jeg vil gjerne snakke med Preben."], verktoy: ["send_bookinglenke"],
    krav: "Liora sender bookinglenken på SMS og sier at kunden kan velge en tid som passer." },
  { navn: "ut-robot", kunde: UT, sier: ["Vent, er du en robot?"],
    krav: "Liora sier ærlig at hun er en KI-assistent, og fortsetter vennlig." },
  { navn: "inn-ror-akutt", kunde: { inn: true, til: "+4791234567" }, rolle: "demo-rorlegger",
    sier: ["Hei, det lekker vann under kjøkkenvasken og det renner ut på gulvet, kan noen komme i kveld?"],
    krav: "Sekretæren ber kunden stenge hovedkranen, sier IKKE at det er umulig å få hjelp i kveld (firmaet har døgnvakt og ringer tilbake), og spør om navn, nummer eller adresse. Den foreslår ikke befaring en annen dag i stedet." },
  { navn: "inn-ror-akutt-beskjed", kunde: { inn: true, til: "+4791234567" }, rolle: "demo-rorlegger",
    sier: ["Vannet spruter fra et rør i kjelleren!", "Ola Hansen, ni en to tre fire fem seks sju, Landåsveien tolv."], verktoy: ["legg_igjen_beskjed"],
    krav: "Sekretæren gir sikkerhetsrådet, tar imot navn, nummer og adresse, og sender en hastebeskjed. Den lover ikke et klokkeslett for oppmøte." },
  { navn: "inn-frisor-pris", kunde: { inn: true, til: "+4791234567" }, rolle: "demo-frisor",
    sier: ["Hei, hva koster balayage hos dere?"],
    krav: "Sekretæren sier at balayage koster fra 2 190 kroner og tilbyr å finne en time." },
];

async function hemmelighet() {
  const r = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expires_after: { seconds: 120 } }),
  });
  return (await r.json()).value;
}

async function kjor(t) {
  const okt = sesjon({}, t.kunde);
  if (t.rolle) okt.instructions = innringInstruks() + "\n\n" + rolleInstruks(PROFILER[t.rolle]);
  const t0 = Date.now();
  const ws = new WebSocket("wss://api.x.ai/v1/realtime?model=grok-voice-latest", [`xai-client-secret.${await hemmelighet()}`]);
  await new Promise((ok, feil) => { ws.onopen = ok; ws.onerror = () => feil(new Error("fikk ikke koblet til")); });
  const tilkobling = Date.now() - t0;
  const send = (o) => ws.send(JSON.stringify(o));
  const linjer = [], brukt = [], forsinkelser = [];
  let ventPaa = null, foersteLyd = 0, startSvar = 0, kall = [], tekst = "";
  ws.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if ((e.type === "response.output_audio.delta" || e.type === "response.audio.delta") && !foersteLyd) foersteLyd = Date.now();
    if (e.type === "response.output_audio_transcript.done" || e.type === "response.audio_transcript.done") tekst += (tekst ? " " : "") + (e.transcript || "").trim();
    if (e.type === "response.function_call_arguments.done") kall.push(e);
    if (e.type === "error") linjer.push("  [feil " + JSON.stringify(e.error || e).slice(0, 200) + "]");
    if (e.type === "response.done" && ventPaa) ventPaa();
  };
  const svar = async () => {
    startSvar = Date.now(); foersteLyd = 0; kall = []; tekst = "";
    send({ type: "response.create" });
    await new Promise((ok) => { ventPaa = ok; setTimeout(ok, 30000); });
    if (foersteLyd) forsinkelser.push(foersteLyd - startSvar);
    if (tekst) linjer.push("Liora: " + tekst);
    const mer = [];
    for (const k of kall) {
      let a = {}; try { a = JSON.parse(k.arguments || "{}"); } catch {}
      let res = { ok: true };
      if (k.name === "legg_igjen_beskjed" && !/\d{8,}/.test(String(a.mobil || "").replace(/\D/g, "")))
        res = { ok: false, feil: "Beskjeden er IKKE sendt ennå. Haster det, si først det trygge rådet og hva som skjer videre. Spør så om navn og mobilnummer, gjenta nummeret, og send beskjeden når du har det." };
      brukt.push({ navn: k.name, a, res });
      linjer.push(`  [verktøy ${k.name} ${JSON.stringify(a).slice(0, 160)}${res.feil ? " -> avvist" : ""}]`);
      send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: k.call_id, output: JSON.stringify(res) } });
      if (k.name !== "legg_paa") mer.push(k);
    }
    if (mer.length) await svar();
  };

  send({ type: "session.update", session: okt });
  // Samme åpning som telefonen: Liora har sagt første replikk (og for innringing: funnet firmaet).
  send({ type: "conversation.item.create", item: { type: "message", role: "assistant", content: [{ type: "output_text", text: forsteReplikk(t.kunde) }] } });
  linjer.push("Liora: " + forsteReplikk(t.kunde));
  if (t.rolle) {
    const navn = PROFILER[t.rolle].navn;
    send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: navn }] } });
    send({ type: "conversation.item.create", item: { type: "message", role: "assistant", content: [{ type: "output_text", text: `Da hører du nå hvordan jeg ville svart for ${PROFILER[t.rolle].kortnavn}. Lat som du er en kunde som ringer. ${PROFILER[t.rolle].kortnavn}, hei! Hva kan jeg hjelpe deg med?` }] } });
  }
  for (const s of t.sier) {
    linjer.push("Kunde: " + s);
    send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: s }] } });
    await svar();
  }
  ws.close();

  const feil = [];
  for (const v of t.verktoy || []) if (!brukt.some((b) => b.navn === v && !b.res.feil)) feil.push(`brukte ikke ${v}`);
  const dom = await domm(t, linjer.join("\n"));
  if (!dom.bestatt) feil.push("vurdering: " + dom.grunn);
  return { feil, samtale: linjer.join("\n"), tilkobling, forsinkelser };
}

async function domm(t, samtale) {
  const r = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.DOMMER_MODELL || "grok-4-fast-reasoning", temperature: 0, response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Du vurderer en norsk KI-telefonassistent. Teksten er transkribert tale, så se bort fra tegnsetting og små språkfeil. Avgjør om svarene oppfyller kravet. Vær streng på kravet, ikke på formuleringer. Svar som JSON: {\"bestatt\": true/false, \"grunn\": \"én kort setning på norsk\"}." },
        { role: "user", content: `Krav: ${t.krav}\n\nSamtale:\n${samtale}` },
      ],
    }),
  });
  if (!r.ok) return { bestatt: false, grunn: "dommeren svarte " + r.status };
  try { return JSON.parse((await r.json()).choices[0].message.content); } catch { return { bestatt: false, grunn: "kunne ikke lese vurderingen" }; }
}

const filter = process.argv[2];
const runder = Number(process.env.RUNDER) || 1;
let ok = 0, totalt = 0;
const alleForsinkelser = [], tilkoblinger = [];
for (const t of TESTER.filter((x) => !filter || x.navn.includes(filter))) {
  for (let i = 0; i < runder; i++) {
    totalt++;
    let r;
    try { r = await kjor(t); } catch (e) { r = { feil: ["krasj: " + e.message], samtale: "", forsinkelser: [] }; }
    alleForsinkelser.push(...r.forsinkelser); if (r.tilkobling) tilkoblinger.push(r.tilkobling);
    const ms = r.forsinkelser.length ? ` (${r.forsinkelser.map((x) => (x / 1000).toFixed(1)).join(" / ")} s)` : "";
    if (!r.feil.length) { ok++; console.log(`✓ ${t.navn}${ms}`); if (process.env.VIS) console.log(r.samtale.replace(/^/gm, "    ")); }
    else console.log(`✗ ${t.navn}${ms}: ${r.feil.join("; ")}\n${r.samtale.replace(/^/gm, "    ")}`);
  }
}
const median = (l) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
console.log(`\n${ok} av ${totalt} bestått`);
console.log(`Tid før Liora begynner å snakke (etter at kunden er ferdig): median ${(median(alleForsinkelser) / 1000).toFixed(2)} s, verst ${(Math.max(0, ...alleForsinkelser) / 1000).toFixed(2)} s`);
console.log(`Tilkobling til Grok: median ${median(tilkoblinger)} ms`);
process.exit(ok === totalt ? 0 : 1);
