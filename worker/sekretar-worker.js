// Orvelo KI-sekretær: Cloudflare Worker
//
// Gjør dette:
//   GET  /             -> viser demosiden (hentes fra GitHub-repoet, så siden kan oppdateres uten å røre denne koden)
//   POST /token        -> lager en kortvarig nøkkel (60 sek) slik at nettleseren kan snakke med Grok.
//                         Den ekte XAI_API_KEY forlater aldri denne tjenesten.
//   GET  /lag          -> Prebens side for å lage en egen sekretær til en bedrift (krever ADMIN_KODE)
//   POST /lag          -> leser bedriftens nettside, lar Grok lage en profil (tjenester, priser, åpningstider)
//                         og lagrer den. Svarer med en ferdig demolenke: /?kunde=<id>&k=<DEMO_KODE>
//   POST /lagre        -> lagrer en profil Preben har rettet på (krever ADMIN_KODE)
//   GET  /kunde?id=..  -> profilen demosiden bruker
//
// Innstillinger (Cloudflare: Worker -> Settings -> Variables and Secrets):
//   XAI_API_KEY  (Secret, påkrevd)  xAI-nøkkelen din
//   DEMO_KODE    (Secret, valgfri)  hvis satt, må lenken ha ?k=<koden>, ellers virker den ikke
//   ADMIN_KODE   (Secret, påkrevd for /lag) passordet bare Preben bruker for å lage nye sekretærer
//   PAGE_URL     (Text,   valgfri)  adressen til demosiden, standard er filen i GitHub
//   TEKST_MODELL (Text,   valgfri)  Grok-modell for å lese nettsider, standard grok-4-fast-non-reasoning
// Binding (Worker -> Settings -> Bindings -> KV namespace):
//   KUNDER       KV-lageret der profilene lagres

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
  async fetch(request, env) {
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
      if (env.DEMO_KODE && body.k !== env.DEMO_KODE) {
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
      if (env.DEMO_KODE && url.searchParams.get("k") !== env.DEMO_KODE) return json({ feil: "Feil kode" }, 401, origin);
      const id = (url.searchParams.get("id") || "").replace(/[^a-z0-9-]/g, "").slice(0, 60);
      if (!id || !env.KUNDER) return json({ feil: "Fant ikke sekretæren" }, 404, origin);
      const p = await env.KUNDER.get("kunde:" + id, "json");
      if (!p) return json({ feil: "Fant ikke sekretæren. Spør Preben om en ny lenke." }, 404, origin);
      return json(p, 200, origin);
    }

    if (url.pathname === "/lag" && request.method === "GET") {
      return new Response(ADMIN_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Robots-Tag": "noindex" } });
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
        const lenke = `${url.origin}/?kunde=${id}` + (env.DEMO_KODE ? `&k=${encodeURIComponent(env.DEMO_KODE)}` : "");
        return json({ id, lenke, profil }, 200);
      } catch (e) {
        console.log("lag feilet", e && e.stack);
        return json({ feil: e.message || "Noe gikk galt." }, 500);
      }
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
