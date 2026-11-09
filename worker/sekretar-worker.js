// Orvelo KI-sekretær: Cloudflare Worker
//
// Gjør dette:
//   GET  /             -> viser demosiden (hentes fra GitHub-repoet, så siden kan oppdateres uten å røre denne koden)
//   POST /token        -> lager en kortvarig nøkkel (60 sek) slik at nettleseren kan snakke med Grok.
//                         Den ekte XAI_API_KEY forlater aldri denne tjenesten.
//   GET  /lag          -> Prebens side for å lage en egen sekretær til en bedrift (krever ADMIN_KODE)
//   POST /lag          -> leser bedriftens nettside, lar Grok lage en profil (tjenester, priser, åpningstider)
//                         og lagrer den. Svarer med en ferdig demolenke: /?kunde=<id>&k=<egen kode for firmaet>
//   POST /lagre        -> lagrer en profil Preben har rettet på (krever ADMIN_KODE)
//   GET  /kunde?id=..  -> profilen demosiden bruker
//   GET  /avtale/ny    -> Prebens side for å lage tilbud og avtale med signeringslenke (krever ADMIN_KODE)
//   POST /avtale/ny    -> lagrer tilbudet med en låst kopi av vilkårene (avtale/vilkar.html), svarer med lenke
//   POST /avtale/liste -> alle tilbud og om de er signert (krever ADMIN_KODE)
//   GET  /avtale?id=..&t=.. -> kundens side: les tilbudet, velg alternativ og signer
//   GET  /avtale/data  -> tilbudet som JSON (krever id + t)
//   POST /avtale/signer-> lagrer signaturen (navn, tid, IP, kontrollsum) og varsler Preben på e-post
//   GET  /rediger?kunde=..&r=.. -> kundens egen side for å rette tjenester, priser, varighet og åpningstider
//   GET  /rediger/data  -> profilen som kunden kan rette (krever kunde + r)
//   POST /rediger/lagre -> lagrer kundens endringer (tar vare på de 10 forrige versjonene) og varsler Preben
//   POST /rediger/lenke -> Prebens knapp: lager (eller henter) kundens rette-lenke (krever ADMIN_KODE)
//
// Innstillinger (Cloudflare: Worker -> Settings -> Variables and Secrets):
//   XAI_API_KEY  (Secret, påkrevd)  xAI-nøkkelen din
//   DEMO_KODE    (Secret, valgfri)  hvis satt, må lenken ha ?k=<kode>. Hvert firma får sin egen kode
//                                   (lagres i KV), så koden i lenken sier ikke noe om andre kunder.
//                                   DEMO_KODE selv virker fortsatt, slik at lenker som alt er sendt ikke slutter å virke.
//   ADMIN_KODE   (Secret, påkrevd for /lag) passordet bare Preben bruker for å lage nye sekretærer
//   PAGE_URL     (Text,   valgfri)  adressen til demosiden, standard er filen i GitHub
//   TEKST_MODELL (Text,   valgfri)  Grok-modell for å lese nettsider, standard grok-4-fast-non-reasoning
// Binding (Worker -> Settings -> Bindings -> KV namespace):
//   KUNDER       KV-lageret der profilene lagres

const LAG_URL_DEFAULT =
  "https://raw.githubusercontent.com/preben-creator/marketing-agency-/main/snakk/lag.html";
const GH_RAW = "https://raw.githubusercontent.com/preben-creator/marketing-agency-/main/";
const PAGE_URL_DEFAULT =
  "https://raw.githubusercontent.com/preben-creator/marketing-agency-/main/snakk/index.html";

// Enkel bremse per IP (per Cloudflare-instans): maks 8 samtaler per 30 minutter.
const WINDOW_MS = 30 * 60 * 1000;
const MAX_PER_WINDOW = 8;
const hits = new Map();

function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

const ALLOWED_ORIGINS = [
  "https://preben-creator.github.io",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
];

function json(body, status, origin) {
  const h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Vary"] = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers: h });
}


export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: ALLOWED_ORIGINS.includes(origin)
          ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST",
              "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" }
          : {},
      });
    }

    if (url.pathname === "/token") {
      if (request.method !== "POST") return json({ feil: "Bruk POST" }, 405, origin);
      // Bare fra demosiden selv eller GitHub Pages
      const sameOrigin = origin === url.origin;
      if (origin && !sameOrigin && !ALLOWED_ORIGINS.includes(origin)) {
        return json({ feil: "Ikke tillatt" }, 403, origin);
      }
      if (!env.XAI_API_KEY) return json({ feil: "Demoen er ikke satt opp ennå (mangler nøkkel)." }, 500, origin);

      let body = {};
      try { body = await request.json(); } catch {}
      if (!(await kodeOk(env, body.k, body.kunde))) {
        return json({ feil: "Lenken mangler riktig kode. Spør Preben om en ny lenke." }, 401, origin);
      }

      const ip = request.headers.get("CF-Connecting-IP") || "ukjent";
      if (tooMany(ip)) return json({ feil: "Mange samtaler på kort tid. Prøv igjen om litt." }, 429, origin);

      const r = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.XAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expires_after: { seconds: 60 } }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.log("xAI svarte", r.status, t.slice(0, 300));
        return json({ feil: "Sekretæren er ikke tilgjengelig akkurat nå. Prøv igjen senere." }, 502, origin);
      }
      const d = await r.json();
      return json({ value: d.value, expires_at: d.expires_at }, 200, origin);
    }

    if (url.pathname === "/kunde") {
      const id = (url.searchParams.get("id") || "").replace(/[^a-z0-9-]/g, "").slice(0, 60);
      if (!(await kodeOk(env, url.searchParams.get("k"), id))) return json({ feil: "Feil kode" }, 401, origin);
      if (!id || !env.KUNDER) return json({ feil: "Fant ikke sekretæren" }, 404, origin);
      const p = await env.KUNDER.get("kunde:" + id, "json");
      if (!p) return json({ feil: "Fant ikke sekretæren. Spør Preben om en ny lenke." }, 404, origin);
      return json(p, 200, origin);
    }

    if (url.pathname === "/lag" && request.method === "GET") {
      // Siden hentes fra GitHub (snakk/lag.html), så den kan endres uten å røre Cloudflare. ADMIN_HTML er reserve.
      const lagSide = await fetch(env.LAG_URL || LAG_URL_DEFAULT, { cf: { cacheTtl: 60 } }).catch(() => null);
      return new Response(lagSide && lagSide.ok ? await lagSide.text() : ADMIN_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Robots-Tag": "noindex" } });
    }

    if ((url.pathname === "/lag" || url.pathname === "/lagre") && request.method === "POST") {
      if (origin && origin !== url.origin) return json({ feil: "Ikke tillatt" }, 403, origin);
      let body = {};
      try { body = await request.json(); } catch {}
      if (!env.ADMIN_KODE || body.kode !== env.ADMIN_KODE) return json({ feil: "Feil admin-kode." }, 401);
      if (!env.KUNDER) return json({ feil: "KV-lageret KUNDER er ikke koblet til workeren ennå." }, 500);
      try {
        let id, profil;
        if (url.pathname === "/lag") {
          if (!env.XAI_API_KEY) return json({ feil: "Mangler XAI_API_KEY." }, 500);
          profil = await lagSekretaer(body, env);
          const base = (profil.kortnavn || profil.navn || "firma").toLowerCase()
            .replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "firma";
          id = base + "-" + Math.random().toString(36).slice(2, 6);
        } else {
          id = String(body.id || "").replace(/[^a-z0-9-]/g, "").slice(0, 60);
          if (!id) return json({ feil: "Mangler id." }, 400);
          profil = normaliser(body.profil || {});
        }
        profil.id = id;
        profil.oppdatert = new Date().toISOString();
        await env.KUNDER.put("kunde:" + id, JSON.stringify(profil));
        const lenke = await demoLenke(url, env, id);
        return json({ id, lenke, profil }, 200);
      } catch (e) {
        console.log("lag feilet", e && e.stack);
        return json({ feil: e.message || "Noe gikk galt." }, 500);
      }
    }

    if (url.pathname === "/rediger" || url.pathname.startsWith("/rediger/")) {
      return redigerRute(request, env, ctx, url);
    }

    if (url.pathname === "/avtale" || url.pathname.startsWith("/avtale/")) {
      return avtaleRute(request, env, ctx, url);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const r = await fetch(env.PAGE_URL || PAGE_URL_DEFAULT, { cf: { cacheTtl: 60 } });
      if (!r.ok) return new Response("Fant ikke demosiden.", { status: 502 });
      return new Response(await r.text(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
          "X-Robots-Tag": "noindex",
          "Permissions-Policy": "microphone=(self)",
        },
      });
    }

    return new Response("Ikke funnet", { status: 404 });
  },
};

// ======================================================================
// Lag en egen sekretær for en bedrift (brukes av /lag)
// ======================================================================

const UA = "Mozilla/5.0 (compatible; OrveloDemo/1.0; +https://preben-creator.github.io/Marketing-agency-/)";
const NYTTIGE_SIDER = /pris|tjenest|behandling|kontakt|om-oss|om_oss|\/om\b|apning|åpning|service|produkt|meny|booking|bestill|fagomr|tilbud/i;

function htmlTilTekst(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/td|\/th)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&aring;/g, "å").replace(/&oslash;/g, "ø")
    .replace(/&aelig;/g, "æ").replace(/&Aring;/g, "Å").replace(/&Oslash;/g, "Ø").replace(/&AElig;/g, "Æ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

async function hentSide(u) {
  const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", cf: { cacheTtl: 300 } });
  if (!r.ok) throw new Error(`${u} svarte ${r.status}`);
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("html")) throw new Error(`${u} er ikke en nettside`);
  const html = (await r.text()).slice(0, 800000);
  return { url: r.url || u, html };
}

// Henter forsiden og opptil 5 undersider som ser nyttige ut (priser, tjenester, kontakt, om oss)
async function lesNettsted(nettside) {
  let start = nettside.trim();
  if (!/^https?:\/\//i.test(start)) start = "https://" + start;
  const forside = await hentSide(start);
  const host = new URL(forside.url).host;
  const lenker = new Set();
  for (const m of forside.html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], forside.url);
      if (u.host === host && NYTTIGE_SIDER.test(u.pathname + " " + m[0]) && u.href !== forside.url) lenker.add(u.href.split("#")[0]);
    } catch {}
  }
  const undersider = [...lenker].slice(0, 5);
  const resultat = await Promise.allSettled(undersider.map(hentSide));
  const deler = [`=== ${forside.url}\n${htmlTilTekst(forside.html).slice(0, 12000)}`];
  for (const r of resultat) if (r.status === "fulfilled") deler.push(`=== ${r.value.url}\n${htmlTilTekst(r.value.html).slice(0, 9000)}`);
  return { tekst: deler.join("\n\n").slice(0, 40000), sider: [forside.url, ...resultat.filter((r) => r.status === "fulfilled").map((r) => r.value.url)] };
}

const SKJEMA = `{
  "navn": "Fullt firmanavn, f.eks. Berg Rør AS",
  "kortnavn": "Kort navn folk bruker, f.eks. Berg Rør",
  "bransje": "Hva slags bedrift, med små bokstaver, f.eks. rørleggerfirma, frisørsalong, elektrikerfirma",
  "type": "time (kunden bestiller en time på stedet, f.eks. frisør, bilverksted, hudpleie) eller befaring (firmaet kommer hjem til kunden, f.eks. rørlegger, elektriker, snekker, maler)",
  "sted": "Hvordan sekretæren omtaler bedriften i tredje person: 'salongen', 'verkstedet' eller 'firmaet'",
  "adresse": "Gateadresse, postnummer og sted, eller tom tekst",
  "omraade": "Område de dekker, f.eks. 'Bergen og omegn', eller tom tekst",
  "telefon": "Telefonnummer eller tom tekst",
  "epost": "E-post eller tom tekst",
  "apent": {"0": null, "1": ["07:00","16:00"], "2": ["07:00","16:00"], "3": ["07:00","16:00"], "4": ["07:00","16:00"], "5": ["07:00","16:00"], "6": null},
  "apentTekst": "Åpningstidene i en kort setning slik de skal sies i telefonen",
  "ansatte": ["Fornavn på ansatte som nevnes på nettsiden, maks 6, ellers tom liste"],
  "tjenester": [["Kategori", [["Tjeneste", "pris som tekst, f.eks. 'fra 1 200 kr' eller 'pris etter befaring'", 60]]]],
  "ekstra": "2-4 setninger med annet en sekretær bør vite: spesialiteter, merker de jobber med, garanti, døgnvakt, hva de IKKE gjør",
  "stikkord": ["Navn og fagord som er vanskelige å høre riktig, maks 15"],
  "usikkert": ["Ting du ikke fant og måtte anta, så Preben kan sjekke dem"]
}`;

async function grokJson(env, system, bruker) {
  const kall = (model) => fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.XAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0.2, response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: bruker }] }),
  });
  let model = env.TEKST_MODELL || "grok-4-fast-non-reasoning";
  let r = await kall(model);
  if (!r.ok && (r.status === 400 || r.status === 404)) {
    const t = await r.text();
    if (/model/i.test(t)) {
      // Modellnavnet finnes ikke lenger: velg en tekstmodell fra listen
      const m = await fetch("https://api.x.ai/v1/models", { headers: { Authorization: `Bearer ${env.XAI_API_KEY}` } });
      const ids = m.ok ? ((await m.json()).data || []).map((x) => x.id) : [];
      const tekst = ids.filter((id) => /grok/i.test(id) && !/image|vision|voice|imagine|video|tts/i.test(id));
      model = tekst.find((id) => /fast/i.test(id)) || tekst[0];
      if (!model) throw new Error("Fant ingen Grok-tekstmodell: " + t.slice(0, 200));
      r = await kall(model);
    } else throw new Error("Grok svarte " + r.status + ": " + t.slice(0, 200));
  }
  if (!r.ok) throw new Error("Grok svarte " + r.status + ": " + (await r.text()).slice(0, 200));
  const d = await r.json();
  const innhold = d.choices?.[0]?.message?.content || "";
  const json = innhold.slice(innhold.indexOf("{"), innhold.lastIndexOf("}") + 1);
  return JSON.parse(json);
}

const tekst = (v, n = 300) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const KL = /^\d{1,2}:\d{2}$/;
const kl = (t) => { const [h, m] = t.split(":"); return h.padStart(2, "0") + ":" + m; };

// Rydder og begrenser en profil, så demosiden alltid får noe den kan bruke
function normaliser(p) {
  const type = p.type === "time" ? "time" : "befaring";
  const apent = {};
  for (let d = 0; d < 7; d++) {
    const v = p.apent ? p.apent[d] ?? p.apent[String(d)] : undefined;
    if (Array.isArray(v) && v.length === 2 && KL.test(v[0]) && KL.test(v[1]) && kl(v[0]) < kl(v[1])) apent[d] = [kl(v[0]), kl(v[1])];
    else if (v === "avtale") apent[d] = "avtale";
    else if (v === undefined && d >= 1 && d <= 5 && !p.apent) apent[d] = ["07:00", "16:00"];
    else apent[d] = null;
  }
  if (!Object.values(apent).some(Array.isArray)) for (let d = 1; d <= 5; d++) apent[d] = ["07:00", "16:00"];
  const tjenester = (Array.isArray(p.tjenester) ? p.tjenester : []).slice(0, 10).map((k) => [
    tekst(k?.[0], 60) || "Tjenester",
    (Array.isArray(k?.[1]) ? k[1] : []).slice(0, 14).map((t) => [
      tekst(t?.[0], 80), tekst(t?.[1], 60) || (type === "befaring" ? "pris etter befaring" : "spør om pris"),
      Math.min(480, Math.max(15, Math.round((Number(t?.[2]) || (type === "befaring" ? 60 : 30)) / 15) * 15)),
    ]).filter((t) => t[0]),
  ]).filter((k) => k[1].length);
  const navn = tekst(p.navn, 80) || "Firmaet";
  return {
    navn,
    kortnavn: tekst(p.kortnavn, 40) || navn.replace(/\s+(AS|ASA|ENK|DA|ANS)$/i, ""),
    bransje: tekst(p.bransje, 60) || "håndverkerfirma",
    type,
    sted: tekst(p.sted, 30) || (type === "time" ? "salongen" : "firmaet"),
    kontaktperson: tekst(p.kontaktperson, 40),
    adresse: tekst(p.adresse, 120),
    omraade: tekst(p.omraade, 120),
    telefon: tekst(p.telefon, 30),
    epost: tekst(p.epost, 80),
    nettside: tekst(p.nettside, 200),
    apent,
    apentTekst: tekst(p.apentTekst, 300) || "Hverdager fra sju til fire.",
    ansatte: (Array.isArray(p.ansatte) ? p.ansatte : []).map((x) => tekst(x, 30)).filter(Boolean).slice(0, 6),
    tjenester: tjenester.length ? tjenester : [["Tjenester", [["Befaring og tilbud", "gratis befaring", 60]]]],
    ekstra: tekst(p.ekstra, 1200),
    mote: tekst(p.mote, 200),
    stikkord: (Array.isArray(p.stikkord) ? p.stikkord : []).map((x) => tekst(x, 40)).filter(Boolean).slice(0, 20),
    usikkert: (Array.isArray(p.usikkert) ? p.usikkert : []).map((x) => tekst(x, 160)).filter(Boolean).slice(0, 10),
    kilder: (Array.isArray(p.kilder) ? p.kilder : []).map((x) => tekst(x, 200)).filter(Boolean).slice(0, 8),
  };
}

async function lagSekretaer(inn, env) {
  const firma = tekst(inn.firma, 80);
  const nettside = tekst(inn.nettside, 200);
  const bransje = tekst(inn.bransje, 60);
  if (!firma && !nettside) throw new Error("Skriv inn firmanavn eller nettside.");
  let side = { tekst: "", sider: [] };
  let sideFeil = "";
  if (nettside) {
    try { side = await lesNettsted(nettside); } catch (e) { sideFeil = e.message; }
  }
  const system = `Du lager en profil for en digital telefonsekretær til en norsk bedrift. Profilen brukes i en demo som bedriften selv skal prøve.
Svar KUN med ett JSON-objekt med nøyaktig disse feltene:
${SKJEMA}
Regler:
- Bruk bare fakta som står i teksten fra nettsiden eller i opplysningene fra Preben. Finn aldri på priser, navn, adresser eller telefonnummer.
- Står det ingen pris, skriv "pris etter befaring" (befaring) eller "spør om pris" (time).
- Varighet er minutter: omtrentlig tid for en time på stedet, eller 60 for en befaring.
- Står det ikke åpningstider, bruk vanlige tider for bransjen og skriv det i "usikkert".
- apent bruker 0 = søndag til 6 = lørdag, null = stengt, "avtale" = bare etter avtale.
- Skriv på norsk bokmål.`;
  const bruker = `Firma: ${firma || "(se nettsiden)"}
Bransje/fag: ${bransje || "(se nettsiden)"}
Kontaktperson: ${tekst(inn.kontaktperson, 40) || "(ukjent)"}
Nettside: ${nettside || "(ingen)"}
${sideFeil ? "Klarte ikke å lese nettsiden: " + sideFeil + "\n" : ""}
Tekst fra nettsiden:
${side.tekst || "(ingen tekst, lag en nøktern profil ut fra firmanavn og bransje, og list alt du har antatt i 'usikkert')"}`;
  const p = await grokJson(env, system, bruker);
  if (firma) p.navn = p.navn || firma;
  p.kontaktperson = tekst(inn.kontaktperson, 40) || p.kontaktperson;
  p.nettside = nettside;
  p.kilder = side.sider;
  if (sideFeil) p.usikkert = [...(p.usikkert || []), "Nettsiden kunne ikke leses (" + sideFeil + "), så alt er antatt."];
  return normaliser(p);
}

const ADMIN_HTML = `<!doctype html>
<html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lag KI-sekretær · Orvelo</title><meta name="robots" content="noindex">
<style>
:root{--bg:#0f0e17;--card:#1a1928;--ink:#eeedf7;--muted:#a3a0bd;--line:#2e2c44;--acc:#8f78ff;--acc2:#2fd0ee;--ok:#5fd59a;--warn:#ffb547;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 "Segoe UI",system-ui,sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:28px 16px 60px}
h1{font-size:28px;margin:0 0 4px}h1 span{background:linear-gradient(90deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text;color:transparent}
p.lead{color:var(--muted);margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px}
label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
input,textarea{font:inherit;text-transform:none;letter-spacing:0;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:9px 11px;width:100%}
textarea{font-family:Consolas,ui-monospace,monospace;font-size:12.5px;min-height:340px}
.g{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:620px){.g{grid-template-columns:1fr}}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px}
button,a.btn{font:inherit;font-weight:600;border-radius:9px;padding:9px 14px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;text-decoration:none}
.p{background:var(--acc);border-color:var(--acc);color:#0f0e17}
button:disabled{opacity:.5;cursor:wait}
.msg{margin-top:10px;font-size:14px}.err{color:var(--warn)}.ok{color:var(--ok)}
.link{font-family:Consolas,monospace;font-size:13px;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:9px 11px;word-break:break-all}
ul{margin:6px 0 0;padding-left:20px;color:var(--warn)}
</style></head><body><div class="wrap">
<h1>Lag en <span>egen KI-sekretær</span></h1>
<p class="lead">Skriv inn firmaet og nettsiden. Grok leser nettsiden og lager en sekretær med firmaets tjenester, priser og åpningstider. Du får en lenke kunden kan ringe til i nettleseren.</p>
<form class="card" id="f">
  <div class="g">
    <label>Firma<input id="firma" required placeholder="Berg Rør AS"></label>
    <label>Nettside<input id="nettside" placeholder="bergror.no"></label>
    <label>Fag / bransje<input id="bransje" placeholder="Rørlegger"></label>
    <label>Kontaktperson<input id="kontaktperson" placeholder="Fornavn (valgfritt)"></label>
    <label>Admin-kode<input id="kode" type="password" required autocomplete="current-password"></label>
  </div>
  <div class="row"><button class="p" id="lagBtn">Lag sekretær</button><span class="msg" id="msg"></span></div>
</form>
<div class="card" id="res" hidden>
  <label>Demolenke til kunden</label>
  <div class="link" id="lenke"></div>
  <div class="row"><a class="btn p" id="apne" target="_blank" rel="noopener">Åpne og test</a><button type="button" id="kopier">Kopier lenke</button></div>
  <div id="usikker"></div>
  <p class="lead" style="margin:16px 0 6px">Sjekk og rett opplysningene under før du sender lenken. Trykk «Lagre endringer» etterpå. Lenken er den samme.</p>
  <textarea id="json" spellcheck="false"></textarea>
  <div class="row"><button type="button" id="lagre">Lagre endringer</button><span class="msg" id="msg2"></span></div>
</div>
<script>
const $=id=>document.getElementById(id);let id="";
const q=new URLSearchParams(location.search);["firma","nettside","bransje","kontaktperson"].forEach(k=>{if(q.get(k))$(k).value=q.get(k);});
try{$("kode").value=localStorage.getItem("orvelo-admin")||"";}catch{}
function vis(d){id=d.id;$("res").hidden=false;$("lenke").textContent=d.lenke;$("apne").href=d.lenke;
  const {usikkert,...rest}=d.profil;$("json").value=JSON.stringify(d.profil,null,2);
  $("usikker").innerHTML=(usikkert&&usikkert.length)?'<p class="msg err" style="margin-bottom:0">Sjekk dette:</p><ul>'+usikkert.map(x=>"<li>"+x.replace(/[<>&]/g,"")+"</li>").join("")+"</ul>":'<p class="msg ok">Grok fant det meste på nettsiden.</p>';}
async function post(path,body){const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({feil:"Uventet svar ("+r.status+")"}));if(!r.ok)throw new Error(d.feil||r.status);return d;}
$("f").addEventListener("submit",async e=>{e.preventDefault();const b=$("lagBtn");b.disabled=true;$("msg").className="msg";$("msg").textContent="Leser nettsiden og lager sekretæren (10–40 sek) …";
  try{try{localStorage.setItem("orvelo-admin",$("kode").value);}catch{}
    const d=await post("/lag",{kode:$("kode").value,firma:$("firma").value,nettside:$("nettside").value,bransje:$("bransje").value,kontaktperson:$("kontaktperson").value});
    vis(d);$("msg").className="msg ok";$("msg").textContent="Ferdig!";}
  catch(err){$("msg").className="msg err";$("msg").textContent=err.message;}finally{b.disabled=false;}});
$("lagre").addEventListener("click",async()=>{let p;try{p=JSON.parse($("json").value);}catch{ $("msg2").className="msg err";$("msg2").textContent="Teksten er ikke gyldig JSON. Sjekk komma og anførselstegn.";return;}
  try{const d=await post("/lagre",{kode:$("kode").value,id,profil:p});vis(d);$("msg2").className="msg ok";$("msg2").textContent="Lagret.";}catch(err){$("msg2").className="msg err";$("msg2").textContent=err.message;}});
$("kopier").addEventListener("click",()=>{navigator.clipboard.writeText($("lenke").textContent).then(()=>{$("kopier").textContent="Kopiert!";setTimeout(()=>$("kopier").textContent="Kopier lenke",1800);});});
</script></div></body></html>`;

// ======================================================================
// Tilbud og avtale med digital signering (/avtale)
// ======================================================================
// Lagres i samme KV-lager (KUNDER) under nøkkelen avtale:<id>. Ingen nye innstillinger trengs.
// Valgfritt: VARSEL_EPOST (Text) = e-posten som får beskjed når noe er signert (standard hilleren.bedrift@gmail.com).

const HTML_HODER = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Robots-Tag": "noindex" };

async function hentFraGitHub(fil, env) {
  const r = await fetch((env.GH_RAW || GH_RAW) + fil, { cf: { cacheTtl: 60 } }).catch(() => null);
  if (!r || !r.ok) throw new Error("Fant ikke " + fil + " på GitHub.");
  return r.text();
}

async function sha256(tekst) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const tilfeldig = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => "abcdefghijkmnpqrstuvwxyz23456789"[x % 32]).join("");
const tall = (v, maks = 10000000) => Math.max(0, Math.min(maks, Math.round(Number(v) || 0)));
const datoStr = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? v : "");

function rensAvtale(a) {
  const k = a.kunde || {}, l = a.leverandor || {}, p = a.pris || {};
  return {
    tittel: tekst(a.tittel, 120) || "Tilbud og avtale: KI-sekretær",
    dato: datoStr(a.dato) || new Date().toISOString().slice(0, 10),
    gyldigTil: datoStr(a.gyldigTil),
    bindingMnd: tall(a.bindingMnd, 60) || 12,
    kunde: { firma: tekst(k.firma, 120), orgnr: tekst(k.orgnr, 20), adresse: tekst(k.adresse, 160), kontaktperson: tekst(k.kontaktperson, 100), epost: tekst(k.epost, 120), telefon: tekst(k.telefon, 30) },
    leverandor: { navn: tekst(l.navn, 120), orgnr: tekst(l.orgnr, 20), adresse: tekst(l.adresse, 160), epost: tekst(l.epost, 120), telefon: tekst(l.telefon, 30), signatar: tekst(l.signatar, 100) },
    innledning: tekst(a.innledning, 2000),
    tjenester: (Array.isArray(a.tjenester) ? a.tjenester : []).slice(0, 20).map((t) => ({ t: tekst(t && t.t, 80), b: tekst(t && t.b, 600) })).filter((t) => t.b),
    pris: {
      oppstart: tall(p.oppstart),
      alternativer: (Array.isArray(p.alternativer) ? p.alternativer : []).slice(0, 3).map((x, i) => ({
        kode: tekst(x.kode, 3) || "ABC"[i], navn: tekst(x.navn, 60), mnd: tall(x.mnd), prosent: Math.min(100, Math.max(0, Number(x.prosent) || 0)), passer: tekst(x.passer, 160),
      })),
    },
    regneeksempel: tekst(a.regneeksempel, 600),
    merknad: tekst(a.merknad, 400),
  };
}

function utenHemmelig(rec) {
  const { token, ...rest } = rec;
  return rest;
}

async function varsle(env, emne, linjer) {
  const til = env.VARSEL_EPOST || "hilleren.bedrift@gmail.com";
  try {
    await fetch("https://formsubmit.co/ajax/" + encodeURIComponent(til), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Referer: "https://orvelo-sekretar.workers.dev/avtale", Origin: "https://orvelo-sekretar.workers.dev" },
      body: JSON.stringify({ _subject: emne, _template: "box", _captcha: "false", melding: linjer.join("\n") }),
    });
  } catch (e) { console.log("varsel feilet", e && e.message); }
}

async function avtaleRute(request, env, ctx, url) {
  const p = url.pathname;
  const get = request.method === "GET";

  if (get && (p === "/avtale" || p === "/avtale/")) {
    try { return new Response(await hentFraGitHub("avtale/index.html", env), { headers: HTML_HODER }); }
    catch (e) { return new Response(e.message, { status: 502 }); }
  }
  if (get && p === "/avtale/ny") {
    try { return new Response(await hentFraGitHub("avtale/ny.html", env), { headers: HTML_HODER }); }
    catch (e) { return new Response(e.message, { status: 502 }); }
  }
  if (get && p === "/avtale/vilkar") {
    try { return new Response(await hentFraGitHub("avtale/vilkar.html", env), { headers: HTML_HODER }); }
    catch (e) { return new Response(e.message, { status: 502 }); }
  }

  if (!env.KUNDER) return json({ feil: "KV-lageret KUNDER er ikke koblet til workeren." }, 500);

  if (get && p === "/avtale/data") {
    const id = (url.searchParams.get("id") || "").replace(/[^a-z0-9-]/g, "").slice(0, 60);
    const rec = id && (await env.KUNDER.get("avtale:" + id, "json"));
    if (!rec || rec.token !== url.searchParams.get("t")) return json({ feil: "Fant ikke tilbudet. Sjekk at du har hele lenken." }, 404);
    return json(utenHemmelig(rec), 200);
  }

  if (request.method !== "POST") return new Response("Ikke funnet", { status: 404 });
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ feil: "Ikke tillatt" }, 403);
  let body = {};
  try { body = await request.json(); } catch {}

  if (p === "/avtale/ny" || p === "/avtale/liste") {
    if (!env.ADMIN_KODE || body.kode !== env.ADMIN_KODE) return json({ feil: "Feil admin-kode." }, 401);

    if (p === "/avtale/liste") {
      const ut = [];
      let cursor;
      do {
        const l = await env.KUNDER.list({ prefix: "avtale:", cursor });
        for (const k of l.keys) ut.push({ id: k.name.slice(7), ...(k.metadata || {}) });
        cursor = l.list_complete ? null : l.cursor;
      } while (cursor);
      ut.sort((a, b) => String(b.opprettet || "").localeCompare(String(a.opprettet || "")));
      return json({ avtaler: ut }, 200);
    }

    const a = rensAvtale(body.avtale || {});
    if (!a.kunde.firma) return json({ feil: "Skriv inn firmanavnet til kunden." }, 400);
    if (!a.pris.alternativer.length) return json({ feil: "Velg minst ett prisalternativ." }, 400);
    let vilkar;
    try { vilkar = (await hentFraGitHub("avtale/vilkar.html", env)).replace(/<!--[\s\S]*?-->/g, "").trim(); }
    catch (e) { return json({ feil: "Fant ikke vilkårene (avtale/vilkar.html) på GitHub." }, 502); }
    const versjon = (vilkar.match(/data-versjon="([^"]+)"/) || [])[1] || "";

    const aar = new Date().getFullYear();
    const teller = tall(await env.KUNDER.get("teller:avtale:" + aar)) + 1;
    await env.KUNDER.put("teller:avtale:" + aar, String(teller));
    const nr = `${aar}-${String(teller).padStart(3, "0")}`;
    const base = a.kunde.firma.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "kunde";
    const id = `${nr}-${base}`;
    const token = tilfeldig(12);
    const opprettet = new Date().toISOString();
    const rec = { id, nr, token, opprettet, ...a, vilkar, vilkarVersjon: versjon, signatur: null };
    const lenke = `${url.origin}/avtale?id=${id}&t=${token}`;
    await env.KUNDER.put("avtale:" + id, JSON.stringify(rec), { metadata: { nr, firma: a.kunde.firma, opprettet, lenke, signert: null } });
    return json({ id, nr, lenke }, 200);
  }

  if (p === "/avtale/signer") {
    const id = String(body.id || "").replace(/[^a-z0-9-]/g, "").slice(0, 60);
    const rec = id && (await env.KUNDER.get("avtale:" + id, "json"));
    if (!rec || rec.token !== body.t) return json({ feil: "Fant ikke tilbudet." }, 404);
    if (rec.signatur) return json(utenHemmelig(rec), 200);
    if (rec.gyldigTil && new Date(rec.gyldigTil + "T23:59:59+01:00") < new Date()) return json({ feil: "Tilbudet har gått ut. Ta kontakt med Orvelo for et nytt." }, 410);
    if (!body.godtar || !body.fullmakt) return json({ feil: "Du må krysse av for at du godtar vilkårene og har rett til å signere." }, 400);
    const navn = tekst(body.navn, 100), rolle = tekst(body.rolle, 80), firma = tekst(body.firma, 120), epost = tekst(body.epost, 120);
    const orgnr = tekst(body.orgnr, 20).replace(/\s/g, "");
    if (navn.length < 3 || !rolle || !firma) return json({ feil: "Fyll inn navn, rolle og firmanavn." }, 400);
    if (!/^\d{9}$/.test(orgnr)) return json({ feil: "Org.nr. må ha 9 siffer." }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(epost)) return json({ feil: "Skriv inn en gyldig e-post." }, 400);
    const alt = rec.pris.alternativer;
    const valgt = alt.length === 1 ? alt[0].kode : tekst(body.valgt, 3);
    if (!alt.some((x) => x.kode === valgt)) return json({ feil: "Velg et prisalternativ." }, 400);
    let tegning = typeof body.tegning === "string" ? body.tegning : "";
    if (tegning && (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(tegning) || tegning.length > 200000)) tegning = "";

    const tid = new Date().toISOString();
    const orgnrFin = orgnr.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
    const { token, signatur, ...dokument } = rec;
    const hash = await sha256(JSON.stringify({ dokument, valgt, kunde: { firma, orgnr: orgnrFin, epost }, navn, tid }));
    rec.signatur = {
      navn, rolle, firma, orgnr: orgnrFin, epost, valgt, tid, hash, tegning,
      ip: request.headers.get("CF-Connecting-IP") || "", ua: tekst(request.headers.get("User-Agent") || "", 300),
    };
    await env.KUNDER.put("avtale:" + id, JSON.stringify(rec), {
      metadata: { nr: rec.nr, firma, opprettet: rec.opprettet, lenke: `${url.origin}/avtale?id=${id}&t=${rec.token}`, signert: tid, valgt },
    });
    const v = alt.find((x) => x.kode === valgt);
    const varsel = varsle(env, `Signert: tilbud ${rec.nr} fra ${firma}`, [
      `${navn} (${rolle}) har signert tilbud ${rec.nr} for ${firma}, org.nr. ${orgnrFin}.`,
      `Valgt: alternativ ${valgt} (${v.navn}), ${v.mnd} kr/mnd${v.prosent ? ` + ${v.prosent} % av bookinger` : ""}.${rec.pris.oppstart ? ` Oppstart ${rec.pris.oppstart} kr.` : ""}`,
      `E-post: ${epost}`,
      `Signert kopi: ${url.origin}/avtale?id=${id}&t=${rec.token}`,
    ]);
    if (ctx && ctx.waitUntil) ctx.waitUntil(varsel); else await varsel;
    return json(utenHemmelig(rec), 200);
  }

  return new Response("Ikke funnet", { status: 404 });
}

// ======================================================================
// Kunden retter sin egen sekretær (/rediger)
// ======================================================================
// Kunden får en egen lenke /rediger?kunde=<id>&r=<rettekode>. Rettekoden ligger i KV under rediger:<id>,
// og er en annen enn DEMO_KODE, så bare den som har fått rette-lenken kan endre profilen.
// Kunden kan endre tjenester, priser, varighet, åpningstider, ansatte, kontaktinfo og «dette bør sekretæren vite».
// Navn, bransje og type kan bare Preben endre (på /lag).

const KUNDE_KAN_ENDRE = ["tjenester", "apent", "apentTekst", "ansatte", "ekstra", "telefon", "epost", "adresse", "omraade"];
const redigerTreff = new Map();

const rensId = (v) => String(v || "").replace(/[^a-z0-9-]/g, "").slice(0, 60);

// Hvert firma har sin egen demokode, så lenken ikke viser koden (og navnet) til en annen kunde.
// KV: "demokode:<id>" -> kode, og "dkode:<kode>" -> id (slik at /token kan sjekke koden uten id).
async function firmaKode(env, id) {
  if (!env.KUNDER) return null;
  let kode = await env.KUNDER.get("demokode:" + id);
  if (!kode) {
    kode = tilfeldig(10);
    await env.KUNDER.put("dkode:" + kode, id);
    await env.KUNDER.put("demokode:" + id, kode);
  }
  return kode;
}

async function demoLenke(url, env, id) {
  if (!env.DEMO_KODE) return `${url.origin}/?kunde=${id}`;
  const kode = (await firmaKode(env, id)) || env.DEMO_KODE;
  return `${url.origin}/?kunde=${id}&k=${encodeURIComponent(kode)}`;
}

// Godtar den gamle felles DEMO_KODE (lenker som alt er sendt) eller firmaets egen kode.
// Er id oppgitt, må firmakoden høre til akkurat det firmaet.
async function kodeOk(env, k, id) {
  if (!env.DEMO_KODE) return true;
  if (!k) return false;
  if (k === env.DEMO_KODE) return true;
  if (!env.KUNDER || !/^[a-z0-9]{6,40}$/i.test(k)) return false;
  const eier = await env.KUNDER.get("dkode:" + k);
  return !!eier && (!id || eier === id);
}

function hvaErEndret(gml, ny) {
  const ut = [];
  const tj = (p) => new Map(p.tjenester.flatMap(([kat, l]) => l.map(([n, pris, min]) => [kat + " / " + n, pris + " · " + min + " min"])));
  const a = tj(gml), b = tj(ny);
  for (const [k, v] of b) if (!a.has(k)) ut.push("Ny: " + k + " (" + v + ")"); else if (a.get(k) !== v) ut.push("Endret: " + k + ": " + a.get(k) + " → " + v);
  for (const k of a.keys()) if (!b.has(k)) ut.push("Fjernet: " + k);
  if (JSON.stringify(gml.apent) !== JSON.stringify(ny.apent) || gml.apentTekst !== ny.apentTekst) ut.push("Åpningstider: " + ny.apentTekst);
  for (const f of ["ansatte", "ekstra", "telefon", "epost", "adresse", "omraade"]) {
    if (JSON.stringify(gml[f]) !== JSON.stringify(ny[f])) ut.push(f[0].toUpperCase() + f.slice(1) + ": " + (Array.isArray(ny[f]) ? ny[f].join(", ") : ny[f] || "(tomt)"));
  }
  return ut;
}

async function redigerRute(request, env, ctx, url) {
  const p = url.pathname;
  const get = request.method === "GET";

  if (get && (p === "/rediger" || p === "/rediger/")) {
    try { return new Response(await hentFraGitHub("snakk/rediger.html", env), { headers: HTML_HODER }); }
    catch (e) { return new Response(e.message, { status: 502 }); }
  }
  if (!env.KUNDER) return json({ feil: "KV-lageret KUNDER er ikke koblet til workeren." }, 500);

  const sjekk = async (id, r) => {
    if (!id || !r) return null;
    const kode = await env.KUNDER.get("rediger:" + id);
    if (!kode || kode !== r) return null;
    return env.KUNDER.get("kunde:" + id, "json");
  };

  if (get && p === "/rediger/data") {
    const id = rensId(url.searchParams.get("kunde"));
    const profil = await sjekk(id, url.searchParams.get("r"));
    if (!profil) return json({ feil: "Fant ikke sekretæren. Sjekk at du har hele lenken, eller spør Preben om en ny." }, 404);
    const { usikkert, kilder, ...rest } = profil;
    return json({ profil: rest, demo: await demoLenke(url, env, id) }, 200);
  }

  if (request.method !== "POST") return new Response("Ikke funnet", { status: 404 });
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ feil: "Ikke tillatt" }, 403);
  let body = {};
  try { body = await request.json(); } catch {}

  if (p === "/rediger/lenke") {
    if (!env.ADMIN_KODE || body.kode !== env.ADMIN_KODE) return json({ feil: "Feil admin-kode." }, 401);
    const id = rensId(body.id);
    const profil = id && (await env.KUNDER.get("kunde:" + id, "json"));
    if (!profil) return json({ feil: "Fant ingen sekretær med id «" + id + "»." }, 404);
    let kode = await env.KUNDER.get("rediger:" + id);
    if (!kode || body.ny) { kode = tilfeldig(10); await env.KUNDER.put("rediger:" + id, kode); }
    return json({ id, profil, lenke: await demoLenke(url, env, id), rediger: `${url.origin}/rediger?kunde=${id}&r=${kode}` }, 200);
  }

  if (p === "/rediger/lagre") {
    const ip = request.headers.get("CF-Connecting-IP") || "ukjent";
    const nu = Date.now();
    const liste = (redigerTreff.get(ip) || []).filter((t) => nu - t < 10 * 60 * 1000);
    if (liste.length >= 30) return json({ feil: "Mange lagringer på kort tid. Vent litt og prøv igjen." }, 429);
    liste.push(nu); redigerTreff.set(ip, liste); if (redigerTreff.size > 5000) redigerTreff.clear();

    const id = rensId(body.kunde);
    const gml = await sjekk(id, body.r);
    if (!gml) return json({ feil: "Fant ikke sekretæren. Sjekk at du har hele lenken." }, 404);
    const inn = body.profil || {};
    const flettet = { ...gml };
    for (const f of KUNDE_KAN_ENDRE) if (f in inn) flettet[f] = inn[f];
    const ny = normaliser(flettet);
    ny.id = id;
    ny.oppdatert = new Date().toISOString();
    ny.endretAvKunde = ny.oppdatert;
    const endringer = hvaErEndret(normaliser(gml), ny);
    if (!endringer.length) return json({ profil: ny, endringer }, 200);

    const hist = (await env.KUNDER.get("historikk:" + id, "json")) || [];
    hist.unshift({ tid: gml.oppdatert || "", profil: gml });
    await env.KUNDER.put("historikk:" + id, JSON.stringify(hist.slice(0, 10)));
    await env.KUNDER.put("kunde:" + id, JSON.stringify(ny));

    const varsel = varsle(env, `${ny.kortnavn || ny.navn} har rettet KI-sekretæren sin`, [
      `${ny.navn} har endret sekretæren sin (${id}):`, "",
      ...endringer.slice(0, 40).map((x) => "- " + x), "",
      `Test den: ${await demoLenke(url, env, id)}`,
      "Forrige versjon er lagret og kan hentes tilbake.",
    ]);
    if (ctx && ctx.waitUntil) ctx.waitUntil(varsel); else await varsel;
    const { usikkert, kilder, ...rest } = ny;
    return json({ profil: rest, endringer }, 200);
  }

  return new Response("Ikke funnet", { status: 404 });
}
