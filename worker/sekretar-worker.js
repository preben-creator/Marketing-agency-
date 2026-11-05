// Orvelo KI-sekretær: Cloudflare Worker
//
// Gjør to ting:
//   GET  /        -> viser demosiden (hentes fra GitHub-repoet, så siden kan oppdateres uten å røre denne koden)
//   POST /token   -> lager en kortvarig nøkkel (60 sek) slik at nettleseren kan snakke med Grok.
//                    Den ekte XAI_API_KEY forlater aldri denne tjenesten.
//
// Innstillinger (Cloudflare: Worker -> Settings -> Variables and Secrets):
//   XAI_API_KEY  (Secret, påkrevd)  xAI-nøkkelen din
//   DEMO_KODE    (Secret, valgfri)  hvis satt, må lenken ha ?k=<koden>, ellers virker den ikke
//   PAGE_URL     (Text,   valgfri)  adressen til demosiden, standard er filen i GitHub

const PAGE_URL_DEFAULT =
  "https://raw.githubusercontent.com/preben-creator/marketing-agency-/main/snakk/index.html";

// Enkel bremse per IP (per Cloudflare-instans): maks 8 samtaler per 30 minutter.
const WINDOW_MS = 30 * 60 * 1000;
const MAX_PER_WINDOW = 8;
const hits = new Map();

function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

const ALLOWED_ORIGINS = [
  "https://preben-creator.github.io",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
];

function json(body, status, origin) {
  const h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Vary"] = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers: h });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: ALLOWED_ORIGINS.includes(origin)
          ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST",
              "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" }
          : {},
      });
    }

    if (url.pathname === "/token") {
      if (request.method !== "POST") return json({ feil: "Bruk POST" }, 405, origin);
      // Bare fra demosiden selv eller GitHub Pages
      const sameOrigin = origin === url.origin;
      if (origin && !sameOrigin && !ALLOWED_ORIGINS.includes(origin)) {
        return json({ feil: "Ikke tillatt" }, 403, origin);
      }
      if (!env.XAI_API_KEY) return json({ feil: "Demoen er ikke satt opp ennå (mangler nøkkel)." }, 500, origin);

      let body = {};
      try { body = await request.json(); } catch {}
      if (env.DEMO_KODE && body.k !== env.DEMO_KODE) {
        return json({ feil: "Lenken mangler riktig kode. Spør Preben om en ny lenke." }, 401, origin);
      }

      const ip = request.headers.get("CF-Connecting-IP") || "ukjent";
      if (tooMany(ip)) return json({ feil: "Mange samtaler på kort tid. Prøv igjen om litt." }, 429, origin);

      const r = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.XAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expires_after: { seconds: 60 } }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.log("xAI svarte", r.status, t.slice(0, 300));
        return json({ feil: "Sekretæren er ikke tilgjengelig akkurat nå. Prøv igjen senere." }, 502, origin);
      }
      const d = await r.json();
      return json({ value: d.value, expires_at: d.expires_at }, 200, origin);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const r = await fetch(env.PAGE_URL || PAGE_URL_DEFAULT, { cf: { cacheTtl: 60 } });
      if (!r.ok) return new Response("Fant ikke demosiden.", { status: 502 });
      return new Response(await r.text(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
          "X-Robots-Tag": "noindex",
          "Permissions-Policy": "microphone=(self)",
        },
      });
    }

    return new Response("Ikke funnet", { status: 404 });
  },
};
