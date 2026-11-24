// Test av «Lag min demo nå» (POST /prov) på orvelo.no. Nettside og Grok er ETTERLIGNET, ingen nøkler trengs.
//   node tools/test-prov.mjs
import worker from "../worker/sekretar-worker.js";

const lager = new Map();
const KV = {
  get: async (k, t) => (lager.has(k) ? (t === "json" ? JSON.parse(lager.get(k).v) : lager.get(k).v) : null),
  put: async (k, v, o = {}) => { lager.set(k, { v: String(v), ttl: o.expirationTtl }); },
  delete: async (k) => { lager.delete(k); },
  list: async ({ prefix = "" }) => ({ keys: [...lager.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
};
const env = { XAI_API_KEY: "x", KUNDER: KV, DEMO_KODE: "felles", PROV_PER_DAG: "3" };
let grok = 0, sisteGrok = "";
globalThis.fetch = async function (u) {
  const url = String(u);
  if (url.includes("bergror.no")) return new Response("<html><body><h1>Berg Rør AS</h1><p>Rørlegger i Bergen. Timepris 950 kr.</p></body></html>", { headers: { "content-type": "text/html" } });
  if (url.includes("dod.no")) return new Response("nei", { status: 500 });
  if (url.includes("data.brreg.no")) {
    if (url.includes("/enheter/912345678")) return Response.json({ organisasjonsnummer: "912345678", navn: "FJELL RØR AS", hjemmeside: "",
      epostadresse: "post@fjellror.no", mobil: "912 34 567", antallAnsatte: 4, naeringskode1: { beskrivelse: "Rørleggerarbeid" },
      forretningsadresse: { adresse: ["Fjellveien 12b"], postnummer: "5019", poststed: "BERGEN", kommune: "BERGEN" } });
    if (url.includes("/enheter/913000000")) return Response.json({ organisasjonsnummer: "913000000", navn: "INGENSIDE AS", hjemmeside: "", epostadresse: "ola@gmail.com",
      telefon: "55 00 00 00", naeringskode1: { beskrivelse: "Frisering" }, forretningsadresse: { adresse: ["Torget 1"], postnummer: "5014", poststed: "BERGEN", kommune: "BERGEN" } });
    if (url.includes("enheter?navn=")) return Response.json({ _embedded: { enheter: [{ organisasjonsnummer: "912345678", navn: "FJELL RØR AS", naeringskode1: { beskrivelse: "Rørleggerarbeid" }, forretningsadresse: { poststed: "BERGEN" } }] } });
    return new Response("{}", { status: 404 });
  }
  if (url.includes("fjellror.no")) return new Response("<html><body><h1>Fjell Rør</h1><p>Vi fikser lekkasjer.</p></body></html>", { headers: { "content-type": "text/html" } });
  if (url.includes("api.x.ai")) {
    grok++; sisteGrok = String(arguments[1] && arguments[1].body || "");
    const p = { navn: "Berg Rør AS", kortnavn: "Berg Rør", bransje: "rørleggerfirma", type: "befaring", tjenester: [], apent: {}, usikkert: [] };
    return Response.json({ choices: [{ message: { content: JSON.stringify(p) } }], usage: {} });
  }
  return new Response("ukjent " + url, { status: 404 });
};

let ok = 0, feil = 0;
const sjekk = (navn, b) => { if (b) ok++; else { feil++; console.log("FEIL:", navn); } };
const prov = (body, origin = "https://orvelo.no", ip = "1.1.1.1") => worker.fetch(new Request("https://x.workers.dev/prov", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": ip }, body: JSON.stringify(body) }), env, { waitUntil() {} });

let r = await prov({ nettside: "bergror.no", kontakt: "post@bergror.no" });
let d = await r.json();
sjekk("lager demo", r.status === 200 && d.ok && /kunde=p-berg-ror-/.test(d.lenke));
const id = new URL(d.lenke).searchParams.get("kunde");
sjekk("profil lagret med utløp", lager.get("kunde:" + id)?.ttl === 14 * 86400);
sjekk("demoutl satt", !!lager.get("demoutl:" + id));
sjekk("henvendelse lagret", [...lager.keys()].some((k) => k.startsWith("henvendelse:")));
sjekk("CORS for orvelo.no", r.headers.get("Access-Control-Allow-Origin") === "https://orvelo.no");

r = await prov({ nettside: "bergror.no", kontakt: "post@bergror.no" }, "https://ond.example"); sjekk("fremmed origin avvist", r.status === 403);
r = await prov({ nettside: "bergror.no", kontakt: "" }, undefined, "2.2.2.2"); sjekk("krever kontakt", r.status === 400);
r = await prov({ nettside: "127.0.0.1", kontakt: "99999999" }, undefined, "2.2.2.2"); sjekk("IP-adresse avvist", r.status === 400);
r = await prov({ nettside: "orvelo.no", kontakt: "99999999" }, undefined, "2.2.2.2"); sjekk("egen side avvist", r.status === 400);
r = await prov({ nettside: "dod.no", kontakt: "412 32 557" }, undefined, "3.3.3.3"); sjekk("uleselig side gir 422", r.status === 422);
r = await prov({ nettside: "bergror.no", kontakt: "post@a.no", _honey: "x" }, undefined, "4.4.4.4"); sjekk("honningfelle", r.status === 400);
// Søkefeltet: firma valgt fra Brønnøysund (org.nr)
const dagKey = [...lager.keys()].find((k) => k.startsWith("provdag:"));
lager.delete(dagKey);
r = await prov({ orgnr: "912345678", nettside: "", kontakt: "post@fjellror.no" }, undefined, "7.7.7.7"); d = await r.json();
const p2 = lager.get("kunde:" + new URL(d.lenke).searchParams.get("kunde"));
const prof = p2 && JSON.parse(p2.v);
sjekk("org.nr gir demo", r.status === 200 && d.ok);
sjekk("nettside fra e-postdomenet", prof && prof.nettside === "fjellror.no");
sjekk("adresse fra Brønnøysund", prof && /Fjellveien 12B, 5019 Bergen/.test(prof.adresse));
sjekk("telefon fra Brønnøysund", prof && prof.telefon === "912 34 567");
sjekk("Brreg-fakta sendt til KI-en", /Brønnøysundregistrene/.test(sisteGrok) && /Rørleggerarbeid/.test(sisteGrok));
lager.delete(dagKey);
r = await prov({ orgnr: "913000000", kontakt: "99999999" }, undefined, "8.8.8.8"); d = await r.json();
sjekk("uten nettside går det likevel", r.status === 200 && d.ok);
r = await prov({ kontakt: "99999999" }, undefined, "8.8.4.4"); sjekk("verken org.nr eller nettside gir 400", r.status === 400);
r = await worker.fetch(new Request("https://x.workers.dev/firmasok?q=fjell", { headers: { Origin: "https://orvelo.no" } }), env, { waitUntil() {} });
d = await r.json(); sjekk("firmasøk", d.treff && d.treff[0] && d.treff[0].orgnr === "912345678");
lager.set(dagKey, { v: "2" });
// Dagstaket (3) nås, og en IP stoppes etter 3 forsøk i timen
await prov({ nettside: "bergror.no", kontakt: "post@a.no" }, undefined, "5.5.5.5");
r = await prov({ nettside: "bergror.no", kontakt: "post@a.no" }, undefined, "6.6.6.6");
sjekk("dagstak nådd", r.status === 429);
for (let i = 0; i < 3; i++) await prov({ nettside: "bergror.no", kontakt: "post@a.no" }, undefined, "9.9.9.9");
lager.delete([...lager.keys()].find((k) => k.startsWith("provdag:")));
r = await prov({ nettside: "bergror.no", kontakt: "post@a.no" }, undefined, "9.9.9.9");
sjekk("IP-bremse etter 3", r.status === 429);
console.log(`${ok} OK, ${feil} feil, ${grok} Grok-kall`);
process.exit(feil ? 1 : 0);
