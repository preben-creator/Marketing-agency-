// Lager PDF-maler av tilbud og avtale fra avtale/index.html + avtale/vilkar.html (samme oppsett som kunden ser).
// Bruk: node tools/lag-avtale-pdf.mjs [utmappe]   (krever Playwright)
//   tilbud-og-avtale-mal.pdf       tom mal med linjer å fylle ut og signere på papir
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
  { t: "KI-sekretær på telefonen", b: "tar telefonen når dere er opptatt, booker timer, svarer på spørsmål om priser og åpningstider, og sender dere et kort sammendrag av samtalen." },
  { t: "SMS til kunden", b: "bekreftelse når timen er bestilt, og påminnelse dagen før." },
  { t: "Assistent på nettsiden", b: "svarer kundene i chat døgnet rundt og kan bestille time." },
  { t: "Oppsett", b: "jeg setter opp alt, legger inn tjenestene og prislisten deres, og tester sammen med dere. Det tar rundt 30 minutter av deres tid." },
  { t: "Endringer", b: "send meg nye priser, tjenester eller åpningstider på e-post, så oppdaterer jeg sekretæren innen to virkedager." },
];
// Gjeldende pris fra november 2026: 7 990 kr oppstart (inkl. første måned) + 1 490 kr/mnd, 1 mnd binding.
const PRIS = { oppstart: 7990, alternativer: [
  { kode: "A", navn: "Fast månedspris", mnd: 1490, prosent: 0, passer: "" },
] };
const MERKNAD = "Oppstartsprisen dekker også første måned. Månedsprisen faktureres fra og med måned 2.";
// Tilbudet Deja Vu fikk 6. november 2026 (gammel pris), beholdt slik det ble sendt.
const PRIS_DEJAVU = { oppstart: 14990, alternativer: [
  { kode: "A", navn: "Fast månedspris", mnd: 1990, prosent: 0, passer: "Sekretæren booker for mer enn 15 000 kr i måneden" },
  { kode: "B", navn: "Etter bruk", mnd: 490, prosent: 10, passer: "Sekretæren booker for mindre enn 15 000 kr i måneden" },
] };
const felles = { tittel: "Tilbud og avtale: KI-sekretær", bindingMnd: 1, tjenester: TJENESTER, pris: PRIS, merknad: MERKNAD, vilkar, signatur: null };

const filer = {
  "tilbud-og-avtale-mal.pdf": { ...felles, nr: "", dato: "", gyldigTil: "", leverandor: ORVELO, kunde: {},
    innledning: "Her er tilbudet på en KI-sekretær som tar telefonen når dere er opptatt, bekrefter timer på SMS og svarer kundene deres på nettsiden." },
  "tilbud-og-avtale-deja-vu.pdf": { ...felles, bindingMnd: 12, pris: PRIS_DEJAVU, merknad: "", nr: "2026-001", dato: "2026-11-06", gyldigTil: "2026-11-24",
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
