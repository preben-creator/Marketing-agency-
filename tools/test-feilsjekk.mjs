// Test av feilsjekken etter hver telefonsamtale: orvelo-ring finner feil med (etterlignet) Grok og lagrer forslag,
// Preben godtar/avviser på /drift i orvelo-sekretar, og godtatte regler kommer med i instruksjonene neste gang.
//
//   node tools/test-feilsjekk.mjs
import { feilsjekk, hentLaerdom, laerdomTekst, laerdomId, sesjon } from "../worker/ringeagent-worker.js";
import sekretar from "../worker/sekretar-worker.js";

const lager = new Map();
const KV = {
  get: async (k, t) => (lager.has(k) ? (t === "json" ? JSON.parse(lager.get(k).v) : lager.get(k).v) : null),
  put: async (k, v, o = {}) => { lager.set(k, { v: String(v), metadata: o.metadata }); },
  delete: async (k) => { lager.delete(k); },
  list: async ({ prefix = "" }) => ({ keys: [...lager.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: lager.get(name).metadata })), list_complete: true }),
};
let sendt = null;
globalThis.fetch = async (u, o) => {
  if (String(u).includes("api.x.ai/v1/chat/completions")) {
    sendt = JSON.parse(o.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ feil: [
      { hva: "Byttet ikke til Eva", sitat: "Jeg går for den kvinnelige", regel: "Når innringeren ber om kvinnelig sekretær, bytt til Eva med en gang.", alvor: "hoy" },
      { hva: "Gjentok nummer", sitat: "41232557", regel: "Ring 41232557 tilbake.", alvor: "lav" },
    ] }) } }] }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
};

let feil = 0;
const sjekk = (ok, t) => { console.log((ok ? "OK   " : "FEIL ") + t); if (!ok) feil++; };
const env = { XAI_API_KEY: "x", ADMIN_KODE: "admin", KUNDER: KV };
const logg = ["[0:01] Petter: God dag! Mannlig eller kvinnelig?", "[0:04] Kunde: Jeg går for den kvinnelige, ring meg på 412 32 557", "[0:06] Petter: Flott! Hvilket firma ringer du fra?", "[0:09] Kunde: Murmester Hilleren"];

sjekk(laerdomId({ linje: "lia-ror" }) === "lia-ror" && laerdomId({ inn: true }) === "orvelo", "id per telefonlinje, ellers orvelo");
const rec = await feilsjekk(env, "orvelo", logg, [], "demonummeret");
sjekk(rec && rec.funn.length === 2 && rec.funn[0].status === "ny", "to funn lagret som nye");
sjekk(!sendt.messages[1].content.includes("412 32 557"), "nummeret sendes ikke til Grok");
sjekk(!JSON.stringify(rec).includes("41232557"), "nummer fjernet fra lagrede forslag");
sjekk(await feilsjekk(env, "orvelo", logg.slice(0, 2), [], "demonummeret") === null, "for kort samtale sjekkes ikke");
sjekk(await feilsjekk({ ...env, FEILSJEKK: "av" }, "orvelo", logg, [], "x") === null, "FEILSJEKK=av slår det av");

async function api(body) {
  const r = await sekretar.fetch(new Request("https://x.dev/drift/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kode: "admin", ...body }) }), env, { waitUntil() {} });
  return { status: r.status, d: await r.json() };
}
let r = await api({ handling: "feilsjekk-liste", kode: "feil" });
sjekk(r.status === 401, "feil admin-kode avvises");
r = await api({ handling: "feilsjekk-liste", id: "orvelo" });
sjekk(r.status === 200 && r.d.samtaler.length === 1 && r.d.ubesvart === 2, "/drift viser samtalen og 2 ubesvarte forslag");
const key = r.d.samtaler[0].key;
r = await api({ handling: "feilsjekk-svar", id: "orvelo", key, nr: 0, svar: "godta", regel: "Ber innringeren om kvinnelig sekretær, bytt til Eva med en gang." });
sjekk(r.status === 200 && r.d.laerdom.length === 1, "godtatt regel lagret (med Prebens retting)");
r = await api({ handling: "feilsjekk-svar", id: "orvelo", key, nr: 1, svar: "avvis" });
sjekk(r.status === 200 && r.d.laerdom.length === 1, "avvist forslag blir ikke regel");
r = await api({ handling: "feilsjekk-liste", id: "orvelo" });
sjekk(r.d.ubesvart === 0 && r.d.samtaler[0].funn.map((f) => f.status).join() === "godtatt,avvist", "status oppdatert");
r = await api({ handling: "feilsjekk-svar", id: "annen", key, nr: 0, svar: "godta" });
sjekk(r.status === 400, "kan ikke svare på en annen telefons samtale");
r = await api({ handling: "feilsjekk-ny-regel", id: "orvelo", regel: "Si «ha det» til slutt." });
sjekk(r.d.laerdom.length === 2, "egen regel lagt til");

const laerdom = await hentLaerdom(env, "orvelo");
const tekst = sesjon(env, { inn: true, velgStemme: true, til: "+4741232557", laerdom }).instructions;
sjekk(/LÆRDOMMER FRA TIDLIGERE SAMTALER[\s\S]*bytt til Eva med en gang[\s\S]*Si «ha det» til slutt/.test(tekst), "reglene står i instruksjonene til neste samtale");
sjekk(laerdomTekst([]) === "", "ingen regler gir ingen tekst");
r = await api({ handling: "feilsjekk-fjern", id: "orvelo", nr: 0 });
sjekk(r.d.laerdom.length === 1 && r.d.laerdom[0].regel.startsWith("Si"), "regel kan fjernes");

console.log(feil ? `\n${feil} feil` : "\nAlt OK");
process.exit(feil ? 1 : 0);
