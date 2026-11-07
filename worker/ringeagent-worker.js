// Orvelo ringeagent: Cloudflare Worker
//
// Flyt:
//   1. Kunden åpner «ring meg»-siden (GET /), skriver inn mobilnummer og krysser av for samtykke.
//   2. POST /kode  -> vi sender en SMS-kode for å bekrefte at nummeret er kundens eget (dobbelt samtykke).
//   3. POST /ring  -> riktig kode? Da ringer Twilio kunden, og samtalen kobles til Grok (KI-agenten).
//   4. GET  /media -> WebSocket mellom Twilio (telefonlyd) og xAI realtime (Grok-stemmen).
//   Under samtalen kan agenten sende bookinglenken på SMS og sende Preben et sammendrag på e-post.
//
// Innstillinger (Cloudflare: Worker -> Settings -> Variables and Secrets):
//   XAI_API_KEY          (Secret, påkrevd)  xAI-nøkkelen
//   TWILIO_ACCOUNT_SID   (Secret, påkrevd)  fra Twilio-forsiden
//   TWILIO_AUTH_TOKEN    (Secret, påkrevd)  fra Twilio-forsiden
//   TWILIO_FROM          (Text,   påkrevd)  Twilio-nummeret, f.eks. +4712345678
//   BOOKING_URL          (Text,   valgfri)  Google Avtaleplan-lenken
//   VARSEL_EPOST         (Text,   valgfri)  hvor sammendrag sendes (via FormSubmit)
//   STEMME               (Text,   valgfri)  Grok-stemme, standard «ara»
//   SMS_AVSENDER         (Text,   valgfri)  navnet SMS-ene kommer fra, standard «Orvelo» (tom = Twilio-nummeret)
//   TEST_NUMMER          (Text,   valgfri)  ditt eget nummer: hopper over SMS-koden (koden blir 0000) mens Twilio er prøvekonto

const BOOKING_URL_DEFAULT = "https://calendar.app.google/24niGvpRRwPqNqr28";
const VARSEL_EPOST_DEFAULT = "hilleren.bedrift@gmail.com";
const MODEL = "grok-voice-latest";
const MAKS_SEK = 480; // Twilio legger på etter 8 minutter uansett
const KODE_GYLDIG_MS = 10 * 60 * 1000;

// ---------- små hjelpere ----------

const enc = new TextEncoder();

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function likt(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Godtar norske mobilnumre (4xx xx xxx / 9xx xx xxx), med eller uten +47.
export function normaliserNummer(input) {
  let s = String(input || "").replace(/[\s\-().]/g, "");
  if (s.startsWith("0047")) s = "+47" + s.slice(4);
  if (/^[49]\d{7}$/.test(s)) s = "+47" + s;
  return /^\+47[49]\d{7}$/.test(s) ? s : null;
}

function xmlEsc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Enkel bremse per nøkkel (per Cloudflare-instans).
const treff = new Map();
function forMange(nokkel, maks, vinduMs) {
  const naa = Date.now();
  const liste = (treff.get(nokkel) || []).filter((t) => naa - t < vinduMs);
  if (liste.length >= maks) { treff.set(nokkel, liste); return true; }
  liste.push(naa);
  treff.set(nokkel, liste);
  if (treff.size > 5000) treff.clear();
  return false;
}

async function twilio(env, sti, felter) {
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/${sti}`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(felter),
  });
  const tekst = await r.text();
  if (!r.ok) console.log("Twilio svarte", r.status, tekst.slice(0, 400));
  return { ok: r.ok, status: r.status, tekst };
}

// Gjør Twilios feilsvar om til en kort tekst, f.eks. «Twilio 21408: Permission to send an SMS has not been enabled ...».
function twilioFeil(r) {
  try { const d = JSON.parse(r.tekst); return `Twilio ${d.code || r.status}: ${d.message || ""}`.trim(); } catch {}
  return `HTTP ${r.status}`;
}

// SMS sendes med avsendernavnet «Orvelo» (Norge godtar alfanumerisk avsender).
// Hvis Twilio avviser det, prøver vi på nytt fra Twilio-nummeret.
async function sendSms(env, til, tekst) {
  const navn = env.SMS_AVSENDER === undefined ? "Orvelo" : env.SMS_AVSENDER;
  if (navn) {
    const r = await twilio(env, "Messages.json", { To: til, From: navn, Body: tekst });
    if (r.ok) return r;
  }
  return twilio(env, "Messages.json", { To: til, From: env.TWILIO_FROM, Body: tekst });
}

async function varsle(env, emne, felter) {
  try {
    const r = await fetch(`https://formsubmit.co/ajax/${env.VARSEL_EPOST || VARSEL_EPOST_DEFAULT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ _subject: emne, _template: "table", ...felter }),
    });
    if (!r.ok) console.log("FormSubmit svarte", r.status);
  } catch (e) {
    console.log("Varsel feilet", e && e.message);
  }
}

// ---------- KI-agenten ----------

function instruksjoner(navn, firma) {
  const hvem = [navn, firma].filter(Boolean).join(" fra ");
  return `Du er Ara, en KI-assistent som ringer på vegne av Orvelo, et lite norsk selskap i Bergen drevet av Preben Hilleren.
Du snakker norsk (bokmål), varmt, rolig og kort, som i en vanlig telefonsamtale. Maks to-tre setninger om gangen, og la kunden snakke.

Hvorfor du ringer: Kunden${hvem ? ` (${hvem})` : ""} har selv bedt om å bli ringt opp via nettsiden til Orvelo for å høre hvordan en KI-sekretær høres ut.
Du er selv et eksempel på tjenesten. Si alltid tydelig i starten at du er en KI og ikke et menneske.

Om tjenesten Orvelo KI-sekretær:
- Svarer telefonen for bedriften døgnet rundt når eieren er opptatt, for eksempel midt i en jobb eller med en kunde i stolen.
- Snakker naturlig norsk, svarer på spørsmål om priser, åpningstider og tjenester, tar imot bestillinger og beskjeder, og sender eieren en kort oppsummering på SMS eller e-post.
- Laget for håndverkere, frisører og andre små bedrifter som mister kunder når telefonen ikke blir tatt.
- Settes opp av Preben, tilpasset bedriften (prisliste, åpningstider, hva den skal svare på).
- Pris: avhenger av bedriften og avtales med Preben i møtet. Ikke nevn tall. Si at det er en fast månedspris uten store investeringer.
- Personvern, avtalevilkår, integrasjon med bookingsystem og tekniske detaljer: si at Preben går gjennom det i møtet. Ikke finn på noe.

Målet med samtalen: Forklar kort, svar på spørsmål, og foreslå et uforpliktende møte på 30 minutter med Preben.
- Hvis kunden vil ha møte: bruk verktøyet send_bookinglenke. Si at de får en SMS nå med en lenke der de velger tidspunkt som passer, og at møtet havner rett i kalenderen til Preben.
- Hvis kunden heller vil bli ringt av Preben, eller nevner et bestemt tidspunkt: bruk verktøyet noter_for_preben med det kunden ønsket.
- Uansett utfall: før du avslutter, bruk noter_for_preben med et kort sammendrag (interesse, bransje, spørsmål, ønsket tid).
- Hvis kunden ikke er interessert: takk høflig, noter det, og avslutt. Ikke mas.
- Når samtalen er ferdig og du har sagt ha det: bruk verktøyet legg_paa.
Hvis du hører en telefonsvarer eller ingen svarer: si én kort setning om at Orvelo ringte som avtalt og at de kan booke på nettsiden, og bruk legg_paa.`;
}

const VERKTOY = [
  {
    type: "function",
    name: "send_bookinglenke",
    description: "Send kunden en SMS med lenken der de booker et 30-minutters møte med Preben.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "noter_for_preben",
    description: "Send Preben et kort sammendrag av samtalen. Bruk før du avslutter, og når kunden ønsker et bestemt tidspunkt eller å bli ringt av Preben.",
    parameters: {
      type: "object",
      properties: {
        interesse: { type: "string", enum: ["høy", "middels", "lav", "ingen"] },
        bransje: { type: "string" },
        onsket_tid: { type: "string", description: "Tidspunkt kunden ønsket for møte eller oppringing, hvis noe." },
        sammendrag: { type: "string" },
      },
      required: ["interesse", "sammendrag"],
    },
  },
  {
    type: "function",
    name: "legg_paa",
    description: "Avslutt telefonsamtalen. Bruk bare etter at du har sagt ha det.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

async function koblSamtale(env, twilioWs) {
  let streamSid = null;
  let callSid = null;
  let kunde = {};
  let xai = null;
  let lenkeSendt = false;
  let notat = null; // sammendraget agenten skriver
  let rapportSendt = false;
  const logg = []; // hele samtalen, som tekst
  const tid = () => {
    const sek = Math.round((Date.now() - startet) / 1000);
    return `${Math.floor(sek / 60)}:${String(sek % 60).padStart(2, "0")}`;
  };
  const startet = Date.now();
  const ventende = []; // lyd fra kunden før Grok er klar

  const tilTwilio = (obj) => { try { twilioWs.send(JSON.stringify(obj)); } catch {} };
  const tilXai = (obj) => { if (xai && xai.readyState === 1) xai.send(JSON.stringify(obj)); };

  async function leggPaa(etterMs) {
    await new Promise((r) => setTimeout(r, etterMs));
    if (callSid) await twilio(env, `Calls/${callSid}.json`, { Status: "completed" });
    try { twilioWs.close(1000, "ferdig"); } catch {}
    try { xai && xai.close(1000, "ferdig"); } catch {}
  }

  async function kjorVerktoy(navn, args) {
    if (navn === "send_bookinglenke") {
      if (lenkeSendt) return { ok: true, melding: "Lenken er allerede sendt." };
      const r = await sendSms(env, kunde.til,
        `Hei! Her er lenken for å booke et uforpliktende møte (30 min) med Preben i Orvelo: ${env.BOOKING_URL || BOOKING_URL_DEFAULT}`);
      lenkeSendt = r.ok;
      return r.ok ? { ok: true, melding: "SMS med bookinglenke er sendt." } : { ok: false, melding: "SMS feilet. Si at Preben sender lenken." };
    }
    if (navn === "noter_for_preben") {
      notat = args;
      return { ok: true };
    }
    if (navn === "legg_paa") {
      leggPaa(3500);
      return { ok: true };
    }
    return { ok: false, melding: "Ukjent verktøy" };
  }

  async function startGrok() {
    const r = await fetch(`https://api.x.ai/v1/realtime?model=${MODEL}`, {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${env.XAI_API_KEY}` },
    });
    if (!r.webSocket) {
      console.log("Fikk ikke kontakt med xAI", r.status, (await r.text()).slice(0, 300));
      leggPaa(0);
      return;
    }
    xai = r.webSocket;
    xai.accept();
    tilXai({
      type: "session.update",
      session: {
        voice: env.STEMME || "ara",
        instructions: instruksjoner(kunde.navn, kunde.firma),
        tools: VERKTOY,
        turn_detection: { type: "server_vad" },
        audio: {
          input: { format: { type: "audio/pcmu" }, transcription: { language_hint: "no", keyterms: ["Orvelo", "Preben", "KI-sekretær"] } },
          output: { format: { type: "audio/pcmu" } },
        },
      },
    });
    const hei = kunde.navn ? `Hei, ${kunde.navn.split(" ")[0]}!` : "Hei!";
    tilXai({
      type: "conversation.item.create",
      item: {
        type: "force_message", role: "assistant", interruptible: true,
        content: [{ type: "output_text", text: `${hei} Dette er Ara, en KI-assistent fra Orvelo. Du ba om å bli ringt for å høre hvordan en KI-sekretær høres ut, så her er jeg! Har du et par minutter?` }],
      },
    });
    while (ventende.length) tilXai({ type: "input_audio_buffer.append", audio: ventende.shift() });

    xai.addEventListener("message", async (m) => {
      let e;
      try { e = JSON.parse(m.data); } catch { return; }
      const t = e.type;
      if (t === "response.output_audio.delta" || t === "response.audio.delta") {
        if (streamSid) tilTwilio({ event: "media", streamSid, media: { payload: e.delta } });
        return;
      }
      if (t === "response.output_audio_transcript.done" || t === "response.audio_transcript.done") {
        if (e.transcript && e.transcript.trim()) logg.push(`[${tid()}] Ara: ${e.transcript.trim()}`);
        return;
      }
      if (t.includes("input_audio_transcription.completed")) {
        if (e.transcript && e.transcript.trim()) logg.push(`[${tid()}] Kunde: ${e.transcript.trim()}`);
        return;
      }
      if (t === "input_audio_buffer.speech_started") {
        if (streamSid) tilTwilio({ event: "clear", streamSid });
        return;
      }
      if (t === "response.function_call_arguments.done") {
        let args = {};
        try { args = JSON.parse(e.arguments || "{}"); } catch {}
        const res = await kjorVerktoy(e.name, args);
        tilXai({ type: "conversation.item.create", item: { type: "function_call_output", call_id: e.call_id, output: JSON.stringify(res) } });
        if (e.name !== "legg_paa") tilXai({ type: "response.create" });
        return;
      }
      if (t === "error") console.log("xAI-feil", JSON.stringify(e).slice(0, 300));
    });
    xai.addEventListener("close", () => { try { twilioWs.close(1000, "grok lukket"); } catch {} });
  }

  twilioWs.addEventListener("message", async (m) => {
    let e;
    try { e = JSON.parse(m.data); } catch { return; }
    if (e.event === "media") {
      if (xai && xai.readyState === 1) tilXai({ type: "input_audio_buffer.append", audio: e.media.payload });
      else if (ventende.length < 250) ventende.push(e.media.payload);
      return;
    }
    if (e.event === "start") {
      streamSid = e.start.streamSid;
      callSid = e.start.callSid;
      const p = e.start.customParameters || {};
      // Sjekk at samtalen faktisk ble startet av /ring (signert), ellers legg på.
      const forventet = await hmac(env.TWILIO_AUTH_TOKEN, `samtale|${p.til}|${p.ts}`);
      if (!likt(p.sig, forventet) || Date.now() - Number(p.ts) > 15 * 60 * 1000) {
        console.log("Ugyldig samtale-signatur");
        try { twilioWs.close(1008, "ugyldig"); } catch {}
        return;
      }
      kunde = { til: p.til, navn: p.navn || "", firma: p.firma || "" };
      await startGrok();
      return;
    }
    if (e.event === "stop") {
      try { xai && xai.close(1000, "lagt på"); } catch {}
      await sendRapport();
    }
  });
  twilioWs.addEventListener("close", async () => {
    try { xai && xai.close(1000, "lagt på"); } catch {}
    await sendRapport();
  });

  // Én e-post per samtale: sammendrag + hele samtalen som tekst.
  async function sendRapport() {
    if (rapportSendt || !kunde.til) return;
    rapportSendt = true;
    const n = notat || {};
    await varsle(env, `Orvelo-samtale: ${kunde.firma || kunde.til} (interesse: ${n.interesse || "ukjent"})`, {
      Nummer: kunde.til, Navn: kunde.navn || "", Firma: kunde.firma || "",
      Tidspunkt: new Date(startet).toISOString(),
      Varighet: tid(),
      Interesse: n.interesse || "", Bransje: n.bransje || "", "Ønsket tid": n.onsket_tid || "",
      Sammendrag: n.sammendrag || "Agenten skrev ikke sammendrag (kunden la kanskje på).",
      "Bookinglenke sendt": lenkeSendt ? "ja" : "nei",
      Samtale: logg.length ? logg.join("\n") : "(ingen tekst registrert)",
    });
  }
}

// ---------- endepunkter ----------

async function kodeEndepunkt(request, env) {
  let b = {};
  try { b = await request.json(); } catch {}
  if (b.nettside) return json({ ok: true }); // felle for roboter
  const til = normaliserNummer(b.nummer);
  if (!til) return json({ feil: "Skriv inn et norsk mobilnummer (8 siffer)." }, 400);
  if (!b.samtykke) return json({ feil: "Du må krysse av for at vi får ringe deg." }, 400);
  const ip = request.headers.get("CF-Connecting-IP") || "ukjent";
  if (forMange("kode:" + ip, 5, 60 * 60 * 1000) || forMange("kode:" + til, 3, 60 * 60 * 1000)) {
    return json({ feil: "Mange forsøk. Prøv igjen senere." }, 429);
  }
  const test = env.TEST_NUMMER && normaliserNummer(env.TEST_NUMMER) === til;
  const kode = test ? "0000" : String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, "0");
  const ts = Date.now();
  const sig = await hmac(env.TWILIO_AUTH_TOKEN, `kode|${til}|${kode}|${ts}`);
  if (test) return json({ ok: true, billett: `${ts}.${sig}`, test: true });
  const r = await sendSms(env, til, `Din kode fra Orvelo: ${kode}`);
  if (!r.ok) return json({ feil: `Fikk ikke sendt SMS (${twilioFeil(r)}).` }, 502);
  return json({ ok: true, billett: `${ts}.${sig}` });
}

async function ringEndepunkt(request, env, url) {
  let b = {};
  try { b = await request.json(); } catch {}
  const til = normaliserNummer(b.nummer);
  if (!til || !b.samtykke) return json({ feil: "Mangler nummer eller samtykke." }, 400);
  if (forMange("ring:" + til, 4, 60 * 60 * 1000)) return json({ feil: "Mange forsøk. Prøv igjen senere." }, 429);
  const [tsTekst, sig] = String(b.billett || "").split(".");
  const ts = Number(tsTekst);
  const kode = String(b.kode || "").replace(/\D/g, "");
  if (!ts || Date.now() - ts > KODE_GYLDIG_MS) return json({ feil: "Koden har gått ut. Be om en ny." }, 400);
  if (!likt(sig, await hmac(env.TWILIO_AUTH_TOKEN, `kode|${til}|${kode}|${ts}`))) {
    return json({ feil: "Feil kode. Sjekk SMS-en og prøv igjen." }, 400);
  }

  const navn = String(b.navn || "").slice(0, 60).trim();
  const firma = String(b.firma || "").slice(0, 80).trim();
  const naa = String(Date.now());
  const samtaleSig = await hmac(env.TWILIO_AUTH_TOKEN, `samtale|${til}|${naa}`);
  const wss = `wss://${url.host}/media`;
  const twiml =
    `<Response><Connect><Stream url="${xmlEsc(wss)}">` +
    `<Parameter name="til" value="${xmlEsc(til)}"/><Parameter name="ts" value="${naa}"/>` +
    `<Parameter name="sig" value="${samtaleSig}"/><Parameter name="navn" value="${xmlEsc(navn)}"/>` +
    `<Parameter name="firma" value="${xmlEsc(firma)}"/></Stream></Connect></Response>`;

  const r = await twilio(env, "Calls.json", { To: til, From: env.TWILIO_FROM, Twiml: twiml, TimeLimit: String(MAKS_SEK) });
  if (!r.ok) return json({ feil: `Fikk ikke ringt (${twilioFeil(r)}).` }, 502);

  // Samtykkelogg: Preben får en e-post per samtykke (tidspunkt, nummer, tekst de krysset av for).
  await varsle(env, `Samtykke: ${firma || til} ba om å bli ringt`, {
    Nummer: til, Navn: navn, Firma: firma, Tidspunkt: new Date().toISOString(),
    "Bekreftet med SMS-kode": "ja", Samtykketekst: SAMTYKKETEKST,
  });
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const mangler = ["XAI_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"].filter((k) => !env[k]);

    if (url.pathname === "/media") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Forventer WebSocket", { status: 426 });
      if (mangler.length) return new Response("Ikke satt opp", { status: 500 });
      const [klient, server] = Object.values(new WebSocketPair());
      server.accept();
      koblSamtale(env, server);
      return new Response(null, { status: 101, webSocket: klient });
    }

    if (request.method === "POST" && (url.pathname === "/kode" || url.pathname === "/ring")) {
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return json({ feil: "Ikke tillatt" }, 403);
      if (mangler.length) return json({ feil: "Tjenesten er ikke satt opp ennå." }, 500);
      return url.pathname === "/kode" ? kodeEndepunkt(request, env) : ringEndepunkt(request, env, url);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(side(url.searchParams.get("firma") || "", env.BOOKING_URL || BOOKING_URL_DEFAULT), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Robots-Tag": "noindex" },
      });
    }

    return new Response("Ikke funnet", { status: 404 });
  },
};

// ---------- «ring meg»-siden ----------

const SAMTYKKETEKST =
  "Jeg ber om at Orvelo ringer meg én gang på dette nummeret med en KI-assistent (automatisk stemme) " +
  "for å fortelle om KI-sekretær-tjenesten og avtale et møte.";

export function side(firma, bookingUrl) {
  const f = xmlEsc(firma.slice(0, 80));
  return `<!doctype html>
<html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hør KI-sekretæren · Orvelo</title>
<style>
:root{--bg:#f6f7fb;--kort:#fff;--tekst:#141826;--dempet:#5b6275;--aksent:#5b5bf0;--aksent2:#3d3dd0;--kant:#e3e6ef;--feil:#c62828;--ok:#1b7f4b}
@media (prefers-color-scheme:dark){:root{--bg:#0e1018;--kort:#171a26;--tekst:#eef0f7;--dempet:#a3a9bd;--aksent:#8a8aff;--aksent2:#a5a5ff;--kant:#2a2f42;--feil:#ff8a80;--ok:#6fdc9f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tekst);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:460px;margin:0 auto;padding:40px 16px}
.kort{background:var(--kort);border:1px solid var(--kant);border-radius:16px;padding:24px}
h1{font-size:1.6rem;line-height:1.25;margin:0 0 8px}p{margin:0 0 16px;color:var(--dempet)}
label{display:block;font-weight:600;margin:14px 0 6px}input[type=text],input[type=tel]{width:100%;padding:12px;border:1px solid var(--kant);border-radius:10px;background:transparent;color:inherit;font:inherit}
.sjekk{display:flex;gap:10px;align-items:flex-start;margin:16px 0;font-size:.9rem;color:var(--dempet)}.sjekk input{margin-top:4px;width:18px;height:18px;flex:none}
button{width:100%;padding:14px;border:0;border-radius:10px;background:var(--aksent);color:#fff;font:600 1rem inherit;cursor:pointer}button:hover{background:var(--aksent2)}button:disabled{opacity:.6;cursor:wait}
.melding{margin-top:12px;font-size:.95rem}.melding.feil{color:var(--feil)}.melding.ok{color:var(--ok)}
.skjult{display:none}.felle{position:absolute;left:-9999px}.liten{font-size:.85rem;margin-top:18px}.liten a{color:var(--aksent)}
</style></head><body><main><div class="kort">
<h1>Hør hvordan en KI-sekretær høres ut</h1>
<p>Legg inn mobilnummeret ditt, så ringer Ara, vår KI-assistent, deg om et øyeblikk. Hun forteller hvordan Orvelo kan svare telefonen for bedriften din, og kan avtale et kort møte med Preben.</p>
<form id="steg1">
<label for="navn">Navnet ditt</label><input id="navn" type="text" autocomplete="name" maxlength="60">
<label for="firma">Bedrift</label><input id="firma" type="text" value="${f}" maxlength="80">
<label for="nummer">Mobilnummer</label><input id="nummer" type="tel" inputmode="tel" autocomplete="tel" placeholder="912 34 567" required>
<input class="felle" id="nettside" tabindex="-1" autocomplete="off">
<div class="sjekk"><input id="samtykke" type="checkbox" required><label for="samtykke" style="margin:0;font-weight:400">${SAMTYKKETEKST}</label></div>
<button id="knapp1">Send meg en kode</button></form>
<form id="steg2" class="skjult">
<label for="kode">Koden du fikk på SMS</label><input id="kode" type="tel" inputmode="numeric" maxlength="4" autocomplete="one-time-code">
<button id="knapp2" style="margin-top:14px">Ring meg nå</button></form>
<div id="melding" class="melding" role="status"></div>
<p class="liten">Vil du heller booke et møte direkte? <a href="${xmlEsc(bookingUrl)}">Velg en tid her</a>.<br>Nummeret brukes bare til denne ene samtalen.</p>
</div></main>
<script>
const $=id=>document.getElementById(id);let billett="";
function vis(t,k){const m=$("melding");m.textContent=t;m.className="melding "+(k||"");}
function data(){return{navn:$("navn").value,firma:$("firma").value,nummer:$("nummer").value,samtykke:$("samtykke").checked,nettside:$("nettside").value};}
async function post(sti,body){const r=await fetch(sti,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.feil||"Noe gikk galt");return d;}
$("steg1").onsubmit=async e=>{e.preventDefault();$("knapp1").disabled=true;vis("Sender kode …");
 try{const d=await post("/kode",data());billett=d.billett||"";$("steg1").classList.add("skjult");$("steg2").classList.remove("skjult");$("kode").focus();vis(d.test?"Testmodus: koden er 0000.":"Vi har sendt deg en kode på SMS.","ok");}
 catch(err){vis(err.message,"feil");}finally{$("knapp1").disabled=false;}};
$("steg2").onsubmit=async e=>{e.preventDefault();$("knapp2").disabled=true;vis("Ringer deg …");
 try{await post("/ring",{...data(),kode:$("kode").value,billett});vis("Telefonen din ringer om noen sekunder. Ta den!","ok");}
 catch(err){vis(err.message,"feil");$("knapp2").disabled=false;}};
</script></body></html>`;
}
