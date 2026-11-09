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
//   POST /logg          -> sekretærsiden sender et kort sammendrag når en samtale er ferdig (til ukesrapporten)
//   GET  /rapport       -> Prebens side: se, prøvesend og slå på ukesrapporten per kunde (krever ADMIN_KODE)
//   POST /rapport/api   -> data til /rapport
//   cron (mandag)       -> lager ukesrapporter; sender til kunder bare når RAPPORT_SEND = "ja"
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
  "https://orvelo.no",
  "https://www.orvelo.no",
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

    if (url.pathname === "/logg" || url.pathname === "/rapport" || url.pathname.startsWith("/rapport/")) {
      return rapportRute(request, env, ctx, url);
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

  // Cron Trigger (settes i Cloudflare): ukesrapport hver mandag morgen
  async scheduled(event, env, ctx) {
    ctx.waitUntil(ukesrapporter(env));
  },
};

// ======================================================================
// Lag en egen sekretær for en bedrift (brukes av /lag)
// ======================================================================

const UA = "Mozilla/5.0 (compatible; OrveloDemo/1.0; +https://orvelo.no/)";
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

// ======================================================================
// Ukesrapport til kundene (/logg, /rapport og cron hver mandag)
// ======================================================================
// Hver samtale med sekretæren lagres som et kort sammendrag i KV (logg:<id>:<tidspunkt>:<tilfeldig>).
// Vi lagrer IKKE lydopptak eller hele samtalen: bare tidspunkt, kanal, varighet, ett kort tema (laget av Grok,
// uten navn og nummer), hva som ble booket (fornavn + to siste sifre i mobilnummeret) og beskjeder.
// Alt slettes av seg selv etter 62 dager (expirationTtl), så vi har nok til månedens minutter og forrige uke.
//
// Innstillinger per kunde (KV rapport:<id>): { epost, pakke: "starter"|"pro"|"komplett", aktiv: true|false }
//   settes på /rapport (Prebens side, krever ADMIN_KODE).
// Utsending (Cloudflare -> Settings -> Variables and Secrets):
//   RESEND_API_KEY (Secret) nøkkel fra resend.com (gratis opptil 3000 e-poster i måneden). Uten den sendes ingenting til kunder.
//   RAPPORT_SEND   (Text)   må være «ja» før cron sender til kundene. Ellers får bare Preben en oversikt.
//   RAPPORT_FRA    (Text)   avsender, standard «Orvelo <rapport@orvelo.no>» (domenet må være bekreftet i Resend)
// Cron (Cloudflare -> Settings -> Triggers -> Cron Triggers): «0 6 * * 1» = hver mandag kl. 07 (vinter) / 08 (sommer).
//
// Andre kanaler (telefonlinje, chat, SMS, tilbakeringing) kan logge på samme måte med loggHendelse(env, id, {...}):
//   kanal: "tale" | "tekst" | "telefon" | "chat" | "sms" | "epost" | "facebook", sek, tema, kategori,
//   bookinger: [{hva, dato, kl, navn, mobil}], beskjeder: [{tekst, navn, mobil}], tapt: true, tilbakeringt: true

const LOGG_TTL = 62 * 24 * 3600;
const PAKKER = { starter: { navn: "Starter", min: 50 }, pro: { navn: "Pro", min: 200 }, komplett: { navn: "Komplett", min: 500 } };
const KATEGORIER = { booking: "Bestille time", flytte: "Flytte eller avbestille", pris: "Spørsmål om pris", apning: "Åpningstider og adresse", tjeneste: "Spørsmål om tjenester", akutt: "Akutt eller hastesak", klage: "Klage", annet: "Annet" };
const KANAL_NAVN = { tale: "Samtale", telefon: "Telefon", tekst: "Chat", chat: "Chat", sms: "SMS", epost: "E-post", facebook: "Facebook" };
const loggTreff = new Map();

const fornavn = (v) => tekst(String(v || "").split(/\s+/)[0], 30);
const maskerTlf = (v) => { const d = String(v || "").replace(/\D/g, ""); return d.length >= 4 ? "••• •• " + d.slice(-2) : ""; };

function rensLogg(r) {
  const kanal = Object.keys(KANAL_NAVN).includes(r.kanal) ? r.kanal : "tale";
  return {
    t: !isNaN(Date.parse(r.t)) ? new Date(r.t).toISOString() : new Date().toISOString(),
    kanal,
    sek: tall(r.sek, 4 * 3600),
    tema: tekst(r.tema, 160),
    kategori: KATEGORIER[r.kategori] ? r.kategori : "annet",
    bookinger: (Array.isArray(r.bookinger) ? r.bookinger : []).slice(0, 5).map((b) => ({
      hva: tekst(b.hva, 80), dato: datoStr(b.dato), kl: /^\d{2}:\d{2}$/.test(b.kl || "") ? b.kl : "",
      navn: fornavn(b.navn), tlf: b.tlf && b.tlf.startsWith("•") ? tekst(b.tlf, 20) : maskerTlf(b.mobil),
    })),
    beskjeder: (Array.isArray(r.beskjeder) ? r.beskjeder : []).slice(0, 5).map((b) => ({
      tekst: tekst(b.tekst, 200), navn: fornavn(b.navn), tlf: b.tlf && b.tlf.startsWith("•") ? tekst(b.tlf, 20) : maskerTlf(b.mobil),
    })),
    tapt: !!r.tapt,
    tilbakeringt: !!r.tilbakeringt,
  };
}

async function loggHendelse(env, id, r) {
  if (!env.KUNDER || !id) return;
  const rec = rensLogg(r);
  await env.KUNDER.put(`logg:${id}:${rec.t}:${tilfeldig(4)}`, JSON.stringify(rec), { expirationTtl: LOGG_TTL });
}

// Lager tema og kategori fra utskriften. Utskriften kastes etterpå.
async function oppsummer(env, profil, utskrift) {
  const forste = (utskrift.find((x) => x[0] === "kunde") || [])[1] || "";
  const reserve = { tema: tekst(forste.replace(/\+?\d[\d ]{6,}/g, "[nummer]"), 120), kategori: "annet" };
  if (!env.XAI_API_KEY || !utskrift.length) return reserve;
  try {
    const tekstUt = utskrift.map(([hvem, t]) => (hvem === "kunde" ? "Kunde: " : "Sekretær: ") + t).join("\n").slice(0, 6000);
    const svar = await grokJson(env,
      `Du lager et kort sammendrag av en samtale mellom en kunde og den digitale sekretæren til ${profil.navn || "en bedrift"}. ` +
      `Svar med JSON: {"tema": "hva kunden ville, maks 14 ord, enkel norsk, UTEN navn, telefonnummer, adresse eller helseopplysninger", ` +
      `"kategori": en av ${JSON.stringify(Object.keys(KATEGORIER))}}`,
      tekstUt);
    return { tema: tekst(svar.tema, 160) || reserve.tema, kategori: KATEGORIER[svar.kategori] ? svar.kategori : "annet" };
  } catch (e) {
    console.log("oppsummering feilet", e && e.message);
    return reserve;
  }
}

// --- Tid (rapporten følger norsk tid) ---
function osloOffsetMin(d) {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Oslo", timeZoneName: "shortOffset" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value || "GMT+1";
  const m = s.match(/GMT([+-]\d+)(?::(\d+))?/);
  return m ? Number(m[1]) * 60 + (m[2] ? Math.sign(Number(m[1])) * Number(m[2]) : 0) : 60;
}
// Mandag kl. 00:00 norsk tid i uka som inneholder d
function ukestart(d) {
  const lokal = new Date(d.getTime() + osloOffsetMin(d) * 60000);
  const dag = (lokal.getUTCDay() + 6) % 7;
  const m = Date.UTC(lokal.getUTCFullYear(), lokal.getUTCMonth(), lokal.getUTCDate() - dag);
  const guess = new Date(m - 60 * 60000);
  return new Date(m - osloOffsetMin(guess) * 60000);
}
function ukenr(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dag = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dag + 3);
  const forsteTorsdag = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - forsteTorsdag) / 86400000 - 3 + ((forsteTorsdag.getUTCDay() + 6) % 7)) / 7);
}
const oslo = (iso, o) => new Date(iso).toLocaleString("nb-NO", { timeZone: "Europe/Oslo", ...o });
const dagKl = (iso) => oslo(iso, { weekday: "short", day: "numeric", month: "short" }).replace(/\.$/, "") + " kl. " + oslo(iso, { hour: "2-digit", minute: "2-digit" });
const pentDato = (d) => oslo(d.toISOString(), { day: "numeric", month: "long" });

async function hentLogg(env, id, fra, til) {
  const ut = [];
  // Nøklene har tidspunktet i seg, så vi kan starte listen på riktig måned
  const prefikser = new Set([fra.toISOString().slice(0, 7), new Date(til.getTime() - 1).toISOString().slice(0, 7)]);
  for (const mnd of prefikser) {
    let cursor;
    do {
      const l = await env.KUNDER.list({ prefix: `logg:${id}:${mnd}`, cursor });
      for (const k of l.keys) {
        const t = k.name.split(":").slice(2, -1).join(":");
        if (t >= fra.toISOString() && t < til.toISOString()) ut.push(k.name);
      }
      cursor = l.list_complete ? null : l.cursor;
    } while (cursor);
  }
  const rec = await Promise.all(ut.map((k) => env.KUNDER.get(k, "json")));
  return rec.filter(Boolean).sort((a, b) => a.t.localeCompare(b.t));
}

function tellOpp(logg) {
  const s = { samtaler: 0, chat: 0, bookinger: 0, beskjeder: 0, tapt: 0, tilbakeringt: 0, sek: 0, kat: {} };
  for (const r of logg) {
    if (r.tapt) { s.tapt++; if (r.tilbakeringt) s.tilbakeringt++; continue; }
    if (["tale", "telefon"].includes(r.kanal)) { s.samtaler++; s.sek += r.sek; } else s.chat++;
    s.bookinger += r.bookinger.length;
    s.beskjeder += r.beskjeder.length;
    s.kat[r.kategori] = (s.kat[r.kategori] || 0) + 1;
  }
  return s;
}

// Bygger rapporten for én kunde og én uke. fra/til er Date. Returnerer { emne, html, tekst, tall }.
async function lagRapport(env, id, fra, til, eksempel) {
  const profil = (eksempel && eksempel.profil) || (await env.KUNDER.get("kunde:" + id, "json")) || {};
  const innst = (eksempel && eksempel.innst) || (await env.KUNDER.get("rapport:" + id, "json")) || {};
  const logg = eksempel ? eksempel.logg : await hentLogg(env, id, fra, til);
  const forrige = eksempel ? eksempel.forrige : await hentLogg(env, id, new Date(fra.getTime() - 7 * 86400000), fra);
  const mndStart = new Date(Date.UTC(til.getUTCFullYear(), til.getUTCMonth(), 1));
  const mndLogg = eksempel ? eksempel.mnd : await hentLogg(env, id, mndStart, til);
  const s = tellOpp(logg), f = tellOpp(forrige), m = tellOpp(mndLogg);
  const pakke = PAKKER[innst.pakke] || null;
  const mndMin = Math.round(m.sek / 60);
  const navn = profil.kortnavn || profil.navn || "bedriften";
  const uke = ukenr(new Date(fra.getTime() + 3 * 86400000));
  const periode = `${pentDato(fra)} til ${pentDato(new Date(til.getTime() - 1))}`;
  const hv = s.samtaler + s.chat;
  const emne = `Ukesrapport uke ${uke}: ${hv} ${hv === 1 ? "henvendelse" : "henvendelser"} og ${s.bookinger} ${s.bookinger === 1 ? "booking" : "bookinger"} hos ${navn}`;
  const diff = (a, b) => (a === b ? "som forrige uke" : a > b ? `${a - b} flere enn forrige uke` : `${b - a} færre enn forrige uke`);
  const e = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const C = { bg: "#eef6f1", kort: "#ffffff", ink: "#1c2b24", muted: "#56695f", linje: "#cfe2d6", gronn: "#1f7a5a", korall: "#c24f36", lys: "#e2efe7" };
  const boks = (tall, tekstUnder, sub) => `<td width="25%" valign="top" style="padding:6px"><div style="background:${C.lys};border-radius:14px;padding:14px 10px;text-align:center">
    <div style="font-size:28px;font-weight:700;color:${C.gronn};line-height:1.1">${tall}</div>
    <div style="font-size:13px;color:${C.ink};margin-top:4px">${tekstUnder}</div>${sub ? `<div style="font-size:11px;color:${C.muted};margin-top:2px">${sub}</div>` : ""}</div></td>`;
  const seksjon = (tittel, innhold) => `<tr><td style="padding:22px 24px 0"><div style="font-size:16px;font-weight:700;color:${C.ink};margin-bottom:8px">${tittel}</div>${innhold}</td></tr>`;

  const kat = Object.entries(s.kat).sort((a, b) => b[1] - a[1]);
  const maksKat = Math.max(1, ...kat.map((k) => k[1]));
  const katHtml = kat.length ? kat.map(([k, n]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0"><tr>
      <td width="42%" style="font-size:14px;color:${C.ink};padding-right:8px">${e(KATEGORIER[k])}</td>
      <td><div style="background:${C.gronn};height:10px;border-radius:5px;width:${Math.max(6, Math.round((n / maksKat) * 100))}%"></div></td>
      <td width="34" style="font-size:14px;color:${C.muted};text-align:right">${n}</td></tr></table>`).join("") : `<div style="color:${C.muted};font-size:14px">Ingen henvendelser denne uka.</div>`;

  const bookinger = logg.flatMap((r) => r.bookinger.map((b) => ({ ...b, kanal: r.kanal }))).sort((a, c) => (a.dato + a.kl).localeCompare(c.dato + c.kl));
  const bookHtml = bookinger.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:${C.ink}">` + bookinger.map((b) => `<tr>
      <td style="padding:6px 0;border-bottom:1px solid ${C.linje}"><b>${e(b.hva || "Time")}</b><br><span style="color:${C.muted}">${e(b.navn || "Kunde")} ${e(b.tlf)}</span></td>
      <td style="padding:6px 0;border-bottom:1px solid ${C.linje};text-align:right;white-space:nowrap">${b.dato ? e(oslo(b.dato + "T12:00:00Z", { weekday: "short", day: "numeric", month: "short" })) : ""}${b.kl ? " kl. " + e(b.kl) : ""}</td></tr>`).join("") + "</table>"
    : `<div style="color:${C.muted};font-size:14px">Ingen nye bookinger denne uka.</div>`;

  const beskjeder = logg.flatMap((r) => r.beskjeder.map((b) => ({ ...b, t: r.t })));
  const beskHtml = beskjeder.map((b) => `<div style="padding:8px 0;border-bottom:1px solid ${C.linje};font-size:14px;color:${C.ink}">
      <span style="color:${C.muted}">${e(dagKl(b.t))} · ${e(b.navn || "Ukjent")} ${e(b.tlf)}</span><br>«${e(b.tekst)}»</div>`).join("");

  const listeHtml = logg.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13.5px;color:${C.ink}">` + logg.map((r) => `<tr>
      <td style="padding:6px 8px 6px 0;border-bottom:1px solid ${C.linje};white-space:nowrap;color:${C.muted};vertical-align:top">${e(dagKl(r.t))}</td>
      <td style="padding:6px 0;border-bottom:1px solid ${C.linje};vertical-align:top">${r.tapt ? `<b style="color:${C.korall}">Tapt anrop</b>${r.tilbakeringt ? " · ringt tilbake" : ""}` : e(r.tema || "Samtale")}${r.bookinger.length ? ` <span style="color:${C.gronn};font-weight:700">· booket</span>` : ""}</td>
      <td style="padding:6px 0 6px 8px;border-bottom:1px solid ${C.linje};white-space:nowrap;text-align:right;color:${C.muted};vertical-align:top">${e(KANAL_NAVN[r.kanal])}${r.sek ? " · " + Math.max(1, Math.round(r.sek / 60)) + " min" : ""}</td></tr>`).join("") + "</table>" : "";

  const minHtml = pakke ? (() => {
    const pst = Math.min(100, Math.round((mndMin / pakke.min) * 100));
    const farge = pst >= 90 ? C.korall : C.gronn;
    return `<div style="font-size:14px;color:${C.ink}">${mndMin} av ${pakke.min} minutter brukt i ${oslo(til.toISOString(), { month: "long" })} (pakke ${pakke.navn}).</div>
      <div style="background:${C.lys};border-radius:6px;height:12px;margin-top:8px"><div style="background:${farge};height:12px;border-radius:6px;width:${Math.max(2, pst)}%"></div></div>
      ${pst >= 90 ? `<div style="font-size:13px;color:${C.korall};margin-top:6px">Dere nærmer dere grensen. Svar på denne e-posten hvis dere vil ha en større pakke.</div>` : ""}`;
  })() : `<div style="font-size:14px;color:${C.ink}">${mndMin} minutter med samtaler så langt i ${oslo(til.toISOString(), { month: "long" })}.</div>`;

  const html = `<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(emne)}</title></head>
<body style="margin:0;background:${C.bg};font-family:'Segoe UI',Helvetica,Arial,sans-serif">
${eksempel ? `<div style="background:${C.korall};color:#fff;text-align:center;font-size:13px;padding:8px">EKSEMPEL med oppdiktede tall. Ikke en ekte rapport.</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.kort};border-radius:22px;overflow:hidden;border:1px solid ${C.linje}">
<tr><td style="background:${C.gronn};padding:22px 24px;color:#fff">
  <div style="font-size:13px;opacity:.85;letter-spacing:.06em;text-transform:uppercase">Orvelo · ukesrapport uke ${uke}</div>
  <div style="font-size:23px;font-weight:700;margin-top:6px">Dette gjorde sekretæren for ${e(navn)}</div>
  <div style="font-size:14px;opacity:.9;margin-top:4px">${e(periode)}</div>
</td></tr>
<tr><td style="padding:16px 18px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  ${boks(s.samtaler, "samtaler", diff(s.samtaler, f.samtaler))}
  ${boks(s.bookinger, s.bookinger === 1 ? "booking" : "bookinger", diff(s.bookinger, f.bookinger))}
  ${boks(s.chat, "chat og meldinger", "")}
  ${boks(Math.round(s.sek / 60), "minutter", "denne uka")}
</tr></table></td></tr>
${s.tapt ? seksjon("Tapte anrop", `<div style="font-size:14px;color:${C.ink}">${s.tapt} anrop ble ikke besvart. Sekretæren tok kontakt med ${s.tilbakeringt} av dem etterpå.</div>`) : ""}
${seksjon("Hva kundene ville", katHtml)}
${seksjon("Nye bookinger", bookHtml)}
${beskjeder.length ? seksjon("Beskjeder til dere", beskHtml) : ""}
${seksjon("Minutter denne måneden", minHtml)}
${listeHtml ? seksjon("Alle henvendelser", listeHtml) : ""}
<tr><td style="padding:24px;font-size:12.5px;color:${C.muted};line-height:1.5">
  Telefonnumre vises bare med de to siste sifrene. Orvelo lagrer et kort sammendrag av hver samtale i 62 dager, ikke lydopptak.<br>
  Spørsmål eller ønsker om endringer? Svar på denne e-posten, så hører du fra Preben i Orvelo.
</td></tr>
</table></td></tr></table></body></html>`;

  const tekstUt = [
    `Ukesrapport uke ${uke} for ${navn} (${periode})`, "",
    `Samtaler: ${s.samtaler} (${diff(s.samtaler, f.samtaler)})`, `Bookinger: ${s.bookinger}`, `Chat og meldinger: ${s.chat}`,
    s.tapt ? `Tapte anrop: ${s.tapt}, ringt tilbake: ${s.tilbakeringt}` : null,
    pakke ? `Minutter i måneden: ${mndMin} av ${pakke.min} (${pakke.navn})` : `Minutter i måneden: ${mndMin}`, "",
    "Hva kundene ville:", ...kat.map(([k, n]) => `- ${KATEGORIER[k]}: ${n}`), "",
    "Nye bookinger:", ...(bookinger.length ? bookinger.map((b) => `- ${b.hva} ${b.dato} ${b.kl} (${b.navn} ${b.tlf})`) : ["- ingen"]),
    ...(beskjeder.length ? ["", "Beskjeder:", ...beskjeder.map((b) => `- ${b.navn || "Ukjent"} ${b.tlf}: ${b.tekst}`)] : []),
    "", "Svar på denne e-posten hvis du har spørsmål. Hilsen Preben, Orvelo",
  ].filter((x) => x !== null).join("\n");

  return { emne, html, tekst: tekstUt, tall: { ...s, minutter: Math.round(s.sek / 60), mndMin, pakke: pakke && pakke.navn } };
}

async function sendEpost(env, { til, emne, html, tekst: tekstUt, bcc }) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY er ikke satt i Cloudflare ennå.");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.RAPPORT_FRA || "Orvelo <rapport@orvelo.no>", to: [til], bcc: bcc ? [bcc] : undefined, reply_to: env.VARSEL_EPOST || "hilleren.bedrift@gmail.com", subject: emne, html, text: tekstUt }),
  });
  if (!r.ok) throw new Error("Resend svarte " + r.status + ": " + (await r.text()).slice(0, 200));
}

// Oppdiktet uke for å vise hvordan rapporten ser ut
function eksempelData(profil, fra) {
  const p = profil && profil.navn ? profil : { navn: "Eksempel Frisør", kortnavn: "Eksempel Frisør" };
  const t = (dag, kl) => new Date(fra.getTime() + dag * 86400000 + kl * 3600000).toISOString();
  const r = (o) => rensLogg({ bookinger: [], beskjeder: [], ...o });
  const logg = [
    r({ t: t(0, 8.2), kanal: "tale", sek: 154, tema: "Ville bestille klipp før helgen", kategori: "booking", bookinger: [{ hva: "Klipp 30 min", dato: new Date(fra.getTime() + 4 * 86400000).toISOString().slice(0, 10), kl: "14:00", navn: "Kari", mobil: "41234567" }] }),
    r({ t: t(0, 12.6), kanal: "tale", sek: 72, tema: "Spurte hva balayage koster på langt hår", kategori: "pris" }),
    r({ t: t(1, 7.4), kanal: "telefon", sek: 0, tapt: true, tilbakeringt: true, kategori: "annet" }),
    r({ t: t(1, 18.9), kanal: "tekst", sek: 0, tema: "Lurte på om dere har åpent mandag", kategori: "apning" }),
    r({ t: t(2, 9.1), kanal: "tale", sek: 201, tema: "Bestilte farge og klipp", kategori: "booking", bookinger: [{ hva: "Farge, ettervekst", dato: new Date(fra.getTime() + 8 * 86400000).toISOString().slice(0, 10), kl: "10:30", navn: "Nora", mobil: "98765412" }] }),
    r({ t: t(2, 21.3), kanal: "tale", sek: 95, tema: "Ville flytte timen sin til neste uke", kategori: "flytte", beskjeder: [{ tekst: "Vil flytte timen torsdag til uka etter, helst ettermiddag.", navn: "Lise", mobil: "92233445" }] }),
    r({ t: t(3, 10.2), kanal: "tale", sek: 133, tema: "Bestilte klipp til barn", kategori: "booking", bookinger: [{ hva: "Klipp barn", dato: new Date(fra.getTime() + 5 * 86400000).toISOString().slice(0, 10), kl: "11:00", navn: "Ahmed", mobil: "47011223" }] }),
    r({ t: t(4, 16.7), kanal: "tale", sek: 64, tema: "Spurte om pris på permanent", kategori: "pris" }),
    r({ t: t(4, 22.4), kanal: "chat", sek: 0, tema: "Ville bestille time lørdag formiddag", kategori: "booking", bookinger: [{ hva: "Vask og føhn", dato: new Date(fra.getTime() + 5 * 86400000).toISOString().slice(0, 10), kl: "10:00", navn: "Ida", mobil: "45566778" }] }),
    r({ t: t(5, 9.8), kanal: "telefon", sek: 0, tapt: true, tilbakeringt: true, kategori: "annet" }),
    r({ t: t(5, 13.5), kanal: "tale", sek: 112, tema: "Spurte om dere leier ut frisørstol", kategori: "tjeneste", beskjeder: [{ tekst: "Selvstendig frisør som vil leie stol fra januar. Ønsker å bli ringt.", navn: "Maria", mobil: "93344556" }] }),
  ];
  const forrige = logg.slice(0, 6);
  return { profil: p, innst: { pakke: "pro" }, logg, forrige, mnd: [...logg, ...forrige, ...logg] };
}

async function rapportRute(request, env, ctx, url) {
  const p = url.pathname;
  if (request.method === "GET" && (p === "/rapport" || p === "/rapport/")) {
    try { return new Response(await hentFraGitHub("snakk/rapport.html", env), { headers: HTML_HODER }); }
    catch (e) { return new Response(e.message, { status: 502 }); }
  }
  if (!env.KUNDER) return json({ feil: "KV-lageret KUNDER er ikke koblet til workeren." }, 500);
  const origin = request.headers.get("Origin");

  // Samtalelogg fra sekretærsiden (sendBeacon, text/plain)
  if (p === "/logg" && request.method === "POST") {
    if (origin && origin !== url.origin && !ALLOWED_ORIGINS.includes(origin)) return new Response(null, { status: 403 });
    let b = {};
    try { b = JSON.parse(await request.text()); } catch {}
    const id = rensId(b.kunde);
    if (!id || !(await kodeOk(env, b.k, id))) return new Response(null, { status: 401 });
    const ip = request.headers.get("CF-Connecting-IP") || "ukjent";
    const nu = Date.now();
    const liste = (loggTreff.get(ip) || []).filter((t) => nu - t < 3600000);
    if (liste.length >= 30) return new Response(null, { status: 429 });
    liste.push(nu); loggTreff.set(ip, liste); if (loggTreff.size > 5000) loggTreff.clear();
    const profil = await env.KUNDER.get("kunde:" + id, "json");
    if (!profil) return new Response(null, { status: 404 });
    const utskrift = (Array.isArray(b.utskrift) ? b.utskrift : []).slice(0, 80)
      .map((x) => [x && x[0] === "kunde" ? "kunde" : "ai", tekst(x && x[1], 600)]).filter((x) => x[1]);
    if (!utskrift.some((x) => x[0] === "kunde")) return new Response(null, { status: 204 });
    const jobb = (async () => {
      const sam = await oppsummer(env, profil, utskrift);
      await loggHendelse(env, id, { t: b.start, kanal: b.kanal === "tekst" ? "tekst" : "tale", sek: b.sek, ...sam, bookinger: b.bookinger, beskjeder: b.beskjeder });
    })().catch((e) => console.log("logg feilet", e && e.message));
    if (ctx && ctx.waitUntil) ctx.waitUntil(jobb); else await jobb;
    return new Response(null, { status: 204 });
  }

  if (p === "/rapport/api" && request.method === "POST") {
    if (origin && origin !== url.origin) return json({ feil: "Ikke tillatt" }, 403);
    let b = {};
    try { b = await request.json(); } catch {}
    if (!env.ADMIN_KODE || b.kode !== env.ADMIN_KODE) return json({ feil: "Feil admin-kode." }, 401);
    const id = rensId(b.kunde);
    const status = { resend: !!env.RESEND_API_KEY, automatisk: env.RAPPORT_SEND === "ja", fra: env.RAPPORT_FRA || "Orvelo <rapport@orvelo.no>", varsel: env.VARSEL_EPOST || "hilleren.bedrift@gmail.com" };
    try {
      if (b.handling === "kunder") {
        const ut = [];
        let cursor;
        do {
          const l = await env.KUNDER.list({ prefix: "kunde:", cursor });
          for (const k of l.keys) ut.push(k.name.slice(6));
          cursor = l.list_complete ? null : l.cursor;
        } while (cursor);
        const rader = await Promise.all(ut.map(async (kid) => {
          const [pr, inn] = await Promise.all([env.KUNDER.get("kunde:" + kid, "json"), env.KUNDER.get("rapport:" + kid, "json")]);
          return { id: kid, navn: (pr && pr.navn) || kid, rapport: inn || null };
        }));
        return json({ status, kunder: rader.sort((a, c) => a.navn.localeCompare(c.navn, "nb")) }, 200);
      }
      if (b.handling === "lagre") {
        if (!id || !(await env.KUNDER.get("kunde:" + id))) return json({ feil: "Fant ikke sekretæren." }, 404);
        const epost = tekst(b.epost, 120);
        if (epost && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(epost)) return json({ feil: "E-posten ser ikke riktig ut." }, 400);
        const inn = { epost, pakke: PAKKER[b.pakke] ? b.pakke : "", aktiv: !!b.aktiv && !!epost, oppdatert: new Date().toISOString() };
        await env.KUNDER.put("rapport:" + id, JSON.stringify(inn));
        return json({ ok: true, rapport: inn, status }, 200);
      }
      const denne = ukestart(new Date());
      const [fra, til] = b.periode === "denne" ? [denne, new Date()] : [new Date(denne.getTime() - 7 * 86400000), denne];
      if (b.handling === "eksempel") {
        const profil = id ? await env.KUNDER.get("kunde:" + id, "json") : null;
        const rap = await lagRapport(env, id, fra, til, eksempelData(profil, fra));
        return json({ ...rap, status }, 200);
      }
      if (!id) return json({ feil: "Velg en kunde." }, 400);
      if (b.handling === "vis") return json({ ...(await lagRapport(env, id, fra, til)), status }, 200);
      if (b.handling === "send_meg") {
        const rap = await lagRapport(env, id, fra, til);
        await sendEpost(env, { til: status.varsel, emne: "[Prøve] " + rap.emne, html: rap.html, tekst: rap.tekst });
        return json({ ok: true, sendtTil: status.varsel, status }, 200);
      }
      return json({ feil: "Ukjent handling." }, 400);
    } catch (e) {
      console.log("rapport feilet", e && e.stack);
      return json({ feil: e.message || "Noe gikk galt." }, 500);
    }
  }
  return new Response("Ikke funnet", { status: 404 });
}

// Cron hver mandag: lag rapport for forrige uke for alle kunder med rapport-innstillinger.
// Sender bare til kunden når RAPPORT_SEND = "ja", RESEND_API_KEY finnes og kunden står som aktiv.
// Preben får alltid en oversikt.
async function ukesrapporter(env) {
  if (!env.KUNDER) return;
  const denne = ukestart(new Date());
  const fra = new Date(denne.getTime() - 7 * 86400000);
  const uke = ukenr(new Date(fra.getTime() + 3 * 86400000));
  const linjer = [];
  let cursor;
  do {
    const l = await env.KUNDER.list({ prefix: "rapport:", cursor });
    for (const k of l.keys) {
      const id = k.name.slice(8);
      try {
        const inn = await env.KUNDER.get(k.name, "json");
        if (!inn) continue;
        const rap = await lagRapport(env, id, fra, denne);
        const t = rap.tall;
        const kort = `${t.samtaler} samtaler, ${t.chat} chat, ${t.bookinger} bookinger, ${t.beskjeder} beskjeder, ${t.mndMin} min denne måneden${t.pakke ? " (" + t.pakke + ")" : ""}`;
        const sendtNokkel = `rapportsendt:${id}:${fra.toISOString().slice(0, 10)}`;
        if (env.RAPPORT_SEND === "ja" && env.RESEND_API_KEY && inn.aktiv && inn.epost) {
          if (await env.KUNDER.get(sendtNokkel)) { linjer.push(`${id}: allerede sendt`); continue; }
          if (t.samtaler + t.chat === 0) { linjer.push(`${id}: ingen henvendelser, ikke sendt`); continue; }
          await sendEpost(env, { til: inn.epost, emne: rap.emne, html: rap.html, tekst: rap.tekst, bcc: env.VARSEL_EPOST || "hilleren.bedrift@gmail.com" });
          await env.KUNDER.put(sendtNokkel, new Date().toISOString(), { expirationTtl: 90 * 86400 });
          linjer.push(`${id}: SENDT til ${inn.epost}. ${kort}`);
        } else {
          linjer.push(`${id}: ikke sendt (${!inn.aktiv ? "ikke slått på for kunden" : !env.RESEND_API_KEY ? "mangler RESEND_API_KEY" : "RAPPORT_SEND er ikke «ja»"}). ${kort}`);
        }
      } catch (e) {
        linjer.push(`${id}: FEIL ${e.message}`);
      }
    }
    cursor = l.list_complete ? null : l.cursor;
  } while (cursor);
  if (linjer.length) await varsle(env, `Ukesrapporter uke ${uke}`, [...linjer, "", "Se og send rapportene på https://orvelo-sekretar.preben-m-hilleren.workers.dev/rapport"]);
}
