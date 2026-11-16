// Nettlesertest: åpner nettsiden og chat-prøvesiden i en ekte (headless) Chrome, slik en kunde ville gjort,
// og sjekker at chatboblen kommer opp, at en melding går fram og at sekretæren svarer.
// Tar skjermbilder i testbilder/ (lastes opp fra GitHub Actions så Preben kan se dem).
//
//   npm i --no-save playwright && npx playwright install chromium
//   LIVE_KUNDE=demo-rorlegger LIVE_KODE=... node tools/nettleser-test.mjs
import { mkdirSync, appendFileSync } from "node:fs";
import { chromium } from "playwright";

const SEK = (process.env.SEKRETAR_URL || "https://orvelo-sekretar.preben-m-hilleren.workers.dev").replace(/\/$/, "");
const SIDE = process.env.NETTSIDE_URL || "https://preben-creator.github.io/Marketing-agency-/";
const KUNDE = process.env.LIVE_KUNDE || "demo-rorlegger";
const KODE = process.env.LIVE_KODE || "";
mkdirSync("testbilder", { recursive: true });

const rader = [];
let feil = 0;
function sjekk(ok, tekst, detalj = "") {
  console.log((ok ? "OK   " : "FEIL ") + tekst + (detalj ? "  -> " + detalj : ""));
  rader.push(`| ${ok ? "✅" : "❌"} | ${tekst} | ${String(detalj).replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 220)} |`);
  if (!ok) feil++;
}

const nettleser = await chromium.launch(process.env.CHROME_STI ? { executablePath: process.env.CHROME_STI } : {});
try {
  // Forsiden på mobil og PC
  for (const [navn, vindu] of [["mobil", { width: 390, height: 844 }], ["pc", { width: 1366, height: 900 }]]) {
    const side = await nettleser.newPage({ viewport: vindu });
    const jsFeil = [];
    side.on("pageerror", (e) => jsFeil.push(e.message));
    try {
      const r = await side.goto(SIDE, { waitUntil: "networkidle", timeout: 60000 });
      const tittel = await side.title();
      sjekk(r.ok() && /orvelo/i.test(tittel + (await side.content()).slice(0, 5000)), `Forsiden laster (${navn})`, tittel);
      const bred = await side.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
      sjekk(!bred, `Forsiden har ingen sidelengs scrolling (${navn})`);
      sjekk(!jsFeil.length, `Ingen JavaScript-feil på forsiden (${navn})`, jsFeil.join("; "));
      await side.screenshot({ path: `testbilder/forside-${navn}.png` });
    } catch (e) { sjekk(false, `Forsiden laster (${navn})`, e.message); }
    await side.close();
  }

  // Chatten på prøvesiden, som en kunde
  if (!KODE) {
    rader.push("| ⏭️ | Chat i nettleser hoppet over | Legg inn LIVE_KODE som hemmelighet i GitHub |");
  } else {
    const side = await nettleser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await side.goto(`${SEK}/chat/prov?kunde=${KUNDE}&k=${encodeURIComponent(KODE)}&apen=0`, { waitUntil: "networkidle", timeout: 60000 });
      const apne = side.locator('[aria-label="Åpne chat"]');
      await apne.waitFor({ timeout: 20000 });
      sjekk(true, "Chatboblen vises");
      await apne.click();
      const felt = side.locator('[aria-label="Melding"]');
      await felt.waitFor({ timeout: 10000 });
      const forAntall = await side.locator(".m.a:not(.skriver)").count();
      await felt.fill("Hei! Hva koster en befaring?");
      await side.locator('[aria-label="Send"]').click();
      await side.waitForFunction((n) => {
        const vert = [...document.querySelectorAll("*")].find((e) => e.shadowRoot && e.shadowRoot.querySelector(".m"));
        return vert && vert.shadowRoot.querySelectorAll(".m.a:not(.skriver)").length > n;
      }, forAntall, { timeout: 60000 });
      const svar = await side.locator(".m.a:not(.skriver)").last().innerText();
      sjekk(svar.length > 10 && !/svarer ikke/i.test(svar), "Sekretæren svarer i chatten", svar);
      await side.screenshot({ path: "testbilder/chat-mobil.png" });
    } catch (e) {
      sjekk(false, "Chatten virker i nettleseren", e.message.split("\n")[0]);
      await side.screenshot({ path: "testbilder/chat-feil.png" }).catch(() => {});
    }
    await side.close();
  }
} finally {
  await nettleser.close();
}

console.log(`\n${feil ? feil + " feil" : "Alt OK"}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Nettleseren (som en kunde)\n\n| | Sjekk | Detaljer |\n|---|---|---|\n${rader.join("\n")}\n\n`);
}
process.exit(feil ? 1 : 0);
