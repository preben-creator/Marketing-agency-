// Test av KI-agentene (/agenter): oppfølging av leads og markedsføring, med ekte Grok og et KV-lager i minnet.
//   XAI_API_KEY=... node tools/test-agenter.mjs              alt
//   XAI_API_KEY=... node tools/test-agenter.mjs uten-ki      bare tilgang og leads (ingen Grok-kall)
// Bruker demo-rorlegger fra tools/demo-profiler.json. Ingenting lagres eller sendes på ekte.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../worker/sekretar-worker.js";

const her = dirname(fileURLToPath(import.meta.url));
const utenKi = process.argv.includes("uten-ki");
const lager = new Map();
const env = { XAI_API_KEY: process.env.XAI_API_KEY, ADMIN_KODE: "admin", AGENT_MAKS_DAG: "50",
  KUNDER: { get: async (k, t) => (lager.has(k) ? (t === "json" ? JSON.parse(lager.get(k)) : lager.get(k)) : null),
    put: async (k, v) => { lager.set(k, v); } } };
const profil = JSON.parse(readFileSync(join(her, "demo-profiler.json"), "utf8"))["demo-rorlegger"];
lager.set("kunde:demo-rorlegger", JSON.stringify(profil));
lager.set("rediger:demo-rorlegger", "rkode12345");
const naa = Date.now(), dag = 86400000;
lager.set("chatinnboks:demo-rorlegger", JSON.stringify([
  { type: "beskjed", tid: new Date(naa - 2 * dag).toISOString(), navn: "Kari Nilsen", mobil: "98765432", beskjed: "Vil ha pris på nytt bad, ca 6 kvm, i februar" },
  { type: "time", tid: new Date(naa - 12 * dag).toISOString(), navn: "Ola Hansen", mobil: "91234567", hva: "Bytte varmtvannsbereder", dato: "2026-11-01", klokkeslett: "09:00" },
  { type: "time", status: "booket", tid: new Date(naa - 1 * dag).toISOString(), navn: "Booket Person", mobil: "40000000", hva: "Befaring", dato: "2026-11-12", klokkeslett: "10:00" },
]));

let feil = 0;
const sjekk = (ok, tekst) => { console.log((ok ? "OK   " : "FEIL ") + tekst); if (!ok) feil++; };
async function kall(sti, body) {
  const r = await worker.fetch(new Request("https://x.dev" + sti, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, { waitUntil: () => {} });
  return { status: r.status, d: await r.json() };
}

let r = await kall("/agenter/data", { kunde: "demo-rorlegger", r: "feil-kode" });
sjekk(r.status === 404, "feil rettekode gir 404");
r = await kall("/agenter/data", { kunde: "demo-rorlegger", r: "rkode12345" });
sjekk(r.status === 200 && r.d.leads.length === 2, "to leads fra chatten (booket time er ikke et lead): " + r.d.leads.length);
r = await kall("/agenter/data", { kunde: "demo-rorlegger", kode: "admin" });
sjekk(r.status === 200 && r.d.leads.length === 2, "admin-kode virker, og leads importeres bare én gang");
r = await kall("/agenter/lead", { kunde: "demo-rorlegger", r: "rkode12345", lead: { navn: "Per Berg", kontakt: "per@eksempel.no", interesse: "Varmekabler i gang, ringte i forrige uke", verdi: "15000" } });
sjekk(r.status === 200 && r.d.leads.length === 3 && r.d.lead.verdi === 15000, "manuelt lead lagt til");
const kari = r.d.leads.find((l) => l.navn === "Kari Nilsen");
r = await kall("/agenter/lead", { kunde: "demo-rorlegger", r: "rkode12345", lead: { id: kari.id, stadie: "kontaktet" } });
sjekk(r.d.lead.stadie === "kontaktet" && r.d.lead.sistKontakt && r.d.lead.navn === "Kari Nilsen", "stadie endret uten å miste navn");
const ola = r.d.leads.find((l) => l.navn === "Ola Hansen");
r = await kall("/agenter/lead/slett", { kunde: "demo-rorlegger", r: "rkode12345", id: ola.id });
r = await kall("/agenter/data", { kunde: "demo-rorlegger", r: "rkode12345" });
sjekk(r.d.leads.length === 2 && !r.d.leads.some((l) => l.navn === "Ola Hansen"), "slettet chat-lead kommer ikke tilbake");
// legg Ola tilbake som manuell for analysen
await kall("/agenter/lead", { kunde: "demo-rorlegger", r: "rkode12345", lead: { navn: "Ola Hansen", kontakt: "91234567", interesse: "Ba om befaring for ny varmtvannsbereder for 12 dager siden, hørte ikke mer" } });

if (!utenKi) {
  if (!env.XAI_API_KEY) { console.error("Mangler XAI_API_KEY"); process.exit(1); }
  r = await kall("/agenter/oppfolging", { kunde: "demo-rorlegger", r: "rkode12345" });
  sjekk(r.status === 200 && r.d.analyse.leads.length === 3, "oppfølging analyserte 3 leads");
  console.log(JSON.stringify(r.d.analyse, null, 1));
  for (const type of ["innlegg", "kampanje", "landingsside"]) {
    r = await kall("/agenter/marked", { kunde: "demo-rorlegger", r: "rkode12345", type, valg: { plattform: "facebook", antall: 2, uker: 2, tema: "vinter og frosne rør" } });
    sjekk(r.status === 200 && r.d.resultat && r.d.resultat.innhold, "markedsføring: " + type);
    console.log(JSON.stringify(r.d.resultat?.innhold || r.d, null, 1));
  }
  // Tilbudsagent: tekst + bilde (et av e-postbildene, bare for å teste at bilder går gjennom)
  const bilde = "data:image/jpeg;base64," + readFileSync(join(her, "../assets/epost/ror.jpg")).toString("base64");
  r = await kall("/agenter/tilbud", { kunde: "demo-rorlegger", r: "rkode12345", timepris: "950", kunde_navn: "Ola Hansen", bilder: [bilde],
    beskrivelse: "Bytte varmtvannsbereder 200 l i vaskerom i kjeller.\nGammel bereder kobles fra og kjøres bort.\nNy sikkerhetsventil og avstengningskran." });
  const t = r.d.tilbud || {};
  sjekk(r.status === 200 && t.arbeid?.length && t.materialer?.length && t.forbehold?.length, "tilbud med arbeid, materialer og forbehold");
  sjekk(t.arbeid?.every((a) => a.timepris === 950 || a.timer === 0), "timeprisen er den eieren skrev, ikke oppdiktet");
  sjekk(/sjekk alltid/i.test(t.advarsel || ""), "tilbudet har advarsel om å sjekke tall");
  sjekk(t.antallBilder === 1, "bildet ble sendt med");
  console.log(JSON.stringify(t, null, 1));
  r = await kall("/agenter/tilbud", { kunde: "demo-rorlegger", r: "rkode12345", beskrivelse: "x" });
  sjekk(r.status === 400, "for kort beskrivelse gir 400");

  // De seks agentene på /agenter/kjor
  const K = (oppgave, ekstra) => kall("/agenter/kjor", { kunde: "demo-rorlegger", r: "rkode12345", oppgave, ...ekstra });
  r = await K("purring", {});
  sjekk(r.status === 400, "purring uten sendte tilbud gir 400 med forklaring");
  const sendtDato = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  r = await kall("/agenter/tilbud/status", { kunde: "demo-rorlegger", r: "rkode12345", tilbudId: t.id, status: "sendt", sendt: sendtDato, kontakt: "91234567" });
  if (r.status !== 200) console.log("status-svar", r.status, r.d);
  sjekk(r.status === 200 && r.d.tilbud.status === "sendt" && r.d.tilbud.kontakt === "91234567", "tilbud merket sendt med kontakt");
  r = await K("purring", { dager: 3 });
  sjekk(r.status === 200 && r.d.resultat.purringer.length === 1 && r.d.resultat.purringer[0].kanal === "sms", "purring: én påminnelse på sms");
  console.log(r.d.resultat?.purringer?.[0]?.melding);
  const tMedPris = JSON.parse(JSON.stringify(t)); tMedPris.materialer.forEach((m) => { m.enhetspris = 1000; });
  r = await K("faktura", { tilbud: tMedPris, notat: "Brukte 1 time mer enn anslått på demontering. Ellers som tilbudet.", mva: true });
  const fa = r.d.resultat || {};
  sjekk(r.status === 200 && fa.linjer?.length && fa.sum?.total === Math.round(fa.sum.eksMva * 1.25), "faktura: linjer og riktig mva-sum");
  sjekk(fa.linjer?.some((l) => l.pris === 950), "faktura bruker timeprisen fra tilbudet");
  console.log(JSON.stringify(fa.linjer), fa.merknader);
  r = await K("faktura", { notat: "x" });
  sjekk(r.status === 400, "faktura uten tilbud og notat gir 400");
  r = await K("innkjop", { tilbud: t });
  sjekk(r.status === 200 && r.d.resultat.grupper.length, "innkjøpsliste gruppert");
  console.log(JSON.stringify(r.d.resultat.grupper));
  r = await K("anmeldelse", { stjerner: 2, navn: "Trude Hansen", tekst: "Kom en time for sent og la igjen søl på gulvet. Jobben ble ok, men dyrt. Jeg har dårlig rygg og måtte vaske selv." });
  const an = r.d.resultat || {};
  sjekk(r.status === 200 && an.forslag?.length === 3, "anmeldelse: tre forslag");
  sjekk(!an.forslag?.some((f) => /rygg/i.test(f.svar)), "anmeldelsessvar nevner ikke helseopplysning");
  sjekk(!an.forslag?.some((f) => /rabatt|gratis|kompens/i.test(f.svar)), "anmeldelsessvar lover ikke kompensasjon");
  console.log(an.forslag?.map((f) => f.tone + ": " + f.svar).join("\n"));
  r = await K("jobbrapport", { stikkord: "Byttet bereder 200 l. Gammel rusten i bunnen. Ny sikkerhetsventil. Anbefaler å sjekke ventilen årlig.", kunde_navn: "Ola Hansen", bilder: [bilde] });
  sjekk(r.status === 200 && r.d.resultat.utfort.length, "jobbrapport med utført arbeid");
  sjekk(!JSON.stringify(r.d.logg).includes("base64"), "bilder lagres ikke i loggen");
  console.log(JSON.stringify(r.d.resultat));
  r = await K("rute", { start: "Landåsveien 10, Bergen", starttid: "07:30", oppdrag: [
    { navn: "A", adresse: "Strandkaien 2, Bergen", tidsvindu: "", varighet: 60 },
    { navn: "B", adresse: "Nesttunbrekka 5, Nesttun", tidsvindu: "", varighet: 60 },
    { navn: "C", adresse: "Fjøsangerveien 50, Bergen", tidsvindu: "", varighet: 45 },
    { navn: "D", adresse: "Lagunen, Rådal", tidsvindu: "14–16", varighet: 30 } ] });
  const ru = r.d.resultat || {};
  sjekk(r.status === 200 && ru.stopp?.length === 4 && new Set(ru.stopp.map((x) => x.navn)).size === 4, "rute: alle fire oppdrag med én gang");
  sjekk(/google\.com\/maps\/dir\//.test(ru.kart || ""), "rute: Google Maps-lenke");
  console.log(ru.stopp?.map((x) => `${x.ankomst_ca} ${x.navn} ${x.adresse}`).join(" | "), ru.kart);
  r = await kall("/agenter/data", { kunde: "demo-rorlegger", r: "rkode12345" });
  sjekk(Object.keys(r.d.logg).length === 6 && r.d.logg.anmeldelse.length === 1, "data gir logg for alle seks");
}
console.log(feil ? `\n${feil} feil` : "\nAlt OK");
process.exit(feil ? 1 : 0);
