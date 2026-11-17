// Orvelo ringeagent: Cloudflare Worker
//
// Flyt:
//   1. Kunden åpner «ring meg»-siden (GET /), skriver inn mobilnummer og krysser av for samtykke.
//   2. POST /kode  -> vi sender en SMS-kode for å bekrefte at nummeret er kundens eget (dobbelt samtykke).
//   3. POST /ring  -> riktig kode? Da ringer Telnyx (norsk nummer) eller Twilio kunden, og samtalen kobles til Grok.
//   4. GET  /media -> WebSocket mellom telefonlyden (Telnyx/Twilio) og Gemini Live (stemmen Aoede), eller Grok som reserve.
//   Innringing (Telnyx): ringer noen nummeret, svarer agenten, spør hvilket firma de ringer fra, henter
//   firmaets KI-sekretær (laget med /lag i orvelo-sekretar) og spiller den, så de hører hvordan den høres ut.
//   SMS (kode og bookinglenke) sendes alltid via Twilio, fra avsendernavnet «Orvelo».
//   Under samtalen kan agenten sende bookinglenken på SMS og sende Preben et sammendrag på e-post.
//
// Innstillinger (Cloudflare: Worker -> Settings -> Variables and Secrets):
//   GEMINI_API_KEY       (Secret, valgfri)  satt = Ada snakker med Gemini Live (stemmen Aoede). Uten den brukes Grok.
//   MOTOR                (Text,   valgfri)  «grok» = bruk Grok selv om GEMINI_API_KEY er satt (rask vei tilbake)
//   GEMINI_MODELL        (Text,   valgfri)  standard «gemini-3.8-live»
//   GEMINI_STEMME        (Text,   valgfri)  standard «Aoede» (Preben valgte den 2026-11-17)
//   XAI_API_KEY          (Secret)           xAI-nøkkelen (Grok), påkrevd når Gemini ikke er satt opp
//   TWILIO_ACCOUNT_SID   (Secret, påkrevd)  fra Twilio-forsiden
//   TWILIO_AUTH_TOKEN    (Secret, påkrevd)  fra Twilio-forsiden
//   TWILIO_FROM          (Text,   valgfri)  Twilio-nummeret samtalen ringer fra (brukes bare uten Telnyx)
//   TELNYX_API_KEY       (Secret, valgfri)  satt = samtalene går via Telnyx i stedet for Twilio
//   TELNYX_CONNECTION_ID (Text,   valgfri)  ID-en til «Voice API Application» i Telnyx
//   TELNYX_FROM          (Text,   valgfri)  det norske Telnyx-nummeret, f.eks. +4755123456
//   BOOKING_URL          (Text,   valgfri)  Google Avtaleplan-lenken
//   VARSEL_EPOST         (Text,   valgfri)  hvor sammendrag sendes (via FormSubmit)
//   STEMME               (Text,   valgfri)  Grok-stemme, standard «liora»
//   SMS_AVSENDER         (Text,   valgfri)  navnet SMS-ene kommer fra, standard «Orvelo» (tom = Twilio-nummeret)
//   KUNDER               (KV-binding, valgfri) samme KV som orvelo-sekretar (orvelo-kunder). Uten den kan
//                        innringere bare høre en eksempelsekretær, ikke sitt eget firma.
//   INNRING              (Text,   valgfri)  «av» = ikke svar på innkommende anrop
//   SEKRETAR             (Service-binding)   til orvelo-sekretar. Brukes av telefonlinjen (under).
//
// Telefonlinje for kunder: har Preben lagt inn et Telnyx-nummer for en kunde på /lag (del 4), står det i
// KV som linje:<nummer> -> kunde-id. Ringer noen det nummeret (kunden viderekobler telefonen sin dit), svarer
// Ada som kundens egen sekretær: instruksjonene og verktøyene (ledige tider, booking, SMS, beskjed) kommer
// fra orvelo-sekretar via /telefon/*, så telefonen, chatten og stemmen på nettsiden svarer likt.
//   TEST_NUMMER          (Text,   valgfri)  ditt eget nummer: hopper over SMS-koden (koden blir 0000) mens Twilio er prøvekonto

const BOOKING_URL_DEFAULT = "https://calendar.app.google/24niGvpRRwPqNqr28";
const VARSEL_EPOST_DEFAULT = "hilleren.bedrift@gmail.com";
const MODEL = "grok-voice-latest";
const GEMINI_MODELL = "gemini-3.8-live";
const GEMINI_STEMME = "Aoede";
const MAKS_SEK = 480; // operatøren legger på etter 8 minutter uansett
const KODE_GYLDIG_MS = 10 * 60 * 1000;

// ---------- små hjelpere ----------

const enc = new TextEncoder();

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function likt(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Godtar norske mobilnumre (4xx xx xxx / 9xx xx xxx), med eller uten +47.
export function normaliserNummer(input) {
  let s = String(input || "").replace(/[\s\-().]/g, "");
  if (s.startsWith("0047")) s = "+47" + s.slice(4);
  if (/^[49]\d{7}$/.test(s)) s = "+47" + s;
  return /^\+47[49]\d{7}$/.test(s) ? s : null;
}

function xmlEsc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Enkel bremse per nøkkel (per Cloudflare-instans).
const treff = new Map();
function forMange(nokkel, maks, vinduMs) {
  const naa = Date.now();
  const liste = (treff.get(nokkel) || []).filter((t) => naa - t < vinduMs);
  if (liste.length >= maks) { treff.set(nokkel, liste); return true; }
  liste.push(naa);
  treff.set(nokkel, liste);
  if (treff.size > 5000) treff.clear();
  return false;
}

async function twilio(env, sti, felter) {
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/${sti}`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(felter),
  });
  const tekst = await r.text();
  if (!r.ok) console.log("Twilio svarte", r.status, tekst.slice(0, 400));
  return { ok: r.ok, status: r.status, tekst };
}

// Gjør Twilios feilsvar om til en kort tekst, f.eks. «Twilio 21408: Permission to send an SMS has not been enabled ...».
function twilioFeil(r) {
  try { const d = JSON.parse(r.tekst); return `Twilio ${d.code || r.status}: ${d.message || ""}`.trim(); } catch {}
  return `HTTP ${r.status}`;
}

// SMS sendes med avsendernavnet «Orvelo» (Norge godtar alfanumerisk avsender).
const brukTelnyx = (env) => !!(env.TELNYX_API_KEY && env.TELNYX_CONNECTION_ID && env.TELNYX_FROM);

async function telnyx(env, sti, body) {
  const r = await fetch(`https://api.telnyx.com/v2/${sti}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const tekst = await r.text();
  if (!r.ok) console.log("Telnyx svarte", r.status, tekst.slice(0, 400));
  return { ok: r.ok, status: r.status, tekst };
}

function telnyxFeil(r) {
  try {
    const e = (JSON.parse(r.tekst).errors || [])[0] || {};
    return `Telnyx ${e.code || r.status}: ${e.detail || e.title || ""}`.trim();
  } catch {}
  return `HTTP ${r.status}`;
}

// Hvis Twilio avviser det, prøver vi på nytt fra Twilio-nummeret.
async function sendSms(env, til, tekst) {
  const navn = env.SMS_AVSENDER === undefined ? "Orvelo" : env.SMS_AVSENDER;
  if (navn) {
    const r = await twilio(env, "Messages.json", { To: til, From: navn, Body: tekst });
    if (r.ok) return r;
  }
  return twilio(env, "Messages.json", { To: til, From: env.TWILIO_FROM, Body: tekst });
}

async function varsle(env, emne, felter) {
  try {
    const r = await fetch(`https://formsubmit.co/ajax/${env.VARSEL_EPOST || VARSEL_EPOST_DEFAULT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ _subject: emne, _template: "table", ...felter }),
    });
    if (!r.ok) console.log("FormSubmit svarte", r.status);
  } catch (e) {
    console.log("Varsel feilet", e && e.message);
  }
}

// ---------- KI-agenten ----------

export function instruksjoner(navn, firma) {
  const hvem = [navn, firma].filter(Boolean).join(" fra ");
  return `Du er Ada, en KI-assistent som ringer på vegne av Orvelo, et lite norsk selskap i Bergen drevet av Preben Hilleren.
Du snakker norsk (bokmål), varmt, rolig og kort, som i en vanlig telefonsamtale. Maks to setninger om gangen, still ett spørsmål om gangen, og la kunden snakke. Ingen lister og ingen lange forklaringer. Hvis kunden avbryter deg, stopp og svar på det de sa. Før du bruker et verktøy, si kort hva du gjør (for eksempel «Jeg sender deg lenken nå»), så det ikke blir stille i telefonen.

Hvorfor du ringer: Kunden${hvem ? ` (${hvem})` : ""} har selv bedt om å bli ringt opp via nettsiden til Orvelo for å høre hvordan en KI-sekretær høres ut.
Du er selv et eksempel på tjenesten. Si alltid tydelig i starten at du er en KI og ikke et menneske.

Om tjenesten Orvelo KI-sekretær:
- Svarer kundene døgnet rundt når eieren er opptatt, for eksempel midt i en jobb eller med en kunde i stolen.
- Snakker naturlig norsk, svarer på spørsmål om priser, åpningstider og tjenester, foreslår ledige tider og tar imot forespørsler og beskjeder, som eieren får beskjed om.
- I dag når kundene sekretæren via en lenke eller knapp på nettsiden, Google-profilen og sosiale medier, i chat og med stemme. Svar på bedriftens eget telefonnummer er under utvikling og kommer uten ekstra kostnad. Lov aldri at den svarer på telefonnummeret deres i dag.
- Laget for håndverkere, frisører og andre små bedrifter som mister kunder når de ikke rekker å svare.
- Settes opp av Preben, tilpasset bedriften (prisliste, åpningstider, hva den skal svare på). Det tar rundt et kvarter av kundens tid.
- Pris (alt eks. mva., ingen oppstartskostnad): Starter 790 kroner i måneden med 50 minutter samtale, Pro 1 490 kroner med 200 minutter, Komplett 2 990 kroner med 500 minutter. Pro gir i tillegg booking i kalenderen og SMS til kundene, Komplett gir i tillegg KI-agenter for tilbud, faktura og annet kontorarbeid. Chat er ubegrenset. Ekstra minutter koster 5 kroner. De første 14 dagene er gratis, deretter er avtalen på 12 måneder. Spør kunden om pris, svar kort: «Fra 790 kroner i måneden pluss moms, uten oppstartskostnad. Prisen går etter hvor mange minutter dere trenger.» Ramse ikke opp alle pakkene med mindre de spør om dem.
- Personvern, avtalevilkår, integrasjon med bookingsystem og tekniske detaljer: si at Preben går gjennom det i møtet. Ikke finn på noe.

Målet med samtalen: Forklar kort, svar på spørsmål, og foreslå et uforpliktende møte på 30 minutter med Preben.
- Hvis kunden vil ha møte: bruk verktøyet send_bookinglenke. Si at de får en SMS nå med en lenke der de velger tidspunkt som passer, og at møtet havner rett i kalenderen til Preben.
- Hvis kunden heller vil bli ringt av Preben, eller nevner et bestemt tidspunkt: bruk verktøyet noter_for_preben med det kunden ønsket.
- Uansett utfall: før du avslutter, bruk noter_for_preben med et kort sammendrag (interesse, bransje, spørsmål, ønsket tid).
- Hvis kunden ikke er interessert: takk høflig, noter det, og avslutt. Ikke mas.
- Når samtalen er ferdig og du har sagt ha det: bruk verktøyet legg_paa.
Hvis du hører en telefonsvarer eller ingen svarer: si én kort setning om at Orvelo ringte som avtalt og at de kan booke på nettsiden, og bruk legg_paa.
Hvis kunden har dårlig tid: tilby å sende bookinglenken på SMS, gjør det, si ha det og bruk legg_paa.

# Slik avslutter du
0. Avslutt ikke før kunden er ferdig. Har kunden fått det de trengte, spør kort om det er noe mer de lurer på (hopp over dette hvis de har dårlig tid eller ikke er interessert).
1. Bruk noter_for_preben.
2. Si ha det i én kort setning, for eksempel «Takk for praten, ha en fin dag!».
3. Bruk legg_paa med en gang etterpå. Ikke vent på svar.`;
}

// ---------- innringing: kunden ringer selv og tester sin egen sekretær ----------

const DAGNAVN = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
const MND = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];

function osloNaa(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const x = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  return { iso: `${x.year}-${x.month}-${x.day}`, tid: `${x.hour}:${x.minute}` };
}
function pentDato(iso) {
  const d = new Date(iso + "T12:00:00Z");
  return `${DAGNAVN[d.getUTCDay()]} ${d.getUTCDate()}. ${MND[d.getUTCMonth()]}`;
}

// Gjør «Berg Rør AS» om til «berg-ror», som id-ene i KV starter med.
export function slugg(s) {
  return String(s || "").toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, " ").replace(/\b(as|asa|enk|da|ans|og|the)\b/g, " ").trim().replace(/\s+/g, "-");
}
function bigram(s) {
  const t = s.replace(/-/g, ""); const m = new Map();
  for (let i = 0; i < t.length - 1; i++) { const b = t.slice(i, i + 2); m.set(b, (m.get(b) || 0) + 1); }
  return m;
}
// Likhet 0–1 mellom det kunden sa og et firma-id (Dice på bokstavpar), så «Berg rør» treffer «berg-ror-x1y2».
export function likhet(a, b) {
  const A = bigram(a), B = bigram(b); let felles = 0, n = 0;
  for (const [k, v] of A) { n += v; felles += Math.min(v, B.get(k) || 0); }
  for (const v of B.values()) n += v;
  return n ? (2 * felles) / n : 0;
}

export async function finnFirma(env, navn) {
  if (!env.KUNDER) return { funnet: false, grunn: "Firmaoversikten er ikke koblet til." };
  const sagt = slugg(navn);
  if (sagt.length < 2) return { funnet: false, grunn: "Fikk ikke med meg navnet." };
  const kandidater = [];
  let cursor;
  do {
    const l = await env.KUNDER.list({ prefix: "kunde:", cursor });
    for (const k of l.keys) {
      const id = k.name.slice(6);
      const base = id.replace(/-[a-z0-9]{4}$/, "");
      const score = base === sagt ? 1 : base.startsWith(sagt) || sagt.startsWith(base) ? 0.9 : likhet(sagt, base);
      if (score >= 0.5) kandidater.push({ id, score });
    }
    cursor = l.list_complete ? null : l.cursor;
  } while (cursor);
  kandidater.sort((a, b) => b.score - a.score);
  if (!kandidater.length) return { funnet: false, grunn: "Fant ingen sekretær med det navnet." };
  const beste = kandidater.filter((k) => k.score >= kandidater[0].score - 0.05).slice(0, 3);
  const profiler = (await Promise.all(beste.map((k) => env.KUNDER.get("kunde:" + k.id, "json")))).filter(Boolean);
  if (!profiler.length) return { funnet: false, grunn: "Fant ingen sekretær med det navnet." };
  if (profiler.length > 1) return { funnet: false, flere: profiler.map((p) => `${p.navn}${p.adresse ? " (" + p.adresse + ")" : ""}`) };
  return { funnet: true, profil: profiler[0] };
}

// Noen ledige demotider de neste dagene, ut fra åpningstidene.
function demoTider(profil) {
  const ut = [];
  const start = new Date();
  for (let i = 1; i <= 10 && ut.length < 5; i++) {
    const iso = osloNaa(new Date(start.getTime() + i * 864e5)).iso;
    const dag = new Date(iso + "T12:00:00Z").getUTCDay();
    const a = profil.apent && profil.apent[dag];
    if (!Array.isArray(a)) continue;
    const fra = Number(a[0].slice(0, 2)), til = Number(a[1].slice(0, 2));
    const valg = [fra + 1, Math.round((fra + til) / 2), til - 2].filter((h, j, l) => h >= fra && h < til && l.indexOf(h) === j);
    ut.push(`${pentDato(iso)}: ${valg.map((h) => `${String(h).padStart(2, "0")}:00`).join(", ")}`);
  }
  return ut.join("\n") || "Ingen faste åpningstider: tilby å legge igjen beskjed.";
}

export function rolleInstruks(p) {
  const befaring = p.type === "befaring";
  const sted = p.sted || "firmaet";
  const naa = osloNaa();
  const prisliste = (p.tjenester || []).map(([kat, l]) => `${kat}: ` + (l || []).map(([x, pris]) => `${x} ${pris}`).join("; ")).join("\n");
  const kontakt = [p.adresse && `Adresse: ${p.adresse}.`, p.omraade && `Område: ${p.omraade}.`].filter(Boolean).join(" ");
  return `# Rolle nå
Du spiller den digitale telefonsekretæren til ${p.navn}${p.bransje ? ", " + p.bransje : ""}. Personen som ringer er trolig eier eller ansatt i ${p.kortnavn || p.navn} og vil høre hvordan sekretæren ville tatt imot kundene deres.
Si først kort: «Da hører du nå hvordan jeg ville svart for ${p.kortnavn || p.navn}. Lat som du er en kunde som ringer.» Svar så som sekretæren: «${p.kortnavn || p.navn}, hei! Hva kan jeg hjelpe deg med?»

# Stil
Norsk bokmål, kort og varmt, én eller to setninger om gangen, ett spørsmål om gangen. Si klokkeslett og priser slik folk sier dem.

# Tid
I dag er det ${pentDato(naa.iso)}, klokka ${naa.tid}.

# Bedriften
${kontakt}
Åpningstider: ${p.apentTekst || "ukjent"}
${(p.ansatte || []).length ? "Ansatte: " + p.ansatte.join(", ") + "." : ""}
${p.ekstra || ""}

# Prisliste (veiledende)
${prisliste || "Ingen prisliste: si at prisen avtales etter befaring eller ved oppmøte."}

# Ledige tider (demo)
${demoTider(p)}

# Firmaets egne regler går foran
Teksten under «Bedriften» er skrevet av ${p.kortnavn || p.navn} selv. Står det der hvordan du skal håndtere noe (døgnvakt, akutte saker, avbestilling, hva de ikke gjør), følg det nøyaktig, også om stegene under sier noe annet. Si aldri at noe er umulig hvis firmaet selv har sagt at de tilbyr det.

# Når noe haster
${befaring
    ? "Lekkasje, vannskade, strømbrudd, gasslukt eller fare: Si FØRST det trygge rådet i én setning (for eksempel «Steng hovedkranen med en gang» eller «Slå av sikringen»), også om kunden bare spør når noen kan komme. Si så hva som skjer videre slik firmaet har beskrevet det (for eksempel at vakthavende ringer tilbake). Spør om navn, mobilnummer og adresse, gjenta nummeret, og bruk legg_igjen_beskjed med «HASTER:» først. Lov aldri et tidspunkt for oppmøte."
    : "Sterke smerter, hevelse eller skade: følg firmaets egne regler for akutte saker. Ved hevelse med feber, pustevansker eller kraftig blødning: be personen ringe legevakten på 116 117 først, og si hvorfor. Nevn 113 bare som eget råd: «Ved livsfare, ring 113.» 113 er ikke legevakten. Si aldri hva det kan være (ingen diagnose). Tilby så det firmaet sier, eller send beskjed med «HASTER:» først."}

# Slik ${befaring ? "booker du befaring" : "booker du time"}
${befaring
    ? "Finn ut hva jobben gjelder og om noe haster (se over). Foreslå to av de ledige tidene, spør om navn, mobilnummer og adressen jobben gjelder, og bruk bestill_demo."
    : "Finn ut hva kunden vil ha, foreslå to av de ledige tidene, spør om fornavn og mobilnummer, og bruk bestill_demo. Ønsker kunden en bestemt ansatt, si at du noterer ønsket."}
Spørsmål du ikke kan svare på, flytting og klager: spør om navn og nummer, bruk legg_igjen_beskjed og si at ${sted} ringer tilbake.
Gi aldri andre priser enn prislisten, og lov aldri noe ${sted} ikke har sagt. Står noe ikke i prislisten, si at du ikke er sikker og tilby å sende spørsmålet videre. Ingen medisinske eller tekniske vurderinger.

# Etter demoen
Når de har prøvd, eller hvis de spør hva dette koster og hvordan det settes opp: gå ut av rollen og vær Ada fra Orvelo igjen.
Tre pakker med fast månedspris eks. mva. og uten oppstartskostnad: Starter 790 kroner (50 minutter samtale i måneden), Pro 1 490 kroner (200 minutter) og Komplett 2 990 kroner (500 minutter). Pro gir i tillegg booking og SMS til kundene, Komplett gir KI-agenter for kontorarbeidet. Minutter utover pakken koster 5 kroner. De første 14 dagene er gratis. Preben setter det opp, tilpasset ${sted}.
Tilby et kort møte med Preben (send_bookinglenke), skriv sammendrag med noter_for_preben, si ha det og bruk legg_paa.`;
}

export function innringInstruks() {
  return `Du er Ada, en KI-assistent fra Orvelo, et lite norsk selskap i Bergen drevet av Preben Hilleren. Orvelo lager KI-sekretærer som svarer telefonen for håndverkere og andre små bedrifter.
Du snakker norsk (bokmål), varmt og kort, maks to setninger om gangen. Si tydelig at du er en KI hvis noen spør.

Noen har ringt Orvelos demonummer, trolig etter en e-post der vi skrev at vi har laget en KI-sekretær til firmaet deres.
1. Spør hvilket firma de ringer fra, og bruk verktøyet finn_firma med navnet. Er du usikker på navnet, spør dem om å si det en gang til.
2. Finner du firmaet: følg instruksjonene i svaret fra verktøyet og spill sekretæren deres.
3. Finner du flere: les opp valgene kort og spør hvilket. Bruk så finn_firma med det fulle navnet.
4. Finner du det ikke etter to forsøk: si at sekretæren deres ikke er laget ennå, men at de kan høre et eksempel. Spør hva slags bedrift de har, og spill en vennlig sekretær for et eksempelfirma i den bransjen (navn: «Eksempelfirmaet»). Ikke nevn priser for eksempelfirmaet.
Hvis noen bare vil vite hva Orvelo er: forklar kort, tilby et møte med Preben (send_bookinglenke).
Før du avslutter: bruk noter_for_preben med et kort sammendrag, si ha det og bruk legg_paa.`;
}

export const INN_VERKTOY = () => [
  {
    type: "function",
    name: "finn_firma",
    description: "Finn KI-sekretæren Orvelo har laget for firmaet personen ringer fra.",
    parameters: { type: "object", properties: { navn: { type: "string", description: "Firmanavnet slik personen sa det" } }, required: ["navn"] },
  },
  {
    type: "function",
    name: "bestill_demo",
    description: "Bestill time eller befaring i demoen (ingenting bookes på ekte).",
    parameters: {
      type: "object",
      properties: { hva: { type: "string" }, dag: { type: "string" }, klokkeslett: { type: "string" }, navn: { type: "string" }, mobil: { type: "string" }, adresse: { type: "string" } },
      required: ["hva", "dag", "klokkeslett"],
    },
  },
  {
    type: "function",
    name: "legg_igjen_beskjed",
    description: "Ta imot en beskjed til firmaet i demoen.",
    parameters: { type: "object", properties: { beskjed: { type: "string" }, navn: { type: "string" }, mobil: { type: "string" } }, required: ["beskjed"] },
  },
  ...VERKTOY,
];

export const VERKTOY = [
  {
    type: "function",
    name: "send_bookinglenke",
    description: "Send kunden en SMS med lenken der de booker et 30-minutters møte med Preben.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "noter_for_preben",
    description: "Send Preben et kort sammendrag av samtalen. Bruk før du avslutter, og når kunden ønsker et bestemt tidspunkt eller å bli ringt av Preben.",
    parameters: {
      type: "object",
      properties: {
        interesse: { type: "string", enum: ["høy", "middels", "lav", "ingen"] },
        bransje: { type: "string" },
        onsket_tid: { type: "string", description: "Tidspunkt kunden ønsket for møte eller oppringing, hvis noe." },
        sammendrag: { type: "string" },
      },
      required: ["interesse", "sammendrag"],
    },
  },
  {
    type: "function",
    name: "legg_paa",
    description: "Avslutt telefonsamtalen. Bruk bare etter at du har sagt ha det.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

// ---------- Gemini Live (stemmen Aoede) ----------
// Telefonen gir μ-law 8 kHz. Gemini vil ha PCM 16 kHz inn og gir PCM 24 kHz ut. Vi gjør om begge veier.

export const brukGemini = (env) => !!env.GEMINI_API_KEY && String(env.MOTOR || "").toLowerCase() !== "grok";

const ULAW_TIL_LIN = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff, exp = (u >> 4) & 7, mant = u & 0x0f;
  const s = (((mant << 3) + 0x84) << exp) - 0x84;
  ULAW_TIL_LIN[i] = u & 0x80 ? -s : s;
}
function linTilUlaw(s) {
  let sign = 0;
  if (s < 0) { sign = 0x80; s = -s; }
  if (s > 32635) s = 32635;
  s += 0x84;
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1);
  return ~(sign | (exp << 4) | ((s >> (exp + 3)) & 0x0f)) & 0xff;
}
function fraB64(b64) {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function tilB64(u8) {
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

// μ-law 8 kHz (base64) -> PCM 16 kHz (base64). forrige = siste sample fra forrige bit, for jevn overgang.
export function ulawTilPcm16k(b64, st = { forrige: 0 }) {
  const u = fraB64(b64), ut = new Int16Array(u.length * 2);
  let f = st.forrige;
  for (let i = 0; i < u.length; i++) {
    const s = ULAW_TIL_LIN[u[i]];
    ut[2 * i] = (f + s) >> 1;
    ut[2 * i + 1] = s;
    f = s;
  }
  st.forrige = f;
  return tilB64(new Uint8Array(ut.buffer));
}

// PCM 24 kHz (base64) -> μ-law 8 kHz (base64). Lavpassfilter (FIR, 49 ledd, grense 3,4 kHz) før vi tar hver tredje
// sample, så stemmen blir klar og uten skurring (aliasing). Filterhistorikken tas vare på i st mellom lydbitene.
const FIR = (() => {
  const n = 49, fc = 3400 / 24000, h = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = i - (n - 1) / 2;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1)); // Blackman
    h.push(sinc * w); sum += sinc * w;
  }
  return h.map((v) => v / sum);
})();
export function pcm24kTilUlaw(b64, st = {}) {
  const b = fraB64(b64);
  const n = b.length >> 1, dv = new DataView(b.buffer, b.byteOffset, n * 2);
  const hist = st.hist || new Array(FIR.length - 1).fill(0);
  const buf = new Float64Array(hist.length + n);
  for (let i = 0; i < hist.length; i++) buf[i] = hist[i];
  for (let i = 0; i < n; i++) buf[hist.length + i] = dv.getInt16(i * 2, true);
  const ut = [];
  let i = hist.length + (st.fase || 0);
  for (; i < buf.length; i += 3) {
    let y = 0;
    for (let k = 0; k < FIR.length; k++) y += FIR[k] * buf[i - k];
    ut.push(linTilUlaw(Math.max(-32768, Math.min(32767, Math.round(y)))));
  }
  st.fase = i - buf.length;
  st.hist = Array.from(buf.subarray(buf.length - hist.length));
  return tilB64(Uint8Array.from(ut));
}

// Verktøy i Grok/OpenAI-format -> Gemini functionDeclarations (typer med store bokstaver, bare felt Gemini forstår).
function geminiSkjema(s) {
  if (!s || typeof s !== "object") return s;
  const ut = {};
  if (s.type) ut.type = String(s.type).toUpperCase();
  if (s.description) ut.description = s.description;
  if (s.enum) ut.enum = s.enum;
  if (s.items) ut.items = geminiSkjema(s.items);
  if (s.properties) {
    ut.properties = {};
    for (const [k, v] of Object.entries(s.properties)) ut.properties[k] = geminiSkjema(v);
    if (!Object.keys(ut.properties).length) delete ut.properties;
  }
  if (Array.isArray(s.required) && s.required.length) ut.required = s.required;
  return ut;
}
export function geminiVerktoy(verktoy) {
  const decl = (verktoy || []).filter((v) => v && v.name).map((v) => {
    const d = { name: v.name, description: v.description || "" };
    const p = geminiSkjema(v.parameters);
    if (p && p.properties) d.parameters = p;
    return d;
  });
  return decl.length ? [{ functionDeclarations: decl }] : [];
}

// Øktoppsettet for Gemini Live: samme instruksjoner og verktøy som Grok får.
export function geminiOppsett(env, kunde) {
  const s = sesjon(env, kunde);
  return {
    setup: {
      model: `models/${env.GEMINI_MODELL || GEMINI_MODELL}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: env.GEMINI_STEMME || GEMINI_STEMME } } },
      },
      systemInstruction: { parts: [{ text: s.instructions + "\n\nSnakk alltid naturlig norsk bokmål." }] },
      tools: geminiVerktoy(s.tools),
      realtimeInputConfig: {
        automaticActivityDetection: {
          startOfSpeechSensitivity: "START_SENSITIVITY_LOW", // telefonlinjer har støy
          prefixPaddingMs: 300,
          silenceDurationMs: Number(env.VAD_STILLE_MS) || 450,
        },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}

// Første replikk: Gemini har ikke «si nøyaktig dette», så vi ber om det.
export const geminiStart = (forste) => ({
  clientContent: {
    turns: [{ role: "user", parts: [{ text: `(Telefonsamtalen er koblet til. Start med å si nøyaktig dette, og ikke noe mer: «${forste}»)` }] }],
    turnComplete: true,
  },
});

// Øktoppsettet for Grok. Eksportert så tools/test-ada.mjs tester det samme som telefonen bruker.
export function sesjon(env, kunde) {
  const o = kunde.oppsett; // telefonlinje for en kunde
  return {
    voice: env.STEMME || "liora",
    instructions: o ? o.instruksjoner : kunde.inn ? innringInstruks() : instruksjoner(kunde.navn, kunde.firma),
    tools: o ? o.verktoy : kunde.inn ? INN_VERKTOY() : VERKTOY,
    // Telefonlinjer har støy, og folk tar små pauser midt i setninger. Litt høyere terskel og lengre pause
    // før Ada svarer gir færre falske avbrytelser og færre ganger hun snakker i munnen på kunden.
    turn_detection: {
      type: "server_vad",
      threshold: Number(env.VAD_TERSKEL) || 0.6,
      prefix_padding_ms: 300,
      silence_duration_ms: Number(env.VAD_STILLE_MS) || 450,
    },
    audio: {
      input: { format: { type: "audio/pcmu" }, transcription: { language_hint: "no", keyterms: (o ? o.keyterms || [] : ["Orvelo", "Preben", "Ada", "KI-sekretær", kunde.firma]).filter(Boolean) } },
      output: { format: { type: "audio/pcmu" } },
    },
  };
}

export function forsteReplikk(kunde) {
  if (kunde.oppsett) return kunde.oppsett.forste;
  const hei = kunde.navn ? `Hei, ${kunde.navn.split(" ")[0]}!` : "Hei!";
  return kunde.inn
    ? "Hei, du har ringt Orvelo! Jeg er Ada, en KI-assistent. Hvilket firma ringer du fra?"
    : `${hei} Det er Ada fra Orvelo, en KI-assistent. Du ba om en samtale for å høre hvordan en KI-sekretær høres ut. Passer det nå?`;
}

// tlfWs = WebSocket fra Telnyx eller Twilio. urlParam = parameterne fra stream-URL-en (Telnyx).
// Eksportert så tools/test-ada-gemini.mjs kan kjøre en hel samtale lokalt.
export async function koblSamtale(env, tlfWs, urlParam) {
  let streamSid = null;
  let callSid = null;
  let erTelnyx = false;
  let kunde = {};
  let xai = null;
  let lenkeSendt = false;
  let notat = null; // sammendraget agenten skriver
  let rapportSendt = false;
  const logg = []; // hele samtalen, som tekst
  const demoHendelser = []; // hva som skjedde i demoen ved innringing
  const linjeData = { bookinger: [], beskjeder: [], verktoy: [] }; // telefonlinje: det som ble booket og sendt
  const tid = () => {
    const sek = Math.round((Date.now() - startet) / 1000);
    return `${Math.floor(sek / 60)}:${String(sek % 60).padStart(2, "0")}`;
  };
  const startet = Date.now();
  const ventende = []; // lyd fra kunden før Grok er klar
  const utKo = []; // lyd fra Grok før telefonstrømmen har sagt «start»
  let tlfKlar = false;
  let avbrutt = false; // kunden avbrøt: dropp resten av lyden fra svaret som ble avbrutt
  let lydSlutt = 0; // når lyden vi har sendt er ferdig spilt av hos kunden (ms, omtrent)
  let sisteAktivitet = Date.now(); // sist noen snakket
  let spurtOmTilstede = false;
  let avslutter = false;

  const tilTlf = (obj) => { try { tlfWs.send(JSON.stringify(obj)); } catch {} };
  const sendLyd = (payload) => {
    if (!tlfKlar) { if (utKo.length < 400) utKo.push(payload); return; }
    // PCMU er 8000 byte i sekundet. Hold oversikt over når lyden er ferdig avspilt.
    const ms = (payload.length * 3 / 4) / 8;
    lydSlutt = Math.max(lydSlutt, Date.now()) + ms;
    sisteAktivitet = Date.now();
    if (erTelnyx) tilTlf({ event: "media", media: { payload } });
    else if (streamSid) tilTlf({ event: "media", streamSid, media: { payload } });
  };
  const stoppLyd = () => {
    lydSlutt = Date.now();
    if (erTelnyx) tilTlf({ event: "clear" }); else if (streamSid) tilTlf({ event: "clear", streamSid });
  };
  const tilXai = (obj) => { if (xai && xai.readyState === 1) xai.send(JSON.stringify(obj)); };
  // Gemini: xai er da WebSocket-en til Gemini, og geminiKlar blir satt når oppsettet er godtatt.
  const gemini = brukGemini(env);
  let geminiKlar = false;
  const innSt = { forrige: 0 }, utSt = {};
  const sendInnLyd = (pcmu) => {
    if (gemini) tilXai({ realtimeInput: { audio: { data: ulawTilPcm16k(pcmu, innSt), mimeType: "audio/pcm;rate=16000" } } });
    else tilXai({ type: "input_audio_buffer.append", audio: pcmu });
  };
  const motorKlar = () => xai && xai.readyState === 1 && (!gemini || geminiKlar);
  // Be Ada si noe (f.eks. «er du der?»), uten at kunden har sagt noe.
  const be = (instruks) => gemini
    ? tilXai({ clientContent: { turns: [{ role: "user", parts: [{ text: `(${instruks})` }] }], turnComplete: true } })
    : tilXai({ type: "response.create", response: { instructions: instruks } });

  // Stillhet: spør én gang om de er der etter 20 sek, legg på etter 12 sek til. Sparer minutter på telefonsvarer og glemte samtaler.
  const stilleMs = Number(env.STILLE_MS) || 20000;
  const stilleSjekk = setInterval(() => {
    if (avslutter || !xai) return;
    const stille = Date.now() - Math.max(sisteAktivitet, lydSlutt);
    if (!spurtOmTilstede && stille > stilleMs) {
      spurtOmTilstede = true;
      sisteAktivitet = Date.now();
      be("Det har vært stille en stund. Spør kort og vennlig om personen fortsatt er der.");
    } else if (spurtOmTilstede && stille > stilleMs * 0.6) {
      avslutter = true;
      logg.push(`[${tid()}] (lagt på etter stillhet)`);
      leggPaa(0);
    }
  }, Math.min(2000, stilleMs / 4));

  async function leggPaa(etterMs) {
    avslutter = true;
    clearInterval(stilleSjekk);
    await new Promise((r) => setTimeout(r, etterMs));
    // Vent til ha det-replikken faktisk er spilt av (maks 12 sek), så den ikke kuttes midt i.
    for (let i = 0; i < 40 && Date.now() < lydSlutt + 600; i++) await new Promise((r) => setTimeout(r, 300));
    if (callSid && erTelnyx) await telnyx(env, `calls/${encodeURIComponent(callSid)}/actions/hangup`, {});
    else if (callSid) await twilio(env, `Calls/${callSid}.json`, { Status: "completed" });
    try { tlfWs.close(1000, "ferdig"); } catch {}
    try { xai && xai.close(1000, "ferdig"); } catch {}
  }

  async function kjorVerktoy(navn, args) {
    if (kunde.linje && navn !== "legg_paa") {
      // Kundens egen sekretær: verktøyet kjøres i orvelo-sekretar, likt med chatten.
      try {
        const d = await tilSekretar(env, "/telefon/verktoy", { kunde: kunde.linje, fra: kunde.til, navn, args });
        const res = d.res || { feil: "Ingen svar." };
        linjeData.bookinger.push(...(d.bookinger || []));
        linjeData.beskjeder.push(...(d.beskjeder || []));
        linjeData.verktoy.push({ tur: logg.filter((l) => / Kunde: /.test(l)).length, navn, args, res });
        return res;
      } catch (e) {
        console.log("telefon-verktøy feilet", e && e.message);
        return { feil: "Det gikk ikke akkurat nå. Si at du noterer det, og be kunden ringe igjen litt senere hvis det haster." };
      }
    }
    if (navn === "finn_firma") {
      const r = await finnFirma(env, args.navn);
      if (r.funnet) {
        const p = r.profil;
        kunde.firma = p.navn;
        demoHendelser.push(`Fant sekretæren til ${p.navn} (${p.id})`);
        const rolle = rolleInstruks(p);
        if (!gemini) tilXai({ type: "session.update", session: { instructions: innringInstruks() + "\n\n" + rolle } });
        return { funnet: true, firma: p.navn, instruksjoner: rolle, merk: "Følg disse instruksjonene fra nå av, når du spiller sekretæren." };
      }
      demoHendelser.push(`Søkte etter «${String(args.navn || "").slice(0, 60)}»: ${r.flere ? "flere treff" : "ingen treff"}`);
      return r;
    }
    if (navn === "bestill_demo") {
      demoHendelser.push(`Demo-bestilling: ${[args.hva, args.dag, args.klokkeslett, args.navn, args.mobil, args.adresse].filter(Boolean).join(" · ")}`);
      return { ok: true, info: "Bestilt i demoen. Si at kunden får en SMS med bekreftelse (i demoen sendes den ikke)." };
    }
    if (navn === "legg_igjen_beskjed") {
      args.beskjed = String(args.beskjed || "").replace(/^\s*(haster|akutt|hastesak)\s*[:!.-]?\s*/i, "HASTER: ");
      if (!/\d{8,}/.test(String(args.mobil || "").replace(/\D/g, "")))
        return { ok: false, feil: "Beskjeden er IKKE sendt ennå. Haster det, si først det trygge rådet og hva som skjer videre. Spør så om navn og mobilnummer, gjenta nummeret, og send beskjeden når du har det." };
      demoHendelser.push(`Demo-beskjed: ${[args.beskjed, args.navn, args.mobil].filter(Boolean).join(" · ")}`);
      return { ok: true, info: "Beskjeden er notert i demoen." };
    }
    if (navn === "send_bookinglenke") {
      if (!normaliserNummer(kunde.til)) return { ok: false, melding: "Nummeret er ikke en norsk mobil. Si at de kan booke via lenken i e-posten." };
      if (lenkeSendt) return { ok: true, melding: "Lenken er allerede sendt." };
      const r = await sendSms(env, kunde.til,
        `Hei! Her er lenken for å booke et uforpliktende møte (30 min) med Preben i Orvelo: ${env.BOOKING_URL || BOOKING_URL_DEFAULT}`);
      lenkeSendt = r.ok;
      return r.ok ? { ok: true, melding: "SMS med bookinglenke er sendt." } : { ok: false, melding: "SMS feilet. Si at Preben sender lenken." };
    }
    if (navn === "noter_for_preben") {
      notat = args;
      return { ok: true };
    }
    if (navn === "legg_paa") {
      leggPaa(800);
      return { ok: true };
    }
    return { ok: false, melding: "Ukjent verktøy" };
  }

  async function startGrok() {
    // Telefonlinje: hent sekretærens oppsett samtidig som vi kobler til Grok, så det ikke tar lenger før hun svarer.
    const oppsett = kunde.linje && !kunde.oppsett
      ? tilSekretar(env, "/telefon/oppsett", { kunde: kunde.linje, fra: kunde.til }).catch((e) => { console.log("telefon-oppsett feilet", e && e.message); return null; })
      : null;
    const [r, o] = await Promise.all([gemini
      ? fetch("https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent", {
        headers: { Upgrade: "websocket", "x-goog-api-key": env.GEMINI_API_KEY },
      })
      : fetch(`https://api.x.ai/v1/realtime?model=${MODEL}`, {
        headers: { Upgrade: "websocket", Authorization: `Bearer ${env.XAI_API_KEY}` },
      }), oppsett]);
    if (o && o.instruksjoner) { kunde.oppsett = o; kunde.firma = o.firma || ""; }
    if (!r.webSocket) {
      console.log(gemini ? "Fikk ikke kontakt med Gemini" : "Fikk ikke kontakt med xAI", r.status, (await r.text()).slice(0, 300));
      leggPaa(0);
      return;
    }
    xai = r.webSocket;
    xai.accept();
    if (kunde.linje && !kunde.oppsett) {
      // Fikk vi ikke hentet sekretæren: si det kort og legg på (bedre enn en sekretær som ikke vet noe).
      kunde.oppsett = { instruksjoner: "Si bare replikken du har fått, ikke noe mer.", verktoy: [], keyterms: [],
        forste: "Hei! Beklager, vi har et teknisk problem akkurat nå. Prøv å ringe igjen om litt." };
      logg.push(`[${tid()}] (fikk ikke hentet sekretæren, la på)`);
      leggPaa(9000);
    }
    if (gemini) { startGemini(); return; }
    tilXai({ type: "session.update", session: sesjon(env, kunde) });
    const forste = forsteReplikk(kunde);
    tilXai({
      type: "conversation.item.create",
      item: {
        type: "force_message", role: "assistant", interruptible: true,
        content: [{ type: "output_text", text: forste }],
      },
    });
    while (ventende.length) sendInnLyd(ventende.shift());

    xai.addEventListener("message", async (m) => {
      let e;
      try { e = JSON.parse(m.data); } catch { return; }
      const t = e.type;
      if (t === "response.created") { avbrutt = false; return; }
      if (t === "response.output_audio.delta" || t === "response.audio.delta") {
        if (!avbrutt) sendLyd(e.delta);
        return;
      }
      if (t === "response.output_audio_transcript.done" || t === "response.audio_transcript.done") {
        if (e.transcript && e.transcript.trim()) logg.push(`[${tid()}] Ada: ${e.transcript.trim()}${avbrutt ? " (avbrutt)" : ""}`);
        return;
      }
      if (t.includes("input_audio_transcription.completed")) {
        if (e.transcript && e.transcript.trim()) logg.push(`[${tid()}] Kunde: ${e.transcript.trim()}`);
        return;
      }
      if (t === "input_audio_buffer.speech_started") {
        // Kunden begynte å snakke: stopp det som spilles, og dropp resten av svaret som er på vei.
        sisteAktivitet = Date.now();
        spurtOmTilstede = false;
        if (Date.now() < lydSlutt) avbrutt = true;
        stoppLyd();
        return;
      }
      if (t === "input_audio_buffer.speech_stopped") { sisteAktivitet = Date.now(); return; }
      if (t === "response.function_call_arguments.done") {
        let args = {};
        try { args = JSON.parse(e.arguments || "{}"); } catch {}
        const res = await kjorVerktoy(e.name, args);
        tilXai({ type: "conversation.item.create", item: { type: "function_call_output", call_id: e.call_id, output: JSON.stringify(res) } });
        if (e.name !== "legg_paa") tilXai({ type: "response.create" });
        return;
      }
      if (t === "error") console.log("xAI-feil", JSON.stringify(e).slice(0, 300));
    });
    xai.addEventListener("close", () => { clearInterval(stilleSjekk); try { tlfWs.close(1000, "grok lukket"); } catch {} });
  }

  function startGemini() {
    tilXai(geminiOppsett(env, kunde));
    let innTekst = "", utTekst = "";
    const loggKunde = () => { if (innTekst.trim()) logg.push(`[${tid()}] Kunde: ${innTekst.trim()}`); innTekst = ""; };
    const loggAda = () => {
      if (/[\p{L}\d]/u.test(utTekst)) logg.push(`[${tid()}] Ada: ${utTekst.trim()}${avbrutt ? " (avbrutt)" : ""}`);
      utTekst = ""; avbrutt = false;
    };
    const dek = new TextDecoder();
    xai.addEventListener("message", async (m) => {
      let e;
      try { e = JSON.parse(typeof m.data === "string" ? m.data : dek.decode(m.data)); } catch { return; }
      if (e.setupComplete) {
        geminiKlar = true;
        tilXai(geminiStart(forsteReplikk(kunde)));
        while (ventende.length) sendInnLyd(ventende.shift());
        return;
      }
      const sc = e.serverContent;
      if (sc) {
        if (sc.inputTranscription && sc.inputTranscription.text) {
          innTekst += sc.inputTranscription.text;
          sisteAktivitet = Date.now();
          spurtOmTilstede = false;
        }
        if (sc.interrupted) {
          // Kunden begynte å snakke: stopp det som spilles. Gemini sender ikke mer av det avbrutte svaret.
          sisteAktivitet = Date.now();
          spurtOmTilstede = false;
          if (Date.now() < lydSlutt) avbrutt = true;
          stoppLyd();
          loggAda();
        }
        if (sc.modelTurn && sc.modelTurn.parts) {
          loggKunde();
          for (const p of sc.modelTurn.parts) {
            if (p.inlineData && p.inlineData.data) {
              const ut = pcm24kTilUlaw(p.inlineData.data, utSt);
              if (ut) sendLyd(ut);
            }
          }
        }
        if (sc.outputTranscription && sc.outputTranscription.text) utTekst += sc.outputTranscription.text;
        if (sc.turnComplete) { loggKunde(); loggAda(); }
        return;
      }
      if (e.toolCall && e.toolCall.functionCalls) {
        loggKunde();
        const svar = [];
        for (const f of e.toolCall.functionCalls) {
          const res = await kjorVerktoy(f.name, f.args || {});
          svar.push({ id: f.id, name: f.name, response: f.name === "legg_paa" ? { ok: true, info: "Samtalen avsluttes. Ikke si mer." } : res });
        }
        tilXai({ toolResponse: { functionResponses: svar } });
        return;
      }
      if (e.error) console.log("Gemini-feil", JSON.stringify(e).slice(0, 300));
    });
    xai.addEventListener("close", (c) => {
      if (c && c.code && c.code !== 1000) console.log("Gemini lukket", c.code, String(c.reason || "").slice(0, 200));
      clearInterval(stilleSjekk); try { tlfWs.close(1000, "gemini lukket"); } catch {}
    });
  }

  tlfWs.addEventListener("message", async (m) => {
    let e;
    try { e = JSON.parse(m.data); } catch { return; }
    if (e.event === "media") {
      if (e.media.track && e.media.track !== "inbound") return;
      if (motorKlar()) sendInnLyd(e.media.payload);
      else if (ventende.length < 250) ventende.push(e.media.payload);
      return;
    }
    if (e.event === "start") {
      erTelnyx = !!e.start.call_control_id;
      streamSid = e.start.streamSid || e.stream_id || null;
      callSid = e.start.callSid || e.start.call_control_id || null;
      if (tidligStart) {
        // Grok ble startet da strømmen koblet til. Sjekk at innringingen gjelder denne samtalen, og send lyden som venter.
        if (kunde.inn && urlParam.cid !== callSid) {
          console.log("Innringing: feil samtale-id");
          leggPaa(0);
          return;
        }
        tlfKlar = true;
        while (utKo.length) sendLyd(utKo.shift());
        return;
      }
      tlfKlar = true;
      const p = e.start.customParameters || {};
      const kjent = p.modus === "inn" ? null : await sjekkParam(p); // innringing går bare via Telnyx
      if (!kjent) { try { tlfWs.close(1008, "ugyldig"); } catch {} return; }
      kunde = kjent;
      setTimeout(() => leggPaa(0), MAKS_SEK * 1000);
      await startGrok();
      return;
    }
    if (e.event === "stop") {
      try { xai && xai.close(1000, "lagt på"); } catch {}
      await sendRapport();
    }
  });
  tlfWs.addEventListener("close", async () => {
    clearInterval(stilleSjekk);
    try { xai && xai.close(1000, "lagt på"); } catch {}
    await sendRapport();
  });

  // Sjekker de signerte parameterne. Gir kunde-objektet, eller null hvis noe er galt.
  async function sjekkParam(p) {
    if (p.modus === "inn") {
      const forventet = await hmac(env.TWILIO_AUTH_TOKEN, `inn|${p.cid}|${p.fra}|${p.ts}` + (p.kunde ? `|${p.kunde}` : ""));
      if (!likt(p.sig, forventet) || Date.now() - Number(p.ts) > 2 * 60 * 1000) { console.log("Ugyldig innringing-signatur"); return null; }
      return { til: p.fra || "ukjent", navn: "", firma: "", inn: true, linje: p.kunde || "" };
    }
    // Sjekk at samtalen faktisk ble startet av /ring (signert), ellers legg på.
    const forventet = await hmac(env.TWILIO_AUTH_TOKEN, `samtale|${p.til}|${p.ts}`);
    if (!likt(p.sig, forventet) || Date.now() - Number(p.ts) > 15 * 60 * 1000) { console.log("Ugyldig samtale-signatur"); return null; }
    return { til: p.til, navn: p.navn || "", firma: p.firma || "" };
  }

  // Telnyx legger parameterne i URL-en, så vi kan koble til Grok med en gang strømmen åpnes,
  // i stedet for å vente på «start». Det sparer rundt et halvt sekund før Ada sier hei.
  let tidligStart = false;
  if (urlParam && urlParam.sig) {
    const kjent = await sjekkParam(urlParam);
    if (!kjent) { try { tlfWs.close(1008, "ugyldig"); } catch {} return; }
    tidligStart = true;
    kunde = kjent;
    setTimeout(() => leggPaa(0), MAKS_SEK * 1000);
    await startGrok();
  }

  // Én e-post per samtale: sammendrag + hele samtalen som tekst.
  async function sendRapport() {
    if (rapportSendt || !kunde.til) return;
    rapportSendt = true;
    if (kunde.linje) {
      // Kundens egen linje: beskjeder og bookinger har allerede gått til firmaet. Her logges bare samtalen
      // (ukesrapport, kostnad og kvalitetssjekk i orvelo-sekretar). Nummeret til den som ringte tas ikke med.
      const utskrift = logg.map((l) => { const m = l.match(/^\[[^\]]*\] (Kunde|Ada): (.*)$/); return m ? [m[1] === "Kunde" ? "kunde" : "ai", m[2].replace(/\+?\d[\d ]{7,}/g, "[nummer]")] : null; }).filter(Boolean);
      await tilSekretar(env, "/telefon/slutt", { kunde: kunde.linje, start: new Date(startet).toISOString(), sek: Math.round((Date.now() - startet) / 1000),
        utskrift, bookinger: linjeData.bookinger, beskjeder: linjeData.beskjeder, verktoy: linjeData.verktoy })
        .catch((e) => console.log("telefon-slutt feilet", e && e.message));
      return;
    }
    const n = notat || {};
    await varsle(env, `${kunde.inn ? "Innringing" : "Orvelo-samtale"}: ${kunde.firma || kunde.til} (interesse: ${n.interesse || "ukjent"})`, {
      Retning: kunde.inn ? "Kunden ringte demonummeret" : "Agenten ringte kunden",
      Demo: demoHendelser.join("\n"),
      Nummer: kunde.til, Navn: kunde.navn || "", Firma: kunde.firma || "",
      Tidspunkt: new Date(startet).toISOString(),
      Varighet: tid(),
      Interesse: n.interesse || "", Bransje: n.bransje || "", "Ønsket tid": n.onsket_tid || "",
      Sammendrag: n.sammendrag || "Agenten skrev ikke sammendrag (kunden la kanskje på).",
      "Bookinglenke sendt": lenkeSendt ? "ja" : "nei",
      Samtale: logg.length ? logg.join("\n") : "(ingen tekst registrert)",
    });
    // Kostnad (Orvelos egne salgssamtaler) og sporbar logg til kvalitetssjekken på /drift i orvelo-sekretar.
    // Bare når KV-en KUNDER er koblet til. Nummeret lagres ikke i sporet.
    if (env.KUNDER) await lagreDrift(env, Math.round((Date.now() - startet) / 1000), logg, kunde.inn ? "ring-inn" : "ring-ut", n).catch((e) => console.log("drift feilet", e && e.message));
  }
}

// ---------- kostnad og spor (samme format som orvelo-sekretar, se /drift der) ----------
const SPOR_DAGER = 30, KOST_DAGER = 400;
const osloDato = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
async function lagreDrift(env, sek, logg, kanal, notat) {
  const id = "orvelo";
  const key = `kost:${id}:${osloDato(Date.now()).slice(0, 7)}`;
  const k = (await env.KUNDER.get(key, "json")) || {};
  k.talesek = (k.talesek || 0) + sek; k.taleokter = (k.taleokter || 0) + 1; k.sist = new Date().toISOString();
  await env.KUNDER.put(key, JSON.stringify(k), { expirationTtl: KOST_DAGER * 86400 });
  if (!logg.length) return;
  const meldinger = logg.map((l) => { const m = l.match(/^\[[^\]]*\] (Kunde|Ada): (.*)$/); return m ? [m[1] === "Kunde" ? "kunde" : "ai", m[2].replace(/\+?\d[\d ]{7,}/g, "[nummer]")] : ["info", l]; });
  const rec = { id, kanal, t: new Date(Date.now() - sek * 1000).toISOString(), prov: false, meldinger: meldinger.slice(-80), verktoy: [],
    flagg: notat && notat.sammendrag ? [] : ["Agenten skrev ikke sammendrag"], info: { sek, interesse: (notat && notat.interesse) || "" } };
  await env.KUNDER.put(`spor:${osloDato(Date.now())}:${id}:${Math.random().toString(36).slice(2, 10)}`, JSON.stringify(rec),
    { expirationTtl: SPOR_DAGER * 86400, metadata: { f: rec.flagg.length, k: kanal, p: 0 } });
}

// ---------- endepunkter ----------

async function kodeEndepunkt(request, env) {
  let b = {};
  try { b = await request.json(); } catch {}
  if (b.nettside) return json({ ok: true }); // felle for roboter
  const til = normaliserNummer(b.nummer);
  if (!til) return json({ feil: "Skriv inn et norsk mobilnummer (8 siffer)." }, 400);
  if (!b.samtykke) return json({ feil: "Du må krysse av for at vi får ringe deg." }, 400);
  const ip = request.headers.get("CF-Connecting-IP") || "ukjent";
  if (forMange("kode:" + ip, 5, 60 * 60 * 1000) || forMange("kode:" + til, 3, 60 * 60 * 1000)) {
    return json({ feil: "Mange forsøk. Prøv igjen senere." }, 429);
  }
  const test = env.TEST_NUMMER && normaliserNummer(env.TEST_NUMMER) === til;
  const kode = test ? "0000" : String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, "0");
  const ts = Date.now();
  const sig = await hmac(env.TWILIO_AUTH_TOKEN, `kode|${til}|${kode}|${ts}`);
  if (test) return json({ ok: true, billett: `${ts}.${sig}`, test: true });
  const r = await sendSms(env, til, `Din kode fra Orvelo: ${kode}`);
  if (!r.ok) return json({ feil: `Fikk ikke sendt SMS (${twilioFeil(r)}).` }, 502);
  return json({ ok: true, billett: `${ts}.${sig}` });
}

async function ringEndepunkt(request, env, url) {
  let b = {};
  try { b = await request.json(); } catch {}
  const til = normaliserNummer(b.nummer);
  if (!til || !b.samtykke) return json({ feil: "Mangler nummer eller samtykke." }, 400);
  if (forMange("ring:" + til, 4, 60 * 60 * 1000)) return json({ feil: "Mange forsøk. Prøv igjen senere." }, 429);
  const [tsTekst, sig] = String(b.billett || "").split(".");
  const ts = Number(tsTekst);
  const kode = String(b.kode || "").replace(/\D/g, "");
  if (!ts || Date.now() - ts > KODE_GYLDIG_MS) return json({ feil: "Koden har gått ut. Be om en ny." }, 400);
  if (!likt(sig, await hmac(env.TWILIO_AUTH_TOKEN, `kode|${til}|${kode}|${ts}`))) {
    return json({ feil: "Feil kode. Sjekk SMS-en og prøv igjen." }, 400);
  }

  const navn = String(b.navn || "").slice(0, 60).trim();
  const firma = String(b.firma || "").slice(0, 80).trim();
  const naa = String(Date.now());
  const samtaleSig = await hmac(env.TWILIO_AUTH_TOKEN, `samtale|${til}|${naa}`);
  const wss = `wss://${url.host}/media`;

  if (brukTelnyx(env)) {
    // Telnyx sender ikke egne parametere i stream-starten, så de ligger i URL-en (signert som før).
    const q = new URLSearchParams({ til, ts: naa, sig: samtaleSig, navn, firma });
    const r = await telnyx(env, "calls", {
      connection_id: env.TELNYX_CONNECTION_ID, to: til, from: env.TELNYX_FROM,
      stream_url: `${wss}?${q}`, stream_track: "inbound_track",
      stream_bidirectional_mode: "rtp", stream_bidirectional_codec: "PCMU",
      time_limit_secs: MAKS_SEK,
    });
    if (!r.ok) return json({ feil: `Fikk ikke ringt (${telnyxFeil(r)}).` }, 502);
  } else {
    const r = await ringTwilio(env, til, wss, naa, samtaleSig, navn, firma);
    if (!r.ok) return json({ feil: `Fikk ikke ringt (${twilioFeil(r)}).` }, 502);
  }

  // Samtykkelogg: Preben får en e-post per samtykke (tidspunkt, nummer, tekst de krysset av for).
  await varsle(env, `Samtykke: ${firma || til} ba om å bli ringt`, {
    Nummer: til, Navn: navn, Firma: firma, Tidspunkt: new Date().toISOString(),
    "Bekreftet med SMS-kode": "ja", Samtykketekst: SAMTYKKETEKST,
  });
  return json({ ok: true });
}

function ringTwilio(env, til, wss, naa, samtaleSig, navn, firma) {
  const twiml =
    `<Response><Connect><Stream url="${xmlEsc(wss)}">` +
    `<Parameter name="til" value="${xmlEsc(til)}"/><Parameter name="ts" value="${naa}"/>` +
    `<Parameter name="sig" value="${samtaleSig}"/><Parameter name="navn" value="${xmlEsc(navn)}"/>` +
    `<Parameter name="firma" value="${xmlEsc(firma)}"/></Stream></Connect></Response>`;

  return twilio(env, "Calls.json", { To: til, From: env.TWILIO_FROM, Twiml: twiml, TimeLimit: String(MAKS_SEK) });
}

// Telefonlinjen: linje:<+47nummer> i KV -> kunde-id (settes på /lag, del 4). "" = Orvelos eget demonummer.
export async function finnLinje(env, til) {
  if (!env.KUNDER) return "";
  let s = String(til || "").replace(/[\s().-]/g, "");
  if (s.startsWith("0047")) s = "+" + s.slice(2);
  if (/^\d{8}$/.test(s)) s = "+47" + s;
  if (!/^\+47\d{8}$/.test(s)) return "";
  const id = await env.KUNDER.get("linje:" + s).catch(() => null);
  return id && /^[a-z0-9-]{1,80}$/.test(id) ? id : "";
}

// Kall til orvelo-sekretar, signert med TWILIO_AUTH_TOKEN. Bruker service-bindingen SEKRETAR
// (workers.dev-adresser kan ikke alltid kalle hverandre direkte), ellers SEKRETAR_URL.
export async function tilSekretar(env, sti, data) {
  const body = JSON.stringify(data);
  const ts = String(Date.now());
  const init = { method: "POST", headers: { "Content-Type": "application/json", "X-Orvelo-Ts": ts, "X-Orvelo-Sig": await hmac(env.TWILIO_AUTH_TOKEN, `tlf|${ts}|${body}`) }, body };
  const base = (env.SEKRETAR_URL || "https://orvelo-sekretar.preben-m-hilleren.workers.dev").replace(/\/$/, "");
  const r = env.SEKRETAR ? await env.SEKRETAR.fetch(new Request(base + sti, init)) : await fetch(base + sti, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.feil || `HTTP ${r.status}`);
  return d;
}

// Svarer et innkommende anrop og kobler det til /media med signerte parametere.
async function svarInnringing(env, url, pl) {
  const cid = String(pl.call_control_id || "");
  if (!cid) return;
  const fra = String(pl.from || "").slice(0, 20);
  const id = `calls/${encodeURIComponent(cid)}/actions`;
  // Er nummeret som ble ringt en kundes telefonlinje? Da svarer Ada som kundens sekretær.
  const kunde = await finnLinje(env, pl.to);
  const grense = kunde ? forMange("inn:" + kunde, 120, 60 * 60 * 1000) : forMange("inn:alle", 60, 60 * 60 * 1000);
  if (forMange("inn:" + fra, 6, 60 * 60 * 1000) || grense) {
    await telnyx(env, `${id}/reject`, { cause: "USER_BUSY" });
    return;
  }
  const ts = String(Date.now());
  const sig = await hmac(env.TWILIO_AUTH_TOKEN, `inn|${cid}|${fra}|${ts}` + (kunde ? `|${kunde}` : ""));
  const q = new URLSearchParams({ modus: "inn", cid, fra, ts, sig, ...(kunde ? { kunde } : {}) });
  const r = await telnyx(env, `${id}/answer`, {
    stream_url: `wss://${url.host}/media?${q}`, stream_track: "inbound_track",
    stream_bidirectional_mode: "rtp", stream_bidirectional_codec: "PCMU",
  });
  if (!r.ok) console.log("Klarte ikke å svare innringing", telnyxFeil(r));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const mangler = ["XAI_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"].filter((k) => !env[k]);
    if (!brukTelnyx(env) && !env.TWILIO_FROM) mangler.push("TWILIO_FROM eller TELNYX_*");

    // Telnyx sender hendelser hit. Innkommende anrop besvares og kobles til Grok; resten svarer vi bare OK på.
    if (url.pathname === "/telnyx" && request.method === "POST") {
      let h = {};
      try { h = await request.json(); } catch {}
      const d = h.data || {};
      const pl = d.payload || {};
      if (d.event_type === "call.initiated" && pl.direction === "incoming" && brukTelnyx(env) && !mangler.length && env.INNRING !== "av") {
        await svarInnringing(env, url, pl);
      }
      return new Response("ok");
    }

    if (url.pathname === "/media") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Forventer WebSocket", { status: 426 });
      if (mangler.length) return new Response("Ikke satt opp", { status: 500 });
      const [klient, server] = Object.values(new WebSocketPair());
      server.accept();
      koblSamtale(env, server, Object.fromEntries(url.searchParams));
      return new Response(null, { status: 101, webSocket: klient });
    }

    if (request.method === "POST" && (url.pathname === "/kode" || url.pathname === "/ring")) {
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return json({ feil: "Ikke tillatt" }, 403);
      if (mangler.length) return json({ feil: "Tjenesten er ikke satt opp ennå." }, 500);
      return url.pathname === "/kode" ? kodeEndepunkt(request, env) : ringEndepunkt(request, env, url);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(side(url.searchParams.get("firma") || "", env.BOOKING_URL || BOOKING_URL_DEFAULT), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Robots-Tag": "noindex" },
      });
    }

    return new Response("Ikke funnet", { status: 404 });
  },
};

// ---------- «ring meg»-siden ----------

const SAMTYKKETEKST =
  "Jeg ber om at Orvelo ringer meg én gang på dette nummeret med en KI-assistent (automatisk stemme) " +
  "for å fortelle om KI-sekretær-tjenesten og avtale et møte.";

export function side(firma, bookingUrl) {
  const f = xmlEsc(firma.slice(0, 80));
  return `<!doctype html>
<html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hør KI-sekretæren · Orvelo</title>
<style>
:root{--bg:#f6f7fb;--kort:#fff;--tekst:#141826;--dempet:#5b6275;--aksent:#5b5bf0;--aksent2:#3d3dd0;--kant:#e3e6ef;--feil:#c62828;--ok:#1b7f4b}
@media (prefers-color-scheme:dark){:root{--bg:#0e1018;--kort:#171a26;--tekst:#eef0f7;--dempet:#a3a9bd;--aksent:#8a8aff;--aksent2:#a5a5ff;--kant:#2a2f42;--feil:#ff8a80;--ok:#6fdc9f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tekst);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:460px;margin:0 auto;padding:40px 16px}
.kort{background:var(--kort);border:1px solid var(--kant);border-radius:16px;padding:24px}
h1{font-size:1.6rem;line-height:1.25;margin:0 0 8px}p{margin:0 0 16px;color:var(--dempet)}
label{display:block;font-weight:600;margin:14px 0 6px}input[type=text],input[type=tel]{width:100%;padding:12px;border:1px solid var(--kant);border-radius:10px;background:transparent;color:inherit;font:inherit}
.sjekk{display:flex;gap:10px;align-items:flex-start;margin:16px 0;font-size:.9rem;color:var(--dempet)}.sjekk input{margin-top:4px;width:18px;height:18px;flex:none}
button{width:100%;padding:14px;border:0;border-radius:10px;background:var(--aksent);color:#fff;font:600 1rem inherit;cursor:pointer}button:hover{background:var(--aksent2)}button:disabled{opacity:.6;cursor:wait}
.melding{margin-top:12px;font-size:.95rem}.melding.feil{color:var(--feil)}.melding.ok{color:var(--ok)}
.skjult{display:none}.felle{position:absolute;left:-9999px}.liten{font-size:.85rem;margin-top:18px}.liten a{color:var(--aksent)}
</style></head><body><main><div class="kort">
<h1>Hør hvordan en KI-sekretær høres ut</h1>
<p>Legg inn mobilnummeret ditt, så ringer Ada, vår KI-assistent, deg om et øyeblikk. Hun forteller hvordan Orvelo kan svare telefonen for bedriften din, og kan avtale et kort møte med Preben.</p>
<form id="steg1">
<label for="navn">Navnet ditt</label><input id="navn" type="text" autocomplete="name" maxlength="60">
<label for="firma">Bedrift</label><input id="firma" type="text" value="${f}" maxlength="80">
<label for="nummer">Mobilnummer</label><input id="nummer" type="tel" inputmode="tel" autocomplete="tel" placeholder="912 34 567" required>
<input class="felle" id="nettside" tabindex="-1" autocomplete="off">
<div class="sjekk"><input id="samtykke" type="checkbox" required><label for="samtykke" style="margin:0;font-weight:400">${SAMTYKKETEKST}</label></div>
<button id="knapp1">Send meg en kode</button></form>
<form id="steg2" class="skjult">
<label for="kode">Koden du fikk på SMS</label><input id="kode" type="tel" inputmode="numeric" maxlength="4" autocomplete="one-time-code">
<button id="knapp2" style="margin-top:14px">Ring meg nå</button></form>
<div id="melding" class="melding" role="status"></div>
<p class="liten">Vil du heller booke et møte direkte? <a href="${xmlEsc(bookingUrl)}">Velg en tid her</a>.<br>Nummeret brukes bare til denne ene samtalen.</p>
</div></main>
<script>
const $=id=>document.getElementById(id);let billett="";
function vis(t,k){const m=$("melding");m.textContent=t;m.className="melding "+(k||"");}
function data(){return{navn:$("navn").value,firma:$("firma").value,nummer:$("nummer").value,samtykke:$("samtykke").checked,nettside:$("nettside").value};}
async function post(sti,body){const r=await fetch(sti,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.feil||"Noe gikk galt");return d;}
$("steg1").onsubmit=async e=>{e.preventDefault();$("knapp1").disabled=true;vis("Sender kode …");
 try{const d=await post("/kode",data());billett=d.billett||"";$("steg1").classList.add("skjult");$("steg2").classList.remove("skjult");$("kode").focus();vis(d.test?"Testmodus: koden er 0000.":"Vi har sendt deg en kode på SMS.","ok");}
 catch(err){vis(err.message,"feil");}finally{$("knapp1").disabled=false;}};
$("steg2").onsubmit=async e=>{e.preventDefault();$("knapp2").disabled=true;vis("Ringer deg …");
 try{await post("/ring",{...data(),kode:$("kode").value,billett});vis("Telefonen din ringer om noen sekunder. Ta den!","ok");}
 catch(err){vis(err.message,"feil");$("knapp2").disabled=false;}};
</script></body></html>`;
}
