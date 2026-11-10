// Test av drift-delen i orvelo-sekretar: sporbar logg, automatiske flagg, ukens utvalg, vurdering,
// kostnad per kunde, sletting etter oppbevaringstiden og sletting av en kunde.
// Bruker en ETTERLIGNET Grok (ingen nøkkel trengs), fordi det er lagringen som testes her.
// Selve svarene til modellen testes mot ekte Grok i tools/test-sekretar.mjs.
//
//   node tools/test-drift.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../worker/sekretar-worker.js";

const her = dirname(fileURLToPath(import.meta.url));
const lager = new Map(); // key -> { v, metadata }
const KV = {
  get: async (k, t) => (lager.has(k) ? (t === "json" ? JSON.parse(lager.get(k).v) : lager.get(k).v) : null),
  put: async (k, v, o = {}) => { lager.set(k, { v: String(v), metadata: o.metadata }); },
  delete: async (k) => { lager.delete(k); },
  list: async ({ prefix = "" }) => ({ keys: [...lager.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: lager.get(name).metadata })), list_complete: true }),
};
const env = { XAI_API_KEY: "test", ADMIN_KODE: "admin", DEMO_KODE: "demo", KUNDER: KV, VARSEL_EPOST: "" };
const profiler = JSON.parse(readFileSync(join(her, "demo-profiler.json"), "utf8"));
await KV.put("kunde:demo-frisor", JSON.stringify(profiler["demo-frisor"]));
await KV.put("kunde:demo-rorlegger", JSON.stringify(profiler["demo-rorlegger"]));
await KV.put("rediger:demo-rorlegger", "rkode12345");
await KV.put("rapport:demo-frisor", JSON.stringify({ pakke: "pro", aktiv: false }));

// Etterlignet Grok: chatten får et svar med en pris og et nummer som ikke står i profilen
const ekteFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  if (String(u).includes("api.x.ai/v1/chat/completions")) {
    const b = JSON.parse(o.body);
    const innhold = b.response_format
      ? JSON.stringify({ forslag: [{ tone: "kort", svar: "Takk for fine ord!" }], tips: "Ingen oppfølging trengs." })
      : "Dameklipp koster 999 kr hos oss. Ring 12 34 56 78 for time.";
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: innhold } }],
      usage: { prompt_tokens: 2000, completion_tokens: 150, prompt_tokens_details: { cached_tokens: 500 } } }), { status: 200 });
  }
  if (String(u).includes("formsubmit") || String(u).includes("resend")) return new Response("{}", { status: 200 });
  return ekteFetch(u, o);
};

let feil = 0;
const sjekk = (ok, t) => { console.log((ok ? "OK   " : "FEIL ") + t); if (!ok) feil++; };
async function kall(sti, body) {
  const vent = [];
  const r = await worker.fetch(new Request("https://x.dev" + sti, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, { waitUntil: (p) => vent.push(p) });
  const d = r.headers.get("Content-Type")?.includes("json") ? await r.json() : null;
  await Promise.all(vent);
  return { status: r.status, d };
}
const mnd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);

// 1. Chatmelding -> spor + kostnad
let r = await kall("/chat/melding", { kunde: "demo-frisor", k: "demo", okt: "okt123abc", meldinger: [{ role: "user", content: "hva koster dameklipp?" }] });
sjekk(r.status === 200 && r.d.svar.includes("999"), "chatten svarte (etterlignet Grok)");
const sporNokler = [...lager.keys()].filter((k) => k.startsWith("spor:"));
sjekk(sporNokler.length === 1 && sporNokler[0].includes(":demo-frisor:okt123abc"), "én spor-rad for samtalen: " + sporNokler[0]);
const spor = JSON.parse(lager.get(sporNokler[0]).v);
sjekk(spor.meldinger.length === 2 && spor.prov === true, "sporet har kundens melding og svaret, merket som demo");
sjekk(spor.flagg.some((f) => f.includes("999")), "flagg: pris 999 kr står ikke i profilen");
sjekk(spor.flagg.some((f) => f.includes("12 34 56 78")), "flagg: nummeret står ikke i profilen");
sjekk(lager.get(sporNokler[0]).metadata.f >= 2, "antall flagg ligger i metadata (til utvalget)");
// Samme samtale, ny melding -> samme rad oppdateres
await kall("/chat/melding", { kunde: "demo-frisor", k: "demo", okt: "okt123abc", meldinger: [{ role: "user", content: "hva koster dameklipp?" }, { role: "assistant", content: "x" }, { role: "user", content: "takk" }] });
sjekk([...lager.keys()].filter((k) => k.startsWith("spor:")).length === 1, "andre melding i samme samtale lager ikke ny rad");
const kost = await KV.get(`kost:demo-frisor:${mnd}`, "json");
sjekk(kost && kost.kall === 2 && kost.inn === 4000 && kost.ut === 300 && kost.bufret === 1000, "kostnad: 2 kall, 4000 inn, 300 ut, 1000 bufret");

// 2. Stemme (/token teller økter, /logg teller minutter og lager spor)
r = await kall("/logg", { kunde: "demo-frisor", k: "demo", kanal: "tale", sek: 125, start: new Date().toISOString(), utskrift: [["kunde", "når åpner dere?"], ["ai", "Vi åpner kl. 09.00."]] });
sjekk(r.status === 204, "/logg tok imot taleutskrift");
sjekk((await KV.get(`kost:demo-frisor:${mnd}`, "json")).talesek === 125, "taleminutter telt (125 sek)");
sjekk([...lager.keys()].filter((k) => k.startsWith("spor:")).length === 2, "talesamtalen fikk sitt eget spor");

// 3. Agent -> spor med kanal agent-anmeldelse + kostnad
r = await kall("/agenter/kjor", { kunde: "demo-rorlegger", r: "rkode12345", oppgave: "anmeldelse", tekst: "Kjempefornøyd med jobben!", stjerner: 5 });
sjekk(r.status === 200, "agenten svarte");
const agentSpor = [...lager.keys()].filter((k) => k.startsWith("spor:") && k.includes(":demo-rorlegger:"));
sjekk(agentSpor.length === 1 && JSON.parse(lager.get(agentSpor[0]).v).kanal === "agent-anmeldelse", "agentkallet ble et spor (agent-anmeldelse)");
sjekk((await KV.get(`kost:demo-rorlegger:${mnd}`, "json"))?.kall === 1, "agentkallet ble telt på rørleggeren");

// 4. Ukens utvalg og vurdering
r = await kall("/drift/api", { kode: "feil", handling: "utvalg" });
sjekk(r.status === 401, "feil admin-kode gir 401");
r = await kall("/drift/api", { kode: "admin", handling: "utvalg", uke: 0 });
sjekk(r.status === 200 && r.d.totalt === 3 && r.d.utvalg.length === 3 && r.d.flagget >= 1, `utvalg: ${r.d.totalt} lagret, ${r.d.flagget} flagget, ${r.d.utvalg.length} i utvalget`);
const forste = r.d.utvalg.find((x) => x.kanal === "chat");
r = await kall("/drift/api", { kode: "admin", handling: "vurder", uke: r.d.uke, key: forste.key, dom: "feil", feiltype: "Fant på noe", notat: "Fant på pris", kanal: "chat" });
sjekk(r.status === 200, "vurdering lagret");
r = await kall("/drift/api", { kode: "admin", handling: "utvalg", uke: 0 });
sjekk(r.d.utvalg.find((x) => x.key === forste.key).vurdering?.d === "feil", "vurderingen vises i utvalget");
r = await kall("/drift/api", { kode: "admin", handling: "oversikt" });
sjekk(r.d.uker.length === 1 && r.d.uker[0].feil === 1 && r.d.uker[0].feilrate === 100, "oversikt: feilrate 100 % for uka");

// 5. Kostnad mot pris
r = await kall("/drift/api", { kode: "admin", handling: "kost", mnd });
const fr = r.d.rader.find((x) => x.id === "demo-frisor");
sjekk(fr && fr.pakke === "Pro" && fr.inntekt === 1490 && fr.kost > 0 && fr.margin > 1400, `frisør: kost ${fr?.kost} kr, inntekt ${fr?.inntekt} kr, margin ${fr?.margin} kr`);
const ror = r.d.rader.find((x) => x.id === "demo-rorlegger");
sjekk(ror && ror.pakke === "" && ror.margin === null, "rørlegger uten pakke: bare kostnad");

// 6. Sletting etter oppbevaringstiden
const gammel = new Date(Date.now() - 120 * 86400000).toISOString(), ny = new Date().toISOString();
await KV.put("chatinnboks:demo-frisor", JSON.stringify([{ type: "beskjed", tid: gammel, navn: "Gammel" }, { type: "beskjed", tid: ny, navn: "Ny" }]));
await KV.put("leads:demo-frisor", JSON.stringify([{ id: "l1", opprettet: gammel, sistKontakt: "" }, { id: "l2", opprettet: gammel, sistKontakt: ny }]));
await KV.put("timer:demo-frisor", JSON.stringify([{ id: "t1", s: Date.now() - 100 * 86400000 }, { id: "t2", s: Date.now() + 86400000 }]));
await KV.put("agentanalyse:demo-frisor", JSON.stringify({ tid: gammel, leads: [] }));
r = await kall("/drift/api", { kode: "admin", handling: "rydd" });
sjekk(r.d.fjernet === 4, `rydd fjernet ${r.d.fjernet} (forventet 4)`);
sjekk((await KV.get("chatinnboks:demo-frisor", "json")).map((x) => x.navn).join() === "Ny", "gammel beskjed slettet, ny beholdt");
sjekk((await KV.get("leads:demo-frisor", "json")).map((x) => x.id).join() === "l2", "lead med nylig kontakt beholdt");
sjekk((await KV.get("timer:demo-frisor", "json")).map((x) => x.id).join() === "t2", "time for 100 dager siden slettet");

// 7. Slett kunde (tørrkjøring, så ekte)
r = await kall("/drift/api", { kode: "admin", handling: "slett-kunde", kunde: "demo-frisor" });
sjekk(r.d.antall > 3 && !r.d.slettet && lager.has("kunde:demo-frisor"), `tørrkjøring fant ${r.d.antall} nøkler og slettet ingenting`);
r = await kall("/drift/api", { kode: "admin", handling: "slett-kunde", kunde: "demo-frisor", ekte: true, bekreft: "feil" });
sjekk(lager.has("kunde:demo-frisor"), "uten riktig bekreftelse slettes ingenting");
r = await kall("/drift/api", { kode: "admin", handling: "slett-kunde", kunde: "demo-frisor", ekte: true, bekreft: "demo-frisor" });
sjekk(r.d.slettet && !lager.has("kunde:demo-frisor") && ![...lager.keys()].some((k) => k.startsWith("spor:") && k.includes(":demo-frisor:")), "kunden og sporene er slettet");
sjekk(lager.has(`kost:demo-frisor:${mnd}`) && lager.has("kunde:demo-rorlegger"), "kostnadstall og andre kunder er beholdt");

console.log(feil ? `\n${feil} feil` : "\nAlt OK");
process.exit(feil ? 1 : 0);
