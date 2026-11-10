// Test av sikkerhetsreglene i orvelo-sekretar (ingen nøkler trengs, xAI og GitHub etterlignes):
//   - firmakoden virker bare for sitt eget firma, og utløper
//   - den gamle felles DEMO_KODE virker bare for den innebygde demoen og firmaene i DEMO_KODE_KUNDER
//   - kvote på stemmesamtaler per demo og for alle demoer, og på chatmeldinger i prøvemodus
//   - sidene hentes fra en låst commit, aldri fra main
//   - SALG_AV stopper salgsmotoren likt i cron og i salgRunde
//
//   node tools/test-sikkerhet.mjs
import worker from "../worker/sekretar-worker.js";

const lager = new Map();
const KV = {
  get: async (k, t) => (lager.has(k) ? (t === "json" ? JSON.parse(lager.get(k)) : lager.get(k)) : null),
  put: async (k, v) => { lager.set(k, String(v)); },
  delete: async (k) => { lager.delete(k); },
  list: async ({ prefix = "" }) => ({ keys: [...lager.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
};
const profil = (navn) => JSON.stringify({ navn, kortnavn: navn, bransje: "frisør", type: "time", tjenester: [["Klipp", [["Dameklipp", "600 kr", 45]]]], apent: {}, apentTekst: "" });
await KV.put("kunde:firma-a", profil("Firma A"));
await KV.put("kunde:firma-b", profil("Firma B"));
await KV.put("kunde:deja-vu-frisor-089t", profil("Deja Vu"));
await KV.put("demokode:firma-a", "akode12345"); await KV.put("dkode:akode12345", "firma-a");
await KV.put("demokode:firma-b", "bkode12345"); await KV.put("dkode:bkode12345", "firma-b");

const env = { XAI_API_KEY: "x", ADMIN_KODE: "admin", DEMO_KODE: "felles", KUNDER: KV, DEMO_TALE_DAG: "3", DEMO_TALE_ALLE: "5", DEMO_CHAT_DAG: "2" };

const hentet = [];
globalThis.fetch = async (u) => {
  u = String(u);
  if (u.includes("api.x.ai/v1/realtime/client_secrets")) return Response.json({ value: "hemmelig", expires_at: 1 });
  if (u.includes("api.x.ai/v1/chat/completions")) return Response.json({ choices: [{ message: { role: "assistant", content: "Hei!" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  if (u.includes("raw.githubusercontent.com")) { hentet.push(u); return new Response("<html>side</html>"); }
  return new Response("{}", { status: 200 });
};

let feil = 0;
const sjekk = (ok, t) => { console.log((ok ? "OK   " : "FEIL ") + t); if (!ok) feil++; };
let ipNr = 0;
async function kall(sti, { body, e = env, metode } = {}) {
  const vent = [];
  const init = { method: metode || (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", "CF-Connecting-IP": "10.0.0." + (++ipNr) } };
  if (body) init.body = JSON.stringify(body);
  const r = await worker.fetch(new Request("https://x.dev" + sti, init), e, { waitUntil: (p) => vent.push(p) });
  const d = r.headers.get("Content-Type")?.includes("json") ? await r.json() : await r.text();
  await Promise.all(vent);
  return { status: r.status, d };
}

// 1. Firmakoden virker bare for sitt eget firma
sjekk((await kall("/kunde?id=firma-a&k=akode12345")).status === 200, "firma A sin kode åpner firma A");
sjekk((await kall("/kunde?id=firma-b&k=akode12345")).status === 401, "firma A sin kode åpner IKKE firma B");
sjekk((await kall("/token", { body: { k: "akode12345" } })).status === 401, "firmakode uten kunde-id gir ikke stemme");
sjekk((await kall("/token", { body: { k: "akode12345", kunde: "firma-b" } })).status === 401, "firmakode gir ikke stemme hos et annet firma");
sjekk(!!(await KV.get("demoutl:firma-a")), "gamle firmakoder får utløpsdato første gang de brukes");

// 2. Den felles koden: bare innebygd demo og firmaene på listen
sjekk((await kall("/kunde?id=firma-a&k=felles")).status === 401, "felles kode åpner IKKE vilkårlige firmaer (hullet er tett)");
sjekk((await kall("/kunde?id=deja-vu-frisor-089t&k=felles")).status === 200, "felles kode virker fortsatt for Deja Vu (lenken de har fått)");
sjekk((await kall("/token", { body: { k: "felles" } })).status === 200, "felles kode virker for den innebygde demoen");
sjekk((await kall("/kunde?id=deja-vu-frisor-089t&k=felles", { e: { ...env, DEMO_KODE_KUNDER: "" } })).status === 401, "DEMO_KODE_KUNDER tom = felles kode gjelder ingen firmaer");
sjekk((await kall("/token", { body: { k: "felles" }, e: { ...env, DEMO_KODE_UTLOPER: "2020-01-01" } })).status === 401, "felles kode slutter å virke etter DEMO_KODE_UTLOPER");
sjekk((await kall("/kunde?id=firma-a&k=feil")).status === 401, "feil kode avvises");

// 3. Utløp av firmakoden
await KV.put("demoutl:firma-a", new Date(Date.now() - 1000).toISOString());
const utlopt = await kall("/kunde?id=firma-a&k=akode12345");
sjekk(utlopt.status === 401 && /utløpt/.test(utlopt.d.feil), "utløpt firmakode avvises: " + utlopt.d.feil);
let r = await kall("/rediger/lenke", { body: { kode: "admin", id: "firma-a" } });
sjekk(r.status === 200 && r.d.lenke.includes("k=akode12345"), "Preben lager lenken på nytt: samme kode");
sjekk((await kall("/kunde?id=firma-a&k=akode12345")).status === 200, "... og den virker igjen i 30 nye dager");

// 4. Kvote på stemme: 3 per demo, 5 til sammen (i testen)
lager.forEach((_, k) => k.startsWith("kvote:") && lager.delete(k));
const tale = [];
for (let i = 0; i < 4; i++) tale.push((await kall("/token", { body: { k: "akode12345", kunde: "firma-a" } })).status);
sjekk(tale.join() === "200,200,200,429", "firma A: 3 samtaler, så stopp (" + tale.join() + ")");
const tale2 = [];
for (let i = 0; i < 3; i++) tale2.push((await kall("/token", { body: { k: "bkode12345", kunde: "firma-b" } })).status);
sjekk(tale2.join() === "200,200,429", "alle demoer til sammen stopper på 5 (" + tale2.join() + ")");

// 5. Kvote på chat i prøvemodus
const chat = [];
for (let i = 0; i < 3; i++) chat.push((await kall("/chat/melding", { body: { kunde: "firma-b", k: "bkode12345", meldinger: [{ role: "user", content: "hei" }] } })).d.svar);
sjekk(chat[0] === "Hei!" && chat[1] === "Hei!" && /grense/.test(chat[2]), "chat i prøvemodus stopper etter 2 meldinger");

// 6. Sidene hentes fra en låst commit
hentet.length = 0;
await kall("/");
await kall("/chat.js");
sjekk(hentet.length === 2 && hentet.every((u) => /\/[0-9a-f]{40}\//.test(u) && !u.includes("/main/")), "demosiden og chat.js hentes fra en commit, ikke main");
hentet.length = 0;
const sha = "0123456789abcdef0123456789abcdef01234567";
await kall("/chat.js", { e: { ...env, GH_REF: sha } });
sjekk(hentet[0]?.includes("/" + sha + "/"), "GH_REF fra deployen bestemmer versjonen");
hentet.length = 0;
await kall("/chat.js", { e: { ...env, GH_REF: "main" } });
sjekk(hentet[0] && !hentet[0].includes("/main/"), "GH_REF=main godtas ikke (faller tilbake til låst versjon)");
r = await kall("/helse");
sjekk(r.status === 200 && r.d.ok === true && /^[0-9a-f]{40}$/.test(r.d.versjon) && !Object.values(r.d).includes("admin") && !Object.values(r.d).includes("felles"), "/helse svarer uten hemmeligheter");

// 7. SALG_AV: samme regel i cron og salgRunde
for (const [verdi, forventAv] of [["ja", true], ["true", true], ["1", true], ["nei", false], ["", false]]) {
  const e = { ...env, SALG_AV: verdi };
  const h = await kall("/helse", { e });
  sjekk(h.d.salgAv === forventAv, `SALG_AV="${verdi}" -> ${forventAv ? "av" : "på"}`);
}

console.log(feil ? `\n${feil} feil` : "\nAlt OK");
process.exit(feil ? 1 : 0);
