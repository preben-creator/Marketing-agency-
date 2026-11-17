// Sjekker at nyhetssiden henger sammen: hvert innlegg er lenket fra oversikten, RSS og sitemap,
// og har tittel, beskrivelse, canonical og JSON-LD. Kjør: node tools/test-nyheter.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs";

const rot = new URL("../", import.meta.url).pathname;
const les = (f) => readFileSync(rot + f, "utf8");
let feil = 0;
const sjekk = (ok, tekst) => { if (!ok) { feil++; console.error("FEIL: " + tekst); } };

const mapper = readdirSync(rot + "nyheter", { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d{4}-uke-\d{2}$/.test(d.name)).map((d) => d.name);
sjekk(mapper.length > 0, "ingen innlegg i nyheter/");

const oversikt = les("nyheter/index.html");
const feed = les("nyheter/feed.xml");
const sitemap = les("sitemap.xml");
sjekk(oversikt.includes("<!-- NYE INNLEGG HER"), "markør mangler i nyheter/index.html");
sjekk(feed.includes("<!-- NYE INNLEGG HER"), "markør mangler i nyheter/feed.xml");
sjekk(sitemap.includes("<!-- NYE INNLEGG HER"), "markør mangler i sitemap.xml");
sjekk(sitemap.includes("https://orvelo.no/nyheter/</loc>"), "sitemap mangler /nyheter/");
sjekk((feed.match(/<item>/g) || []).length === (feed.match(/<\/item>/g) || []).length, "feed.xml har ubalanserte <item>");

for (const m of mapper) {
  const fil = `nyheter/${m}/index.html`;
  sjekk(existsSync(rot + fil), `${fil} finnes ikke`);
  if (!existsSync(rot + fil)) continue;
  const h = les(fil);
  const url = `https://orvelo.no/nyheter/${m}/`;
  sjekk(/<html lang="nb">/.test(h), `${m}: mangler lang="nb"`);
  sjekk(/<title>[^<]{20,}<\/title>/.test(h), `${m}: mangler <title>`);
  const d = (h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
  sjekk(d.length >= 80 && d.length <= 200, `${m}: meta description bør være 80–200 tegn (er ${d.length})`);
  sjekk(h.includes(`<link rel="canonical" href="${url}">`), `${m}: canonical må være ${url}`);
  sjekk(/<h1>[^<]+<\/h1>/.test(h), `${m}: mangler h1`);
  const ld = (h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1];
  try { const j = JSON.parse(ld); sjekk(j["@type"] === "NewsArticle" && j.mainEntityOfPage === url, `${m}: JSON-LD feil type/URL`); }
  catch { sjekk(false, `${m}: JSON-LD er ikke gyldig JSON`); }
  sjekk(h.includes('href="../nyheter.css"'), `${m}: bruker ikke nyheter.css`);
  sjekk(!/\bAI\b/.test(h.replace(/<[^>]+>/g, " ").replace(/\b(AI Act|OpenAI|xAI)\b/g, "")), `${m}: skriv «KI», ikke «AI»`);
  sjekk(oversikt.includes(`href="${m}/"`), `${m}: ikke lenket fra nyheter/index.html`);
  sjekk(feed.includes(`<link>${url}</link>`), `${m}: mangler i feed.xml`);
  sjekk(sitemap.includes(`<loc>${url}</loc>`), `${m}: mangler i sitemap.xml`);
}

if (feil) { console.error(`${feil} feil`); process.exit(1); }
console.log(`nyheter ok (${mapper.length} innlegg)`);
