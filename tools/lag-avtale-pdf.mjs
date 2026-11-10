// Lager PDF-maler av tilbud og avtale fra avtale/index.html + avtale/vilkar.html (samme oppsett som kunden ser).
// Bruk: node tools/lag-avtale-pdf.mjs [utmappe]   (krever Playwright)
//   tilbud-og-avtale-mal.pdf       tom mal med linjer å fylle ut og signere på papir
//   tilbud-og-avtale-telefon.pdf  mal etter salg på telefon (etter demo)
//   tilbud-og-avtale-deja-vu.pdf   utfylt eksempel for Deja Vu Frisør
import fs from "fs"; import path from "path"; import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const rot = new URL("..", import.meta.url).pathname;
const ut = process.argv[2] || path.join(rot, "avtale", "pdf");
fs.mkdirSync(ut, { recursive: true });
const vilkar = fs.readFileSync(path.join(rot, "avtale/vilkar.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "").trim();

const ORVELO = { navn: "Orvelo v/ Preben Hilleren", orgnr: "938 720 673", adresse: "Bergen", epost: "hilleren.bedrift@gmail.com", signatar: "Preben Hilleren" };
const TJENESTER = [
  { t: "Egen KI-sekretær", b: "laget for firmaet deres ut fra nettsiden, med tjenestene, prisene og åpningstidene deres. Hun snakker og skriver norsk og svarer kundene døgnet rundt." },
  { t: "Svar og forslag til time", b: "sekretæren svarer på spørsmål om tjenester, priser og åpningstider, og foreslår ledige tider til kundene." },
  { t: "Lenke og chat dere kan dele", b: "kundene når sekretæren via en lenke eller knapp på nettsiden, Google-profilen og sosiale medier, og som chat rett på deres egen nettside." },
  { t: "Rett selv", b: "dere får en egen side der dere selv endrer tjenester, priser, varighet og åpningstider. Endringene gjelder med en gang." },
  { t: "Booking og SMS (Pro og Komplett)", b: "timer legges rett i kalenderen deres, og kunden får SMS med bekreftelse og påminnelse dagen før. I tillegg SMS ved tapt anrop og forespørsel om Google-anmeldelse." },
  { t: "KI-agenter (Komplett)", b: "9 agenter som lager utkast til tilbud, faktura, purring, jobbrapport, innkjøpsliste, dagens rute, salgs- og markedsføringstekster og svar på anmeldelser. Dere sjekker og sender selv." },
  { t: "Oppsett", b: "jeg setter opp alt og går gjennom sekretæren sammen med dere før oppstart. Det tar rundt 15–30 minutter av deres tid." },
  { t: "Kommer uten ekstra kostnad (Pro og Komplett)", b: "svar på deres eget telefonnummer, innboks for e-post og Facebook, og ukesrapport på e-post. Dere får beskjed når det er klart." },
];
// Tjenestene slik de stod i tilbudet Deja Vu fikk 6. november 2026.
const TJENESTER_DEJAVU = [
  { t: "KI-sekretær på telefonen", b: "tar telefonen når dere er opptatt, booker timer, svarer på spørsmål om priser og åpningstider, og sender dere et kort sammendrag av samtalen." },
  { t: "SMS til kunden", b: "bekreftelse når timen er bestilt, og påminnelse dagen før." },
  { t: "Assistent på nettsiden", b: "svarer kundene i chat døgnet rundt og kan bestille time." },
  { t: "Oppsett", b: "jeg setter opp alt, legger inn tjenestene og prislisten deres, og tester sammen med dere. Det tar rundt 30 minutter av deres tid." },
  { t: "Endringer", b: "send meg nye priser, tjenester eller åpningstider på e-post, så oppdaterer jeg sekretæren innen to virkedager." },
];
// Gjeldende pris fra 10. november 2026: tre pakker med ulikt innhold, ingen oppstartspris, 14 dagers gratis prøve, deretter 12 mnd.
const PRIS = { oppstart: 0, alternativer: [
  { kode: "A", navn: "Starter", mnd: 790, prosent: 0, passer: "Sekretæren i chat og med stemme på nettsiden. 50 minutter med stemme per måned" },
  { kode: "B", navn: "Pro", mnd: 1490, prosent: 0, passer: "Alt i Starter, pluss booking i kalenderen og SMS til kundene (200 SMS). 200 minutter" },
  { kode: "C", navn: "Komplett", mnd: 2990, prosent: 0, passer: "Alt i Pro med 500 SMS, pluss 9 KI-agenter for kontorarbeidet. 500 minutter" },
] };
const MERKNAD = "De første 14 dagene fra oppstartsdato er en gratis prøveperiode. Sier dere fra på e-post før den er over, koster det ingenting. Chat er ubegrenset i alle pakker. Ekstra minutter med stemme koster 5 kr per minutt og ekstra SMS 1 kr per stykk.";
// Tilbudet Deja Vu fikk 6. november 2026 (gammel pris), beholdt slik det ble sendt.
const PRIS_DEJAVU = { oppstart: 14990, alternativer: [
  { kode: "A", navn: "Fast månedspris", mnd: 1990, prosent: 0, passer: "Sekretæren booker for mer enn 15 000 kr i måneden" },
  { kode: "B", navn: "Etter bruk", mnd: 490, prosent: 10, passer: "Sekretæren booker for mindre enn 15 000 kr i måneden" },
] };
const felles = { tittel: "Tilbud og avtale: KI-sekretær", bindingMnd: 12, tjenester: TJENESTER, pris: PRIS, merknad: MERKNAD, vilkar, signatur: null };

const filer = {
  "tilbud-og-avtale-mal.pdf": { ...felles, nr: "", dato: "", gyldigTil: "", leverandor: ORVELO, kunde: {},
    innledning: "Her er tilbudet på en KI-sekretær som er laget for firmaet deres, og som svarer kundene deres døgnet rundt." },
  "tilbud-og-avtale-telefon.pdf": { ...felles, nr: "", dato: "", gyldigTil: "", leverandor: ORVELO, kunde: {},
    innledning: "Takk for samtalen i dag. Som avtalt på telefonen får dere her tilbudet skriftlig. Dere har allerede prøvd KI-sekretæren som er laget for firmaet deres, og avtalen gjelder den sekretæren, tilpasset slik vi ble enige om.\nAvtalen er ikke inngått før dere har signert den. Les gjennom i ro og mak, og signer digitalt med lenken du har fått på SMS eller e-post." },
  "tilbud-og-avtale-deja-vu.pdf": { ...felles, tjenester: TJENESTER_DEJAVU, bindingMnd: 12, pris: PRIS_DEJAVU, merknad: "", nr: "2026-001", dato: "2026-11-06", gyldigTil: "2026-11-24",
    leverandor: ORVELO,
    kunde: { firma: "Deja Vu Frisør AS", orgnr: "", adresse: "Solheimsgaten 78, 5054 Bergen", kontaktperson: "Jessica Van Tran", epost: "post@dejavubergen.no" },
    innledning: "Hei Jessica! Takk for et godt møte. Her er tilbudet på en KI-sekretær som tar telefonen, bekrefter timer på SMS og svarer kundene deres på nettsiden. Dere velger selv mellom fast månedspris og en lavere månedspris der en del av betalingen følger antall bookinger.",
    regneeksempel: "Sekretæren booker 20 klipp à 845 kr i en måned, til sammen 16 900 kr. Med alternativ B blir månedsprisen da 490 kr + 1 690 kr = 2 180 kr." },
};

const html = fs.readFileSync(path.join(rot, "avtale/index.html"), "utf8");
const b = await chromium.launch();
for (const [navn, data] of Object.entries(filer)) {
  const s = await b.newPage();
  s.on("pageerror", (e) => console.error("Feil på siden:", e.message));
  const medData = html.replace("<script>", () => `<script>window.AVTALE_DATA=${JSON.stringify(data).replace(/</g, "\\u003c")};</script><script>`);
  await s.setContent(medData, { waitUntil: "load" });
  await s.waitForFunction(() => window.KLAR);
  await s.pdf({ path: path.join(ut, navn), format: "A4", printBackground: true,
    displayHeaderFooter: true, headerTemplate: "<span></span>",
    footerTemplate: '<div style="font:9px Segoe UI,sans-serif;color:#888;width:100%;text-align:center">Side <span class="pageNumber"></span> av <span class="totalPages"></span></div>' });
  console.log("Laget", path.join(ut, navn));
}
await b.close();
