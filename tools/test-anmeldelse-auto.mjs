// Test av automatisk Google-oppsett for anmeldelser: bedriften finnes i Google ut fra profilen,
// lenken til SMS-en fylles inn, morgenrunden henter nye anmeldelser og lager svarutkast uten at noen trykker.
// Google (Places) og Grok er ETTERLIGNET, så ingen nøkler trengs.
//   node tools/test-anmeldelse-auto.mjs
import worker from "../worker/sekretar-worker.js";

const lager = new Map();
const KV = {
  get: async (k, t) => (lager.has(k) ? (t === "json" ? JSON.parse(lager.get(k).v) : lager.get(k).v) : null),
  put: async (k, v, o = {}) => { lager.set(k, { v: String(v), metadata: o.metadata }); },
  delete: async (k) => { lager.delete(k); },
  list: async ({ prefix = "" }) => ({ keys: [...lager.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: lager.get(name).metadata })), list_complete: true }),
};
const env = { XAI_API_KEY: "x", ADMIN_KODE: "admin", KUNDER: KV, GOOGLE_PLACES_KEY: "g", AGENT_MAKS_DAG: "50" };
const profil = (navn, adresse, omraade = "Bergen") => ({ navn, bransje: "frisør", type: "time", adresse, omraade, telefon: "55 00 00 00", tjenester: [] });
const kunder = {
  "ramsvik-paradis": profil("Ramsvik Frisør AS", "Olav Kyrres gate 33, 5015 Bergen"),
  "ramsvik-loddefjord": profil("Ramsvik", "Loddefjordveien 2, 5171 Loddefjord"),
  "ramsvik-uklar": profil("Ramsvik", "", "Bergen"),
  "klipp-komplett": profil("Klipp og Stil AS", "Torget 1, 5014 Bergen"),
  "uten-pakke": profil("Saks Kari", "Gate 2, 5089 Bergen"),
};
for (const [id, p] of Object.entries(kunder)) { await KV.put("kunde:" + id, JSON.stringify(p)); await KV.put("rediger:" + id, "kode-" + id); }
await KV.put("rapport:klipp-komplett", JSON.stringify({ pakke: "komplett" }));

const RAMSVIK = [
  ["ChIJparadis", "Ramsvik Frisør", "Olav Kyrres gate 33, 5015 Bergen"],
  ["ChIJramm", "Ramm av Ramsvik - Sentrum", "Vestre Torggaten 18, 5015 Bergen"],
  ["ChIJxhib", "Ramsvik Xhibition", "Småstrandgaten 3, 5014 Bergen"],
  ["ChIJvestk", "Ramsvik Vestkanten", "Loddefjordveien 2, 5171 Loddefjord"],
];
const dager = (n) => new Date(Date.now() - n * 864e5).toISOString();
const sok = [], eposter = [];
let grokKall = 0;
globalThis.fetch = async (u, o = {}) => {
  const url = String(u);
  if (url.includes("places:searchText")) {
    const q = JSON.parse(o.body).textQuery; sok.push(q);
    const liste = /ramsvik/i.test(q) ? RAMSVIK : /klipp og stil/i.test(q) ? [["ChIJklipp", "Klipp & Stil", "Torget 1, 5014 Bergen"], ["ChIJannen", "Stil Frisør", "Torget 9, 5014 Bergen"]] : [["ChIJx", "Noe Helt Annet", "Oslo"]];
    return Response.json({ places: liste.map(([id, navn, adresse]) => ({ id, displayName: { text: navn }, formattedAddress: adresse, rating: 4.5, userRatingCount: 30 })) });
  }
  if (url.includes("places.googleapis.com/v1/places/")) return Response.json({ displayName: { text: "Klipp & Stil" }, rating: 4.6, userRatingCount: 80, googleMapsUri: "https://maps.google.com/?cid=2", reviews: [
    { name: "r/ny", rating: 5, text: { text: "Veldig fornøyd med klippen!" }, authorAttribution: { displayName: "Ida Berg" }, publishTime: dager(2) },
    { name: "r/gammel", rating: 4, text: { text: "Bra, men litt dyrt." }, authorAttribution: { displayName: "Per" }, publishTime: dager(60) } ] });
  if (url.includes("api.x.ai")) { grokKall++; return Response.json({ choices: [{ message: { content: JSON.stringify({ forslag: [{ tone: "kort", svar: "Tusen takk, Ida!" }, { tone: "varm", svar: "Så hyggelig!" }, { tone: "grundig", svar: "Takk for at du tok deg tid." }], tips: "Ingen oppfølging trengs." }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }); }
  if (url.includes("formsubmit") || url.includes("resend")) { eposter.push(JSON.parse(o.body)); return new Response("{}", { status: 200 }); }
  throw new Error("uventet kall: " + url);
};

let feil = 0;
const sjekk = (ok, t) => { console.log((ok ? "OK   " : "FEIL ") + t); if (!ok) feil++; };
const kall = async (sti, body) => {
  const r = await worker.fetch(new Request("https://x.dev" + sti, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, { waitUntil: () => {} });
  return { status: r.status, d: await r.json() };
};
const tillegg = async (id) => KV.get("tillegg:" + id, "json");
const morgen = async () => {
  const vent = [];
  const t = new Date(); // kl. 07:05 norsk tid i dag
  const iDag = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(t);
  const ms = Date.parse(iDag + "T07:05:00+01:00");
  await worker.scheduled({ cron: "*/15 * * * *", scheduledTime: ms }, env, { waitUntil: (p) => vent.push(p) });
  await Promise.all(vent);
};

// 1. Siden åpnes første gang: bedriften finnes automatisk (navn + postnummer), og SMS-lenken fylles inn
let r = await kall("/agenter/data", { kunde: "ramsvik-paradis", r: "kode-ramsvik-paradis" });
sjekk(r.d.google.placeId === "ChIJparadis" && r.d.google.auto?.navn === "Ramsvik Frisør", "Ramsvik Frisør funnet automatisk: " + r.d.google.auto?.navn);
sjekk(sok[0].includes("Olav Kyrres gate 33"), "søket bruker navn og adresse fra profilen");
let t = await tillegg("ramsvik-paradis");
sjekk(t.anmeldelse.lenke === "https://search.google.com/local/writereview?placeid=ChIJparadis", "lenken til anmeldelse-SMS-en er fylt inn");

// 2. Kjede med flere salonger: postnummeret avgjør
r = await kall("/agenter/data", { kunde: "ramsvik-loddefjord", r: "kode-ramsvik-loddefjord" });
sjekk(r.d.google.placeId === "ChIJvestk", "salongen i 5171 valgt blant flere Ramsvik-treff");

// 3. Uklart treff: velger ingenting, viser søkefeltet ferdig utfylt, og søker ikke igjen hver gang
sok.length = 0;
r = await kall("/agenter/data", { kunde: "ramsvik-uklar", r: "kode-ramsvik-uklar" });
sjekk(!r.d.google.placeId && r.d.google.sok === "Ramsvik Bergen", "flere like treff uten postnummer: ingenting valgt, søket står klart");
r = await kall("/agenter/data", { kunde: "ramsvik-uklar", r: "kode-ramsvik-uklar" });
sjekk(sok.length === 1, "søker ikke på nytt før det har gått 7 dager");

// 4. Bytte for hånd fjerner «funnet automatisk», og lenken følger med
r = await kall("/agenter/anmeldelser/sted", { kunde: "ramsvik-paradis", r: "kode-ramsvik-paradis", placeId: "ChIJxhib" });
t = await tillegg("ramsvik-paradis");
sjekk(t.anmeldelse.placeId === "ChIJxhib" && !t.anmeldelse.auto && t.anmeldelse.lenke.endsWith("ChIJxhib"), "valgt for hånd: nytt sted og ny lenke");

// 5. Morgenrunden: Komplett-kunden får bedriften funnet og svarutkast til nye anmeldelser, uten å åpne siden
sok.length = 0; eposter.length = 0; grokKall = 0;
await morgen();
t = await tillegg("klipp-komplett");
sjekk(t?.anmeldelse.placeId === "ChIJklipp", "Komplett-kunde funnet automatisk i morgenrunden («Klipp & Stil» = «Klipp og Stil AS»)");
const logg = (await KV.get("agentlogg:klipp-komplett:anmeldelse", "json")) || [];
sjekk(logg.length === 1 && logg[0].navn === "Ida", "første gang: bare anmeldelsen fra de siste 14 dagene fikk svarutkast");
sjekk(eposter.some((e) => /Google-anmeldelse til Klipp og Stil/.test(JSON.stringify(e))), "e-post om svarforslagene sendt");
sjekk(!sok.some((q) => /Saks Kari/.test(q)), "kunde uten anmeldelse-tillegg eller Komplett: ikke søkt");

// 6. Neste morgen: ingenting nytt, ingen nye utkast
grokKall = 0; eposter.length = 0;
await morgen();
sjekk(grokKall === 0 && !eposter.some((e) => /Klipp og Stil/.test(JSON.stringify(e))), "neste morgen: ingen nye utkast og ingen e-post");

// 7. Lagring av tilleggene på /lag beholder «funnet automatisk», og slår man på anmeldelser finnes stedet med en gang
r = await kall("/tillegg/admin", { kode: "admin", id: "klipp-komplett", tillegg: { ...(await tillegg("klipp-komplett")), auto: undefined } });
sjekk((await tillegg("klipp-komplett")).anmeldelse.auto?.navn === "Klipp & Stil", "lagring på /lag beholder det automatiske valget");
await KV.put("kunde:ramsvik-ny", JSON.stringify(profil("Ramsvik Frisør", "Olav Kyrres gate 33, 5015 Bergen")));
r = await kall("/tillegg/admin", { kode: "admin", id: "ramsvik-ny", tillegg: { anmeldelse: { pa: true, lenke: "", timerEtter: 3 } } });
t = await tillegg("ramsvik-ny");
sjekk(t.anmeldelse.placeId === "ChIJparadis" && t.anmeldelse.lenke.endsWith("ChIJparadis"), "anmeldelse-SMS slått på i /lag: sted og lenke fylles inn med en gang");

console.log(feil ? `\n${feil} feil` : "\nAlt OK");
process.exit(feil ? 1 : 0);
