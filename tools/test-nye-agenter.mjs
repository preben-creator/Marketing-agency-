// Test av agentene fra Prebens liste (november 2026):
//   1. Påminnelse samme dag + venteliste som fyller hull når noen avbestiller (SMS via etterlignet Twilio)
//   2. Anmeldelser hentet fra Google (etterlignet Places API) med svarutkast
//   3. Fakturapurring i tre trinn (manuelle fakturaer + etterlignet Fiken)
//   4. Lead-finner (etterlignet Enhetsregisteret) med første melding
//   5. Agent-revisor som leser ukas samtaler og foreslår rettelser, og «bruk»-knappen
// Grok er EKTE når XAI_API_KEY finnes (sjekker innholdet i svarene), ellers hoppes KI-delene over.
//   XAI_API_KEY=... node tools/test-nye-agenter.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { tilleggRunde } from "../worker/sekretar-worker.js";

const her = dirname(fileURLToPath(import.meta.url));
const ki = !!process.env.XAI_API_KEY;
const lager = new Map();
const KV = {
  get: async (k, t) => (lager.has(k) ? (t === "json" ? JSON.parse(lager.get(k).v) : lager.get(k).v) : null),
  put: async (k, v, o = {}) => { lager.set(k, { v: String(v), metadata: o.metadata }); },
  delete: async (k) => { lager.delete(k); },
  list: async ({ prefix = "" }) => ({ keys: [...lager.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: lager.get(name).metadata })), list_complete: true }),
};
const env = { XAI_API_KEY: process.env.XAI_API_KEY || "x", ADMIN_KODE: "admin", KUNDER: KV, SMS_PA: "ja", SMS_TEST_NUMMER: "41232557",
  TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+15550000", GOOGLE_PLACES_KEY: "g", AGENT_MAKS_DAG: "50" };
const profiler = JSON.parse(readFileSync(join(her, "demo-profiler.json"), "utf8"));
await KV.put("kunde:demo-frisor", JSON.stringify(profiler["demo-frisor"]));
await KV.put("rediger:demo-frisor", "fkode12345");
await KV.put("kunde:demo-rorlegger", JSON.stringify(profiler["demo-rorlegger"]));
await KV.put("rediger:demo-rorlegger", "rkode12345");

const sms = [], eposter = [];
const ekteFetch = globalThis.fetch;
globalThis.fetch = async (u, o = {}) => {
  const url = String(u);
  if (url.includes("api.twilio.com")) { sms.push(Object.fromEntries(new URLSearchParams(o.body))); return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }); }
  if (url.includes("formsubmit") || url.includes("resend")) { eposter.push(JSON.parse(o.body)); return new Response("{}", { status: 200 }); }
  if (url.includes("places.googleapis.com/v1/places:searchText")) return Response.json({ places: [{ id: "ChIJtest", displayName: { text: "Frisør Demo" }, formattedAddress: "Bergen", rating: 4.3, userRatingCount: 41 }] });
  if (url.includes("places.googleapis.com/v1/places/")) return Response.json({ displayName: { text: "Frisør Demo" }, rating: 4.3, userRatingCount: 41, googleMapsUri: "https://maps.google.com/?cid=1", reviews: [
    { name: "places/ChIJtest/reviews/a1", rating: 5, text: { text: "Supert klipp, hyggelig frisør!" }, authorAttribution: { displayName: "Ida Berg" }, publishTime: "2026-11-09T10:00:00Z" },
    { name: "places/ChIJtest/reviews/a2", rating: 2, text: { text: "Måtte vente 25 minutter selv om jeg hadde time. Klippen ble ok." }, authorAttribution: { displayName: "Ola N" }, publishTime: "2026-11-08T10:00:00Z" } ] });
  if (url.includes("api.fiken.no/api/v2/companies/") ) return Response.json([{ invoiceNumber: 10042, issueDate: "2026-10-01", dueDate: "2026-10-15", gross: 1250000, customer: { name: "Hansen Eiendom AS", email: "post@hanseneiendom.no" } }]);
  if (url.includes("data.brreg.no") && url.includes("/roller")) return Response.json({ rollegrupper: [{ roller: [{ type: { kode: "DAGL" }, person: { navn: { fornavn: "Kari", etternavn: "Lund" } } }] }] });
  if (url.includes("data.brreg.no/enhetsregisteret/api/enheter?")) return Response.json({ page: { totalPages: 1 }, _embedded: { enheter: [
    { organisasjonsnummer: "911111111", navn: "Klipp og Krøll AS", organisasjonsform: { kode: "AS" }, antallAnsatte: 6, telefon: "55 55 55 55", epostadresse: "post@klippogkroll.no", hjemmeside: "klippogkroll.no", forretningsadresse: { adresse: ["Torget 1"], postnummer: "5014", poststed: "BERGEN" }, naeringskode1: { beskrivelse: "Frisering" }, stiftelsesdato: "2015-01-01" },
    { organisasjonsnummer: "922222222", navn: "Saks Kari Lund", organisasjonsform: { kode: "ENK" }, antallAnsatte: 0, mobil: "91234567", epostadresse: "kari@gmail.com", forretningsadresse: { adresse: ["Gate 2"], postnummer: "5089", poststed: "BERGEN" }, naeringskode1: { beskrivelse: "Frisering" }, stiftelsesdato: "2024-05-01" },
    { organisasjonsnummer: "933333333", navn: "Ingen Kontakt AS", organisasjonsform: { kode: "AS" }, antallAnsatte: 2, forretningsadresse: {}, naeringskode1: { beskrivelse: "Frisering" } } ] } });
  return ekteFetch(u, o);
};

let feil = 0;
const sjekk = (ok, t) => { console.log((ok ? "OK   " : "FEIL ") + t); if (!ok) feil++; };
const kall = async (sti, body, metode = "POST") => {
  const r = await worker.fetch(new Request("https://x.dev" + sti, metode === "POST" ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), env, { waitUntil: () => {} });
  const ct = r.headers.get("Content-Type") || "";
  return { status: r.status, d: ct.includes("json") ? await r.json() : await r.text() };
};
const F = { kunde: "demo-frisor", r: "fkode12345" };

// ---------- 1. Venteliste og påminnelse samme dag ----------
let r = await kall("/tillegg/admin", { kode: "admin", id: "demo-frisor", tillegg: { paminnelse: { pa: true, timerFor: 24, sammeDag: 2 }, kalender: { pa: true }, venteliste: { pa: true, antall: 2 }, live: false } });
sjekk(r.status === 200 && r.d.tillegg.venteliste.pa && r.d.tillegg.paminnelse.sammeDag === 2, "admin slår på venteliste og samme-dag-påminnelse");
const om = (dager) => new Date(Date.now() + dager * 864e5).toISOString().slice(0, 10);
r = await kall("/tillegg/time", { ...F, time: { navn: "Per Hansen", mobil: "98765432", hva: "Herreklipp", dato: om(3), klokkeslett: "12:00", varighet: 30 } });
sjekk(r.status === 200, "time lagt inn");
const timeId = r.d.data.timer.find((t) => t.navn === "Per Hansen").id;
for (const [navn, mobil, hva] of [["Ida", "45566778", "Herreklipp"], ["Siv", "47788990", "Dameklipp lang"], ["Tor", "40011223", ""]])
  r = await kall("/tillegg/venteliste", { ...F, vent: { navn, mobil, hva, fra: om(0), til: om(10) } });
sjekk(r.d.data.venteliste.length === 3, "tre på ventelisten");
r = await kall("/tillegg/venteliste", { ...F, vent: { navn: "Feil", mobil: "123" } });
sjekk(r.status === 400, "ugyldig mobil avvises");
sms.length = 0;
r = await kall("/tillegg/time/avlys", { ...F, tid: timeId });
const stille = (() => { const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Oslo", hour: "2-digit", hourCycle: "h23" }).format(new Date())); return h < 8 || h >= 21; })();
if (stille) {
  sjekk(r.d.venteliste.venter || r.d.venteliste.tilbudt === 0, "natt: ventelisten venter til kl. 08");
  await tilleggRunde(env, Date.now() + 0); // fortsatt natt: ingenting
  const t = JSON.parse(lager.get("timer:demo-frisor").v).find((x) => x.id === timeId);
  // Kjør runden «kl. 09 i morgen» ved å late som timen er fortsatt langt fram
  await tilleggRunde(env, Date.parse(om(1) + "T08:00:00Z"));
  sjekk(t.vl === 1, "timen er merket for venteliste-tilbud om morgenen");
}
const tilbud = sms.filter((s) => /ledig en time/.test(s.Body));
sjekk(tilbud.length === 2, "to passende på ventelisten fikk SMS (Ida: samme behandling, Tor: hva som helst; ikke Siv): " + tilbud.length);
sjekk(tilbud.every((s) => s.To === "+4741232557" && /\[TEST venteliste/.test(s.Body)), "testmodus: SMS går til testnummeret");
const lenke = (tilbud[0] && tilbud[0].Body.match(/\/v\/([a-z0-9]+)/)) || [];
r = await kall("/v/" + lenke[1], null, "GET");
sjekk(r.status === 200 && /Ja, jeg tar timen/.test(r.d), "venteliste-lenken viser «Ja, jeg tar timen»");
r = await kall("/v/" + lenke[1], {});
sjekk(/Timen er din/.test(r.d), "førstemann får timen");
const lenke2 = (tilbud[1] && tilbud[1].Body.match(/\/v\/([a-z0-9]+)/)) || [];
r = await kall("/v/" + lenke2[1], {});
sjekk(/tatt/.test(r.d), "nestemann får beskjed om at timen er tatt");
r = await kall(`/tillegg/data?kunde=demo-frisor&r=fkode12345`, null, "GET");
sjekk(r.d.hull.fylt === 1 && r.d.timer.some((t) => t.kilde === "venteliste" && !t.x), "hullet er fylt og vises på /sms");
sjekk(eposter.some((e) => /Hullet er fylt/.test(JSON.stringify(e))), "bedriften fikk e-post om at hullet er fylt");
// Påminnelse samme dag
sms.length = 0;
const timer = JSON.parse(lager.get("timer:demo-frisor").v);
const iDag = Date.parse(om(0) + "T14:00:00Z"); // 15:00 norsk tid
timer.push({ id: "sd1", s: iDag, v: 30, navn: "Lise", mobil: "+4799887766", hva: "Klipp", ok: false, kilde: "kunde", laget: iDag - 5 * 864e5, p: iDag - 30 * 3600e3, a: 0 });
await KV.put("timer:demo-frisor", JSON.stringify(timer));
await tilleggRunde(env, iDag - 90 * 60e3);
sjekk(sms.some((s) => /Vi ses i dag kl\. 15:00/.test(s.Body)), "påminnelse samme dag sendt 1,5 t før");
sms.length = 0; await tilleggRunde(env, iDag - 60 * 60e3);
sjekk(!sms.some((s) => /Vi ses i dag/.test(s.Body)), "ikke sendt to ganger");

// ---------- 2. Anmeldelser fra Google ----------
r = await kall("/agenter/data", F);
sjekk(r.d.google.klar === true && !r.d.google.placeId, "data: Google klar, ingen bedrift valgt");
r = await kall("/agenter/anmeldelser/finn", { ...F, sok: "Frisør Demo Bergen" });
sjekk(r.status === 200 && r.d.steder[0].placeId === "ChIJtest", "finner bedriften i Google");
r = await kall("/agenter/anmeldelser/sted", { ...F, placeId: "ChIJtest" });
sjekk(r.d.placeId === "ChIJtest", "Place ID lagret");

// ---------- 3. Fakturapurring (uten KI) ----------
r = await kall("/agenter/fakturaer", { ...F, ny: { nr: "1001", kunde: "Kari Nilsen", kontakt: "98765432", belop: "1890", forfall: om(-20) } });
sjekk(r.status === 200 && r.d.fakturaer[0].dagerForfalt === 20, "manuell faktura 20 dager forfalt");
r = await kall("/agenter/regnskap", { ...F, lagre: { system: "fiken", token: "hemmelig-token", slug: "demo-frisor", gebyr: 35, stemme: "Hei! Håper alt står bra til. Hilsen Lene" } });
sjekk(r.d.regnskap.harFiken && !JSON.stringify(r.d).includes("hemmelig-token"), "Fiken-nøkkel lagret og aldri sendt tilbake");
r = await kall("/agenter/fakturaer", F);
sjekk(r.d.fakturaer.length === 2 && r.d.fakturaer.some((f) => f.kilde === "fiken" && f.belop === 12500), "faktura fra Fiken (øre -> kr) + manuell");

// ---------- 4. Lead-finner ----------
r = await kall("/drift/api", { kode: "admin", handling: "leadsok", bransje: "frisor", kommune: "bergen", antall: 50 });
sjekk(r.status === 200 && r.d.rader.length === 3, "lead-finner: tre bedrifter");
const [a1] = r.d.rader;
sjekk(a1.navn === "Klipp og Krøll AS" && a1.kanal === "e-post" && a1.kontakt === "Kari Lund", "beste lead er AS med rolleadresse og daglig leder");
sjekk(r.d.rader.find((x) => x.form === "ENK").kanal === "ring selv", "ENK får aldri e-post (ring selv)");
r = await kall("/drift/api", { kode: "admin", handling: "leadsok", bransje: "frisor", kommune: "atlantis" });
sjekk(r.status === 400, "ukjent kommune gir 400");

// ---------- 5. Revisor: legg inn spor ----------
const idag = om(-7);
const sporRad = (n, meldinger, flagg = []) => KV.put(`spor:${idag}:demo-frisor:s${n}`, JSON.stringify({ id: "demo-frisor", kanal: "chat", t: idag + "T10:00:00Z", meldinger, verktoy: [], info: {}, flagg }), { metadata: { f: flagg.length, k: "chat", p: 0 } });
await sporRad(1, [["kunde", "Tar dere Vipps?"], ["ai", "Det er jeg usikker på. Jeg kan sende en beskjed til salongen."]]);
await sporRad(2, [["kunde", "Har dere parkering?"], ["ai", "Det vet jeg dessverre ikke. Vil du legge igjen en beskjed?"]]);
await sporRad(3, [["kunde", "Hva koster barneklipp?"], ["ai", "Barneklipp koster 250 kr."]], ["Pris 250 kr står ikke i profilen"]);
r = await kall("/drift/api", { kode: "admin", handling: "revisor-bruk", kunde: "demo-frisor", uke: "2026-U01", nr: 1 });
sjekk(r.status === 400, "bruk av ukjent revisjon gir 400");

if (ki) {
  r = await kall("/agenter/anmeldelser/hent", F);
  sjekk(r.status === 200 && r.d.nye.length === 2 && r.d.nye.every((x) => x.forslag.length === 3 && x.kilde === "google"), "to nye Google-anmeldelser med tre svarforslag hver");
  console.log(r.d.nye.map((x) => `${x.stjerner}★ ${x.navn}: ${x.forslag[0].svar}`).join("\n"));
  r = await kall("/agenter/anmeldelser/hent", F);
  sjekk(r.status === 200 && r.d.nye.length === 0 && r.d.kjente === 2, "andre gang: ingen nye");

  r = await kall("/agenter/fakturaer", F);
  const nokler = r.d.fakturaer.map((f) => f.nokkel);
  r = await kall("/agenter/kjor", { ...F, oppgave: "fakturapurring", nokler });
  const p = r.d.resultat || {};
  sjekk(r.status === 200 && p.purringer?.length === 2 && p.purringer.every((x) => x.trinn === 1), "purring trinn 1 for begge");
  sjekk(p.purringer?.every((x) => !/gebyr/i.test(x.melding)), "trinn 1 nevner ikke gebyr");
  sjekk(p.purringer?.find((x) => x.kontakt.includes("@"))?.kanal === "e-post" && p.purringer?.find((x) => /^\d+$/.test(x.kontakt))?.kanal === "sms", "e-post til e-post, sms til mobil");
  console.log(p.purringer?.map((x) => x.kanal + ": " + x.melding).join("\n---\n"));
  for (const x of p.purringer || []) await kall("/agenter/fakturaer", { ...F, nokkel: x.nokkel, handling: "purret", trinn: x.trinn });
  r = await kall("/agenter/kjor", { ...F, oppgave: "fakturapurring", nokler, trinn: 3 });
  const p3 = r.d.resultat || {};
  sjekk(p3.purringer?.every((x) => x.trinn === 3 && /inkasso/i.test(x.melding)), "trinn 3 er inkassovarsel");
  sjekk(p3.purringer?.every((x) => x.gebyr === 35 && /35/.test(x.melding)), "gebyret på 35 kr er med på trinn 3: " + JSON.stringify(p3.purringer?.map((x) => [x.gebyr, /35/.test(x.melding)])));
  const fristOk = p3.purringer?.every((x) => (Date.parse(x.frist) - Date.parse(om(0))) / 864e5 >= 14);
  sjekk(fristOk, "inkassovarsel har minst 14 dagers frist");
  console.log(p3.purringer?.[0]?.melding);

  r = await kall("/drift/api", { kode: "admin", handling: "leadsok", bransje: "frisor", kommune: "4601", meldinger: true });
  const m = r.d.rader.find((x) => x.orgnr === "911111111").melding || {};
  sjekk(m.emne && /stopp/i.test(m.tekst) && /Kari/.test(m.tekst), "e-post til AS: emne, fornavn og avmelding");
  const enk = r.d.rader.find((x) => x.form === "ENK").melding || {};
  sjekk(!enk.emne && enk.tekst, "ENK: ringemanus uten emne");
  console.log(m.emne, "\n", m.tekst, "\n---\n", enk.tekst);

  r = await kall("/drift/api", { kode: "admin", handling: "revisor", kunde: "demo-frisor", uke: 1, kjor: true });
  const rev = r.d.revisjon || {};
  sjekk(r.status === 200 && rev.funn?.length >= 2 && rev.rettelser?.length >= 1, `revisor: ${rev.funn?.length} funn, ${rev.rettelser?.length} rettelser`);
  sjekk(rev.funn?.some((f) => f.samtale === 3), "revisoren fant oppdiktet pris i samtale 3");
  console.log(JSON.stringify(rev, null, 1));
  const ekstra = rev.rettelser?.find((x) => x.felt === "ekstra");
  if (ekstra) {
    r = await kall("/drift/api", { kode: "admin", handling: "revisor-bruk", kunde: "demo-frisor", uke: rev.uke, nr: ekstra.nr, tekst: "Vi tar Vipps og kort. Gratis parkering i bakgården." });
    const prof = JSON.parse(lager.get("kunde:demo-frisor").v);
    sjekk(r.status === 200 && /Vipps og kort/.test(prof.ekstra) && JSON.parse(lager.get("historikk:demo-frisor").v)[0].av === "revisor", "rettelsen er lagt til i profilen, forrige versjon lagret");
  }
} else console.log("(hopper over KI-delene: ingen XAI_API_KEY)");
console.log(feil ? `\n${feil} feil` : "\nAlt OK");
process.exit(feil ? 1 : 0);
