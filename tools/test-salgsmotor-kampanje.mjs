// Test av rørlegger-kampanjen (22.11.2026): 90 e-poster om dagen, hver dag, bare rørlegger-AS med lovlig adresse.
// Starter på pause, sender tre prøver til Preben, demo fra e-postdomenet, æøå-adresser stopper ikke køen.
// Enhetsregisteret, nettsider, Grok og Resend er ETTERLIGNET.  node tools/test-salgsmotor-kampanje.mjs
import worker from "../worker/sekretar-worker.js";

const lager = new Map();
const KV = {
  get: async (k, t) => (lager.has(k) ? (t === "json" ? JSON.parse(lager.get(k).v) : lager.get(k).v) : null),
  put: async (k, v, o = {}) => { lager.set(k, { v: String(v), metadata: o.metadata, ttl: o.expirationTtl }); },
  delete: async (k) => { lager.delete(k); },
  list: async ({ prefix = "" }) => ({ keys: [...lager.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: lager.get(name).metadata })), list_complete: true }),
};
const env = { XAI_API_KEY: "x", ADMIN_KODE: "admin", KUNDER: KV, DEMO_KODE: "felles", RESEND_API_KEY: "re_test" };
// En gammel innstilling fra før kampanjen (30 per dag, alle bransjer, i gang)
lager.set("salgcfg", { v: JSON.stringify({ pause: false, perDag: 30, peker: { b: 3, side: 2 } }) });

const enhet = (nr, navn, epost, kode, hjemmeside = "") => ({ organisasjonsnummer: String(nr), navn, epostadresse: epost, organisasjonsform: { kode: "AS" },
  antallAnsatte: 5, hjemmeside, forretningsadresse: { poststed: "OSLO", kommune: "OSLO" }, stiftelsesdato: "2015-01-01", naeringskode1: { kode } });
const ROR = [
  ...Array.from({ length: 120 }, (_, i) => enhet(910000000 + i, `Rør ${i} AS`, i === 7 ? "postmaster@ror7.no" : `post@ror${i}.no`, "43.220")),
  enhet(910000500, "Rørfirma Ø AS", "post@rørø.no", "43.220"),
  enhet(910000501, "Ola Rør AS", "ola@olaror.no", "43.220"),
];
const FRISOR = [enhet(920000000, "Frisør X AS", "post@frisorx.no", "96.210")];
const eposter = [], brreg = [], sider = [];
globalThis.fetch = async (u, o = {}) => {
  const url = String(u);
  if (url.includes("data.brreg.no")) {
    brreg.push(url);
    const liste = url.includes("43.22") ? ROR : FRISOR;
    const side = Number(new URL(url).searchParams.get("page")) || 0;
    return Response.json({ _embedded: { enheter: liste.slice(side * 100, side * 100 + 100) }, page: { totalPages: Math.ceil(liste.length / 100) } });
  }
  if (/ror\d+\.no/.test(url)) { sider.push(url); return new Response("<html><body><h1>Rør</h1><p>Baderom og lekkasjer. Døgnvakt.</p></body></html>", { headers: { "content-type": "text/html" } }); }
  if (url.includes("api.x.ai")) {
    const sys = JSON.parse(o.body).messages[0].content;
    const svar = sys.includes("e-postserie")
      ? { eposter: [1, 2, 3, 4].map((n) => ({ emne: n === 1 ? "Kunder som ringer mens du er i en kjeller" : "Sv: Kunder som ringer", tekst: n === 1 ? "Hei,\n\nHer er en demo laget til dere:\n{DEMO}\n\nVil du prøve?" : n === 3 ? "Ta en prat: {BOOK}" : `Tekst ${n}.` })) }
      : { navn: "Rør AS", kortnavn: "Rør", bransje: "rørlegger", type: "oppdrag", tjenester: [], apent: {}, usikkert: [] };
    return Response.json({ choices: [{ message: { content: JSON.stringify(svar) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
  }
  if (url.includes("api.resend.com")) {
    const b = JSON.parse(o.body);
    if (/[^\x00-\x7f]/.test(b.to[0])) return new Response('{"message":"Invalid `to` field. The email address contains non-ASCII characters."}', { status: 422 });
    eposter.push(b); return Response.json({ id: "re_" + eposter.length });
  }
  if (url.includes("formsubmit")) return Response.json({});
  if (url.includes("vilkar")) return new Response("<h2>Vilkår</h2>", { headers: { "content-type": "text/html" } });
  throw new Error("uventet kall: " + url);
};

let feil = 0;
const sjekk = (ok, t) => { console.log((ok ? "OK   " : "FEIL ") + t); if (!ok) feil++; };
const oslo = (dato, kl) => Date.parse(`${dato}T${kl}:00+01:00`);
const cron = async (ms) => { const v = []; await worker.scheduled({ cron: "*/15 * * * *", scheduledTime: ms }, env, { waitUntil: (p) => v.push(p) }); await Promise.all(v); };
const drift = async (body) => {
  const r = await worker.fetch(new Request("https://x.dev/drift/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kode: "admin", ...body }) }), env, { waitUntil: () => {} });
  return { status: r.status, d: await r.json() };
};
const firma = (nr) => KV.get("salg:" + nr, "json");
const salgNokler = () => [...lager.keys()].filter((k) => k.startsWith("salg:"));
const tilKunder = () => eposter.filter((e) => e.to[0] !== "hilleren.bedrift@gmail.com");
const kjorDag = async (dato, fra = "00:00", til = "23:45") => {
  for (let ms = oslo(dato, fra); ms <= oslo(dato, til); ms += 15 * 60e3) await cron(ms);
};

// 1) Søndag kveld etter deploy: kampanjen settes opp på pause, motoren finner og skriver, prøver til Preben
await kjorDag("2026-11-22", "20:00", "23:45");
const cfg = await KV.get("salgcfg", "json");
sjekk(cfg.kampanje === "ror-2026-11" && cfg.pause === true && cfg.perDag === 90 && cfg.maksDag === 90 && cfg.helg === true && cfg.bransjer.join() === "ror", "kampanjen er satt opp: rørlegger, 90 per dag, hver dag, på pause");
sjekk(brreg.length && brreg.every((u) => u.includes("naeringskode=43.22") && u.includes("organisasjonsform=AS")), "søker bare rørlegger-AS");
sjekk(!(await firma(910000500)) && !(await firma(910000501)), "æøå-adresse og personlig adresse blir aldri lagret");
sjekk(!!(await firma(910000007)), "postmaster@ regnes som rolleadresse");
const f3 = await firma(910000003);
sjekk(f3 && f3.status === "klar" && f3.demoId && sider.some((u) => u.includes("ror3.no")), "uten nettside i registeret: egen demo laget fra e-postdomenet");
sjekk(f3 && f3.eposter[0].tekst.includes("?kunde=" + f3.demoId), "e-post 1 lenker til firmaets egen ferdige sekretær");
sjekk(tilKunder().length === 0, "ingenting sendes til kunder mens kampanjen står på pause");
const prover = eposter.filter((e) => e.to[0] === "hilleren.bedrift@gmail.com" && e.subject.startsWith("[PRØVE] "));
sjekk(prover.length === 3, `tre prøve-e-poster til Preben (${prover.length})`);
await kjorDag("2026-11-23", "00:00", "02:00");
sjekk(eposter.filter((e) => e.subject.startsWith("[PRØVE] ")).length === 3, "prøvene sendes bare én gang");
const klare = salgNokler().filter((k) => lager.get(k).metadata.s === "klar").length;
sjekk(klare >= 60, `motoren skriver hele døgnet (3 per kvarter), ${klare} klare før mandag morgen`);

// 2) Preben sier ja: slår på. Mandag: 90 e-poster, ikke flere
await drift({ handling: "salg-innstilling", pause: false });
// En gammel firma med æøå-adresse fra før (som stoppet køen 20.11) skal hoppes over
await KV.put("salg:900000999", JSON.stringify({ orgnr: "900000999", navn: "Billys AS", epost: "post@billysø.no", fag: "ror", status: "klar", steg: 0, eposter: [{ emne: "x", tekst: "y" }, {}, {}, {}], logg: [] }), { metadata: { s: "klar", b: "ror" } });
await kjorDag("2026-11-23", "02:15", "23:45");
sjekk(tilKunder().length === 90, `90 e-poster mandag (${tilKunder().length})`);
sjekk((await firma(900000999)).status === "feil", "æøå-adresse hoppes over og stopper ikke køen");
sjekk(new Set(tilKunder().map((e) => e.to[0])).size === 90, "ingen firma får to e-poster samme dag");
const rapport = eposter.find((e) => /^Salgsmotoren 2026-11-23/.test(e.subject));
sjekk(rapport && rapport.text.includes("90 av maks 90") && rapport.text.includes("Rørlegger"), "dagsrapport kl. 16 med tall og bransje");
sjekk(!tilKunder().some((e) => e.to[0] === "post@frisorx.no"), "frisører får ingenting i rørlegger-kampanjen");

// 3) Tirsdag: resten av de 120, så søndag (helg) og oppfølgingen dag 4 innenfor 90 totalt
await kjorDag("2026-11-24");
const nyeTirsdag = tilKunder().length - 90;
sjekk(nyeTirsdag === 30, `de siste 30 lovlige firmaene tirsdag (${nyeTirsdag})`);
const foer = tilKunder().length;
await kjorDag("2026-11-27");
const fredag = tilKunder().slice(foer);
sjekk(fredag.length === 90 && fredag.every((e) => e.subject.startsWith("Sv: ")), `fredag: 90 oppfølginger (dag 4) og ikke mer (${fredag.length})`);
const f2 = tilKunder().length;
await kjorDag("2026-11-28");
sjekk(tilKunder().length - f2 === 30, `lørdag (helg på): resten av oppfølgingene (${tilKunder().length - f2})`);
const alle = new Set(tilKunder().map((e) => e.to[0]));
sjekk(alle.size === 120, `alle 120 lovlige rørleggere nådd (${alle.size})`);

// 4) Innstillinger fra /drift
const s = await drift({ handling: "salg-innstilling", bransjer: ["ror", "el"], maksDag: 200, perDag: 500, helg: false });
sjekk(s.d.cfg.maksDag === 95 && s.d.cfg.perDag === 150 && s.d.cfg.helg === false && s.d.cfg.bransjer.join() === "ror,el", "grenser: maks 95 totalt (Resend gratis = 100/dag), 150 nye");
const v = await drift({ handling: "salg" });
sjekk(v.status === 200 && v.d.cfg.kampanje === "ror-2026-11" && v.d.cfg.prover, "fanen viser kampanje og når prøvene ble sendt");

console.log(feil ? `\n${feil} FEIL` : "\nAlle tester OK");
process.exit(feil ? 1 : 0);
