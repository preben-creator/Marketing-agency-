// Test av salgsmotoren (Orvelos egen kundeinnhenting): natt-søk, demo og fire e-poster, sending med grenser,
// oppfølging dag 4, avmelding med lenke, sperreliste (også egne kunder og Deja Vu), pause, helg og dagsrapport til Preben.
// Enhetsregisteret, nettsider, Grok og Resend er ETTERLIGNET, så ingen nøkler trengs og ingenting sendes.
//   node tools/test-salgsmotor.mjs
import worker from "../worker/sekretar-worker.js";

const lager = new Map();
const KV = {
  get: async (k, t) => (lager.has(k) ? (t === "json" ? JSON.parse(lager.get(k).v) : lager.get(k).v) : null),
  put: async (k, v, o = {}) => { lager.set(k, { v: String(v), metadata: o.metadata, ttl: o.expirationTtl }); },
  delete: async (k) => { lager.delete(k); },
  list: async ({ prefix = "" }) => ({ keys: [...lager.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: lager.get(name).metadata })), list_complete: true }),
};
const env = { XAI_API_KEY: "x", ADMIN_KODE: "admin", KUNDER: KV, DEMO_KODE: "felles", SALG_FRA: "Preben i Orvelo <preben@orvelo-post.no>", SALG_PER_DAG: "30" };

// 14 AS med rolleadresse, ett AS med personlig adresse, ett ENK med post@ (det skal aldri få noe)
const enhet = (nr, navn, epost, form = "AS", hjemmeside = "") => ({ organisasjonsnummer: String(nr), navn, epostadresse: epost, organisasjonsform: { kode: form },
  antallAnsatte: 5, hjemmeside, forretningsadresse: { poststed: "BERGEN", kommune: "BERGEN" }, stiftelsesdato: "2015-01-01" });
const ENHETER = [
  ...Array.from({ length: 14 }, (_, i) => enhet(900000100 + i, `Frisør ${i} AS`, `post@frisor${i}.no`, "AS", i === 0 ? "frisor0.no" : "")),
  enhet(900000200, "Personlig AS", "kari@personlig.no"),
  enhet(900000300, "Enkelt Kari", "post@enkeltkari.no", "ENK"),
];
const eposter = [], brreg = [];
let grok = 0;
globalThis.fetch = async (u, o = {}) => {
  const url = String(u);
  if (url.includes("data.brreg.no")) { brreg.push(url); return Response.json({ _embedded: { enheter: url.includes("page=0") ? ENHETER : [] }, page: { totalPages: 2 } }); }
  if (url.includes("frisor0.no")) return new Response("<html><body><h1>Frisør 0</h1><p>Klipp 600 kr. Farge. Åpent man–fre 9–17.</p></body></html>", { headers: { "content-type": "text/html" } });
  if (url.includes("api.x.ai")) {
    grok++;
    const sys = JSON.parse(o.body).messages[0].content;
    const bruker = JSON.parse(o.body).messages[1].content;
    if (sys.includes("salgsassistenten")) {
      const siste = bruker.split("KUNDEN: ").pop();
      const kat = /nei takk/i.test(siste) ? "nei" : /hva koster/i.test(siste) ? "sporsmal" : /rabatt/i.test(siste) ? "sporsmal" : "interessert";
      return Response.json({ choices: [{ message: { content: JSON.stringify({ kategori: kat, svar: kat === "nei" ? "Hei,\n\nTakk for svar. Vi skriver ikke mer." : "Hei,\n\nStarter koster 790 kr/mnd eks. mva, og dere kan prøve 14 dager gratis.", trenger_preben: /rabatt/i.test(siste), oppsummering: "Kunden spør om pris." }) } }], usage: {} });
    }
    const svar = sys.includes("e-postserie")
      ? { eposter: [1, 2, 3, 4].map((n) => ({ emne: n === 1 ? "Kunder som venter på svar" : "Sv: Kunder som venter på svar", tekst: n === 1 ? "Hei! Her er en demo laget til dere: {DEMO}. Vil du se mer?" : n === 3 ? "Ta en prat: {BOOK}" : `Tekst ${n}.` })) }
      : { navn: "Frisør 0 AS", kortnavn: "Frisør 0", bransje: "frisørsalong", type: "time", tjenester: [["Hår", [["Klipp", "600 kr", 30], ["Farge", "fra 1 200 kr", 90]]]], ekstra: "Studentrabatt: klipp fra 450 kr. Ring før du kommer.", apent: {}, usikkert: [] };
    return Response.json({ choices: [{ message: { content: JSON.stringify(svar) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
  }
  if (url.includes("vilkar")) return new Response("<!-- versjon: test --><h2>Vilkår</h2><p>Test.</p>", { headers: { "content-type": "text/html" } });
  if (url.includes("api.resend.com")) { eposter.push({ ...JSON.parse(o.body) }); return Response.json({ id: "re_" + eposter.length }); }
  if (url.includes("formsubmit")) { eposter.push({ formsubmit: true, ...JSON.parse(o.body) }); return Response.json({}); }
  throw new Error("uventet kall: " + url);
};

let feil = 0;
const sjekk = (ok, t) => { console.log((ok ? "OK   " : "FEIL ") + t); if (!ok) feil++; };
// Norsk tid i november = UTC+1. 10.11.2026 er en tirsdag.
const oslo = (dato, kl) => Date.parse(`${dato}T${kl}:00+01:00`);
const cron = async (ms) => { const v = []; await worker.scheduled({ cron: "*/15 * * * *", scheduledTime: ms }, env, { waitUntil: (p) => v.push(p) }); await Promise.all(v); };
const drift = async (body, kode = "admin") => {
  const r = await worker.fetch(new Request("https://x.dev/drift/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kode, ...body }) }), env, { waitUntil: () => {} });
  return { status: r.status, d: await r.json() };
};
const firma = (nr) => KV.get("salg:" + nr, "json");
const salgNokler = () => [...lager.keys()].filter((k) => k.startsWith("salg:"));

// Rå e-post slik Cloudflare Email Routing leverer den
const raaEpost = (fra, emne, kropp, ekstra = "") => {
  const raw = `From: Kari <${fra}>\r\nTo: svar@orvelo.no\r\nSubject: =?utf-8?Q?${emne.replace(/ /g, "_").replace(/ø/g, "=C3=B8")}?=\r\nMessage-ID: <abc123@firma.no>\r\n${ekstra}MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="XX"\r\n\r\n--XX\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${kropp.replace(/ø/g, "=C3=B8").replace(/å/g, "=C3=A5")}\r\n\r\nDen 10. nov. 2026 skrev Preben i Orvelo:\r\n> Hei, her er en demo\r\n--XX\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>html</p>\r\n--XX--\r\n`;
  return { from: fra, to: "svar@orvelo.no", raw: new Response(raw).body };
};
const epostInn = (m) => worker.email(m, env, { waitUntil: () => {} });

// 1) Natt: finn og skriv
for (const kl of ["01:00", "01:15", "01:30", "01:45", "02:00", "02:15", "02:30", "02:45", "03:00", "03:15", "03:30", "03:45"]) await cron(oslo("2026-11-10", kl));
sjekk(brreg.some((u) => u.includes("organisasjonsform=AS") && !u.includes("kommunenummer")), "søker AS i hele Norge (uten kommune)");
sjekk(salgNokler().length === 14, `bare AS med rolleadresse lagres (${salgNokler().length} av 16)`);
sjekk(!(await firma(900000200)) && !(await firma(900000300)), "personlig adresse og ENK blir aldri lagret");
const f0 = await firma(900000100);
sjekk(f0 && f0.status === "klar" && f0.eposter.length === 4, "firma med nettside: klar med fire e-poster");
sjekk(f0 && !f0.demoId && f0.demo.endsWith("/demo/?fag=frisor") && f0.eposter[0].tekst.includes(f0.demo), "kald e-post: bransjedemo uten firmanavn, også når firmaet har nettside");
sjekk(![...lager.keys()].some((k) => k.startsWith("kunde:s-")), "ingen demo som snakker for firmaet lages før det har svart");
const f1 = await firma(900000101);
sjekk(f1 && f1.demo.endsWith("/demo/?fag=frisor") && f1.eposter[2].tekst.includes("calendar.app.google"), "uten nettside: bransjedemo, e-post 3 har bookinglenke");
const klare = salgNokler().filter((k) => lager.get(k).metadata.s === "klar").length;
sjekk(klare >= 10, `nok klare for en dag (${klare})`);

// 2) Dag uten Resend: ingenting sendes
await cron(oslo("2026-11-10", "09:00"));
sjekk(eposter.length === 0, "uten RESEND_API_KEY sendes ingenting");

// 3) Sperreliste fra /drift (kontaktet for hånd)
sjekk((await drift({ handling: "salg" }, "feil")).status === 401, "feil admin-kode gir 401");
const sp = await drift({ handling: "salg-sperr", liste: "post@frisor1.no\n900000102" });
sjekk(sp.d.lagt === 2, "to lagt på sperrelisten");

// 4) Dag med Resend. Først: avsender på hoveddomenet orvelo.no blir stoppet
env.RESEND_API_KEY = "re_test";
env.SALG_FRA = "Preben i Orvelo <preben@orvelo.no>";
await cron(oslo("2026-11-10", "08:00"));
const hd = await drift({ handling: "salg" });
sjekk(eposter.length === 0 && /orvelo\.no/.test(hd.d.fraFeil) && !hd.d.fra, "kald e-post sendes aldri fra orvelo.no (hoveddomenet)");
env.SALG_FRA = "Preben i Orvelo <preben@orvelo-post.no>";
// Oppvarming: første uke maks 10 nye per dag selv om valgt antall er 30
for (let m = 0; m < 8 * 4; m++) await cron(oslo("2026-11-10", "08:00") + m * 15 * 60e3);
const tilFirma = eposter.filter((e) => !e.formsubmit && e.to[0] !== "hilleren.bedrift@gmail.com");
sjekk(tilFirma.length === 10, `oppvarming: 10 nye firmaer første dag selv med 30 valgt (${tilFirma.length})`);
sjekk((await KV.get("salgcfg", "json")).start === "2026-11-10", "første sendedag er lagret (start på oppvarmingen)");
sjekk(!tilFirma.some((e) => ["post@frisor1.no", "post@frisor2.no"].includes(e.to[0])), "sperrede adresser fikk ingenting");
sjekk((await firma(900000101)).status === "stopp", "sperret firma står som stoppet");
const e1 = tilFirma.find((e) => e.to[0] === "post@frisor0.no");
sjekk(e1 && e1.from === "Preben i Orvelo <preben@orvelo-post.no>" && e1.reply_to === "orvelo@epost.no", "sendt fra salgsdomenet, svar går til orvelo@epost.no");
sjekk(e1 && /\/avmeld\?o=900000100&t=[0-9a-f]{16}/.test(e1.text) && e1.headers["List-Unsubscribe"].includes("/avmeld?o=900000100") && e1.headers["List-Unsubscribe-Post"], "avmeldingslenke i teksten og i List-Unsubscribe");
sjekk(e1 && e1.text.includes("aksjeselskap") && e1.text.includes("938 720 673") && e1.html.includes("<a href="), "avsender med org.nr, klikkbare lenker i HTML");
sjekk((await firma(900000100)).status === "sendt" && (await firma(900000100)).steg === 1, "firma står som i gang, steg 1");

// 5) Dagsrapport kl. 16 til Preben
await cron(oslo("2026-11-10", "16:00"));
const rapp = eposter.filter((e) => e.to && e.to[0] === "hilleren.bedrift@gmail.com" && /Salgsmotoren/.test(e.subject));
sjekk(rapp.length === 1 && rapp[0].text.includes("Sendt i dag") && rapp[0].text.includes("Frisør 0 AS"), "Preben får oversikten kl. 16");
await cron(oslo("2026-11-10", "16:05"));
sjekk(eposter.filter((e) => /Salgsmotoren/.test(e.subject || "")).length === 1, "oversikten sendes bare én gang");

// 6) Avmelding med lenken
const lenke = e1.text.match(/https?:\/\/\S+\/avmeld\?\S+/)[0].replace(/^https?:\/\/[^/]+/, "https://x.dev");
const feilLenke = await worker.fetch(new Request(lenke.replace(/t=[0-9a-f]+/, "t=0000000000000000")), env, {});
sjekk((await feilLenke.text()).includes("virker ikke") && (await firma(900000100)).status === "sendt", "feil token melder ikke av");
const av = await worker.fetch(new Request(lenke), env, {});
sjekk((await av.text()).includes("meldt av") && (await firma(900000100)).status === "avmeldt", "lenken melder av");
sjekk(await KV.get("salgsperre:e:post@frisor0.no"), "adressen er på sperrelisten for godt");
const ettKlikk = await worker.fetch(new Request(lenke.replace("900000100", "900000103").replace(/t=[0-9a-f]+/, "t=" + (e1.text.match(/t=([0-9a-f]+)/)[1])), { method: "POST" }), env, {});
sjekk((await ettKlikk.text()).includes("virker ikke"), "token gjelder bare sitt eget firma");

// 7) Svart fra /drift stopper oppfølgingen
await drift({ handling: "salg-merk", orgnr: "900000103", status: "svart" });

// 8) Helg: ingenting. Mandag 16.11 (dag 6): e-post 2 til de som ikke svarte
const foer = eposter.length;
await cron(oslo("2026-11-14", "10:00"));
sjekk(eposter.length === foer, "ingenting sendes lørdag");
for (let m = 0; m < 12; m++) await cron(oslo("2026-11-16", "08:00") + m * 15 * 60e3);
const mandag = eposter.slice(foer).filter((e) => e.subject && e.subject.startsWith("Sv: "));
sjekk(mandag.length === 8, `e-post 2 til de 8 som verken svarte eller meldte seg av (${mandag.length})`);
sjekk(!mandag.some((e) => ["post@frisor0.no", "post@frisor3.no"].includes(e.to[0])), "avmeldt og svart får ikke e-post 2");

// 9) Pause stopper alt
await drift({ handling: "salg-innstilling", pause: true });
const foerPause = eposter.length;
for (let m = 0; m < 8; m++) await cron(oslo("2026-11-17", "08:00") + m * 15 * 60e3);
sjekk(eposter.length === foerPause, "pause: ingenting sendes");
await drift({ handling: "salg-innstilling", pause: false, perDag: 5 });
const s = await drift({ handling: "salg" });
sjekk(s.status === 200 && s.d.cfg.perDag === 5 && s.d.telling.avmeldt === 1 && s.d.telling.svart === 1, "fanen viser tall og innstillinger");
const fv = await drift({ handling: "salg-firma", orgnr: "900000104" });
sjekk(fv.d.firma.forhand.length === 4 && fv.d.firma.forhand[0].tekst.includes("Meld av her"), "forhåndsvisning av alle fire med fot");

// 10) Gå gjennom hele sekvensen: etter e-post 4 er firmaet ferdig
for (const dato of ["2026-11-20", "2026-11-25", "2026-11-26", "2026-11-30", "2026-12-01"]) for (let m = 0; m < 8; m++) await cron(oslo(dato, "08:00") + m * 15 * 60e3);
const f4 = await firma(900000104);
sjekk(f4.steg === 4 && f4.status === "ferdig" && !f4.neste, `etter fire e-poster er firmaet ferdig (steg ${f4.steg}, ${f4.status})`);
const til104 = eposter.filter((e) => e.to && e.to[0] === "post@frisor4.no");
sjekk(til104.length === 4, `firmaet fikk nøyaktig fire e-poster (${til104.length})`);

// 11) Svaragenten. Standard: agenten lager et utkast, Preben godkjenner før det sendes
const foerSvar = eposter.length;
await epostInn(raaEpost("post@frisor5.no", "Sv: Kunder som venter på svar", "Hei! Hva koster det å prøve? Vi er åpne for det."));
const f5u = await firma(900000105);
sjekk(!eposter.slice(foerSvar).some((e) => e.to && e.to[0] === "post@frisor5.no"), "utkastmodus: ingenting sendes til kunden før Preben godkjenner");
sjekk(f5u.utkast && f5u.utkast.tekst.includes("790 kr") && f5u.trengerPreben && lager.get("salg:900000105").metadata.u === 1, "svarutkastet ligger på firmaet og er merket i listen");
sjekk(eposter.slice(foerSvar).some((e) => e.to && e.to[0] === "hilleren.bedrift@gmail.com" && /^SVARUTKAST: /.test(e.subject) && e.text.includes("790 kr")), "Preben får utkastet på e-post");
const godkj = await drift({ handling: "salg-utkast-send", orgnr: "900000105", tekst: f5u.utkast.tekst + "\n\nRettet av Preben." });
const svar5 = eposter.slice(foerSvar).find((e) => e.to && e.to[0] === "post@frisor5.no");
const f5 = await firma(900000105);
sjekk(godkj.status === 200 && godkj.d.godkjent === 1 && svar5 && svar5.text.includes("Rettet av Preben") && svar5.text.includes("lest av Preben") && svar5.from.includes("orvelo-post.no"), "Preben godkjenner (og retter): svaret sendes fra salgsdomenet");
sjekk(!f5.utkast && !f5.trengerPreben, "utkastet er borte etter sending");
// Preben slår på automatiske svar
await drift({ handling: "salg-innstilling", autosvar: "auto" });
sjekk(svar5 && svar5.text.includes("790 kr") && svar5.bcc[0] === "hilleren.bedrift@gmail.com" && svar5.headers["In-Reply-To"] === "<abc123@firma.no>", "spørsmål: agenten svarer med fakta, kopi til Preben, i samme tråd");
sjekk(svar5 && svar5.subject.startsWith("Sv: ") && svar5.text.includes("KI-assistent"), "svaret sier at det er skrevet med KI");
sjekk(f5.status === "svart" && !f5.neste && f5.samtale.length === 2 && f5.samtale[0].tekst.includes("Hva koster") && !f5.samtale[0].tekst.includes("her er en demo"), "status svart, oppfølging stoppet, sitert tekst fjernet");
sjekk(eposter.slice(foerSvar).some((e) => e.to && e.to[0] === "hilleren.bedrift@gmail.com" && /svarte \(sporsmal\)/.test(e.subject)), "Preben får beskjed om svaret");
await epostInn(raaEpost("ola@frisor6.no", "Sv: Kunder", "Nei takk, ikke interessert."));
const f6 = await firma(900000106);
sjekk(f6.status === "stopp" && await KV.get("salgsperre:e:post@frisor6.no") && await KV.get("salgsperre:e:ola@frisor6.no"), "nei fra en annen adresse på samme domene: stopp og sperret");
const f7foer = await firma(900000107);
await epostInn(raaEpost("post@frisor7.no", "Fravær", "Jeg er på ferie til mandag.", "Auto-Submitted: auto-replied\r\n"));
const f7 = await firma(900000107);
sjekk(f7.status === f7foer.status && f7.neste === f7foer.neste && !eposter.slice(foerSvar).some((e) => e.to && e.to[0] === "post@frisor7.no"), "autosvar: ingen svar, sekvensen fortsetter");
const n = eposter.length;
await epostInn(raaEpost("noe@ukjent.no", "Hei", "Hvem er dere?"));
sjekk(eposter.length === n + 1 && eposter.at(-1).to[0] === "hilleren.bedrift@gmail.com", "ukjent avsender: bare beskjed til Preben");
await epostInn(raaEpost("preben@orvelo.no", "loop", "test"));
sjekk(eposter.length === n + 1, "e-post fra oss selv blir ignorert (ingen løkke)");
for (let i = 0; i < 3; i++) await epostInn(raaEpost("post@frisor5.no", "Sv: Kunder", "Interessant, fortell mer " + i));
const f5b = await firma(900000105);
sjekk(f5b.samtale.filter((m) => m.fra === "agent").length === 3 && f5b.trengerPreben, "maks 3 automatiske svar, deretter tar Preben over");
const lim = await drift({ handling: "salg-svar", fra: "post@frisor8.no", emne: "Sv: Kunder", tekst: "Kan dere gi rabatt?" });
const f8 = await firma(900000108);
sjekk(lim.status === 200 && lim.d.resultat.hva === "sporsmal" && lim.d.resultat.trengerPreben && f8.status === "svart", "svar limt inn på /drift: agenten svarer og flagger at Preben må se på rabatt");
const liste = await drift({ handling: "salg" });
sjekk(liste.d.cfg.autosvar === "auto" && liste.d.cfg.godkjent === 1, "fanen viser svarmodus og antall godkjente svar");

// Egen demo fra nettsiden: først etter svar, merket og uten priser
await KV.put("salg:900000950", JSON.stringify({ orgnr: "900000950", navn: "Frisør 0 AS", epost: "post@frisor0b.no", hjemmeside: "frisor0.no", bransje: "frisør", fag: "frisor", status: "klar", steg: 1, neste: "", eposter: [], logg: [] }), { metadata: { s: "klar" } });
sjekk((await drift({ handling: "salg-demo", orgnr: "900000950" })).status === 400, "egen demo nektes før firmaet har svart");
await drift({ handling: "salg-merk", orgnr: "900000950", status: "svart" });
const dm = await drift({ handling: "salg-demo", orgnr: "900000950" });
const f950 = await firma(900000950);
const demoProfil = f950.demoId && JSON.parse(lager.get("kunde:" + f950.demoId).v);
sjekk(dm.status === 200 && dm.d.lenke.includes("?kunde=" + f950.demoId) && lager.get("kunde:" + f950.demoId).ttl === 60 * 86400, "egen demo lages etter svar, lever i 60 dager");
sjekk(demoProfil && demoProfil.salgDemo === "900000950" && !JSON.stringify(demoProfil.tjenester).match(/\d+\s*kr/) && !/\d+\s*kr/.test(demoProfil.ekstra) && demoProfil.ekstra.includes("Ring før du kommer"), "demoen er merket som Orvelos og har ingen priser");
sjekk(liste.d.rader.some((r) => r.orgnr === "900000108" && r.tp === 1), "fanen merker «trenger deg»");

const hmac16 = async (hemmelig, orgnr) => {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("salg-avmeld:" + hemmelig), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(orgnr))).slice(0, 8)].map((x) => x.toString(16).padStart(2, "0")).join("");
};
const salgTokenFra = async (orgnr) => hmac16(await KV.get("salgnokkel"), orgnr);

// Sperre for egne kunder: navn (Deja Vu), domene, firma Preben har laget sekretær eller tilbud til
const klarFirma = async (orgnr, navn, epost, hjemmeside = "") => KV.put("salg:" + orgnr, JSON.stringify({ orgnr, navn, epost, hjemmeside, fag: "frisor", status: "klar", steg: 0, neste: "",
  eposter: [1, 2, 3, 4].map((n) => ({ emne: "Emne " + n, tekst: "Tekst " + n })), logg: [] }), { metadata: { s: "klar", n: 0 } });
await klarFirma("900000901", "DEJA VU FRISØR AS", "post@dejavu-test.no");
await klarFirma("900000905", "DEJAVU HÅRSTUDIO AS", "post@dejavu-test2.no");
await klarFirma("900000902", "Domene Frisør AS", "post@domenefrisor.no");
await klarFirma("900000903", "Laget Selv AS", "firmapost@lagetselv.no");
await klarFirma("900000904", "Tilbud Sendt AS", "post@tilbudsendt.no");
const spD = await drift({ handling: "salg-sperr", liste: "https://www.domenefrisor.no/" });
sjekk(spD.d.lagt === 1 && await KV.get("salgsperre:d:domenefrisor.no"), "et domene kan legges på sperrelisten");
const lagre = await worker.fetch(new Request("https://x.dev/lagre", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ kode: "admin", id: "laget-selv-ab12", profil: { navn: "Laget Selv AS", nettside: "https://lagetselv.no", epost: "post@lagetselv.no" } }) }), env, { waitUntil: () => {} });
sjekk(lagre.status === 200 && await KV.get("salgsperre:d:lagetselv.no"), "sekretær laget på /lag eller /lagre sperrer firmaets domene");
const avt = await worker.fetch(new Request("https://x.dev/avtale/ny", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ kode: "admin", avtale: { kunde: { firma: "Tilbud Sendt AS", orgnr: "900 000 904", epost: "post@tilbudsendt.no" }, pris: { alternativer: [{ navn: "Pro", mnd: 1490 }] } } }) }), env, { waitUntil: () => {} });
const avtOk = await KV.get("salgsperre:900000904");
sjekk(avt.status === 200 && avtOk && await KV.get("salgsperre:e:post@tilbudsendt.no"), "tilbud på /avtale/ny sperrer org.nr og e-post");
const foerSperre = eposter.length;
await cron(oslo("2026-11-18", "09:00"));
await cron(oslo("2026-11-18", "09:15"));
const tilSperret = eposter.slice(foerSperre).filter((e) => e.to && ["post@dejavu-test.no", "post@dejavu-test2.no", "post@domenefrisor.no", "firmapost@lagetselv.no"].includes(e.to[0]));
sjekk(tilSperret.length === 0, "Deja Vu, sperret domene og egen sekretær-kunde får ingen salgs-e-post");
sjekk((await firma(900000901)).status === "stopp" && (await firma(900000905)).status === "stopp" && (await firma(900000903)).status === "stopp", "de står som stoppet");

// Avmeldingslenkene overlever bytte av ADMIN_KODE, og gamle lenker (signert med ADMIN_KODE) virker fortsatt
sjekk(await KV.get("salgnokkel") && e1.text.includes("t=" + await salgTokenFra("900000100")), "avmeldingslenkene signeres med egen nøkkel (salgnokkel i KV)");
const gammelLenke = await worker.fetch(new Request(`https://x.dev/avmeld?o=900000107&t=${await hmac16("admin", "900000107")}`), env, { waitUntil: () => {} });
sjekk((await gammelLenke.text()).includes("meldt av"), "lenker signert med den gamle nøkkelen (ADMIN_KODE) virker fortsatt");
const gammelKode = env.ADMIN_KODE;
env.ADMIN_KODE = "ny-kode";
const avNy = await worker.fetch(new Request(`https://x.dev/avmeld?o=900000106&t=${await salgTokenFra("900000106")}`), env, { waitUntil: () => {} });
sjekk((await avNy.text()).includes("meldt av"), "avmeldingslenke virker etter at ADMIN_KODE er byttet");
env.ADMIN_KODE = gammelKode;

console.log(feil ? `\n${feil} FEIL` : "\nAlle tester OK");
process.exit(feil ? 1 : 0);
