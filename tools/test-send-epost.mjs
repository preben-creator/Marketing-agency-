// Test av «Send nå» fra kontrollrommet: /drift/send og handlingen send-epost i /drift/api.
// Resend er etterlignet, så ingen e-post går ut.   node tools/test-send-epost.mjs
import worker from "../worker/sekretar-worker.js";
const lager = new Map();
const KV = {
  get: async (k, t) => (lager.has(k) ? (t === "json" ? JSON.parse(lager.get(k)) : lager.get(k)) : null),
  put: async (k, v) => { lager.set(k, String(v)); }, delete: async (k) => { lager.delete(k); },
  list: async ({ prefix = "" }) => ({ keys: [...lager.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
};
const env = { ADMIN_KODE: "admin", KUNDER: KV, RESEND_API_KEY: "test", GITHUB_RAW: "https://raw.test/" };
const sendt = [];
globalThis.fetch = async (u, o) => {
  if (String(u).includes("api.resend.com")) { sendt.push(JSON.parse(o.body)); return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); }
  if (String(u).includes("snakk/send.html")) return new Response("<!doctype html><title>Send</title>", { status: 200 });
  return new Response("", { status: 404 });
};
let feil = 0; const ok = (v, t) => { console.log((v ? "OK   " : "FEIL ") + t); if (!v) feil++; };
const api = (b, origin = "https://w.test") => worker.fetch(new Request("https://w.test/drift/api", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(b) }), env, { waitUntil() {} });
const html = '<p>Hei <a href="https://orvelo.no/demo/?fag=ror">demo</a></p>';

let r = await worker.fetch(new Request("https://w.test/drift/send"), env, { waitUntil() {} });
ok(r.status === 200 && (await r.text()).includes("Send"), "GET /drift/send gir siden");
r = await api({ kode: "feil", handling: "send-epost", til: "post@firma.no", emne: "x", html });
ok(r.status === 401, "feil admin-kode avvises");
r = await api({ kode: "admin", handling: "send-epost", til: "post@firma.no", emne: "x", html }, "https://ondsinnet.test");
ok(r.status === 403, "annen origin avvises");
r = await api({ kode: "admin", handling: "send-epost", til: "ikke-en-adresse", emne: "x", html });
ok(r.status === 400, "ugyldig adresse avvises");
r = await api({ kode: "admin", handling: "send-epost", til: "Post@Firma.no", emne: "Demo til Firma AS", html, tekst: "Hei", orgnr: "912 345 678", firma: "Firma AS" });
const d = await r.json();
ok(r.status === 200 && d.ok && d.id === "re_1", "sender via Resend");
const m = sendt.at(-1) || {};
ok(m.to && m.to[0] === "post@firma.no", "til er riktig og med små bokstaver");
ok(/salg@orvelo\.no/.test(m.from) && m.reply_to === "orvelo@epost.no", "fra salg@orvelo.no, svar til orvelo@epost.no");
ok(m.html === html && m.html.includes('href="https://orvelo.no/demo/?fag=ror"'), "lenkene er urørte");
ok(m.headers && /avmeld\?o=912345678/.test(m.headers["List-Unsubscribe"]), "List-Unsubscribe med orgnr");
await KV.put("salgsperre:e:stopp@firma.no", "{}");
const før = sendt.length;
r = await api({ kode: "admin", handling: "send-epost", til: "stopp@firma.no", emne: "x", html });
ok(r.status === 400 && sendt.length === før, "sperret adresse får ingenting");
r = await api({ kode: "admin", handling: "send-epost", til: "a@b.no", emne: "", html });
ok(r.status === 400, "mangler emne avvises");
console.log(feil ? feil + " feil" : "Alle tester OK"); process.exit(feil ? 1 : 0);
