/* Orvelo chat-boble for kundens nettside.
   Lim inn på nettsiden (rett før </body>):
     <script src="https://orvelo-sekretar.preben-m-hilleren.workers.dev/chat.js" data-kunde="<id>" async></script>
   Valgfritt: data-farge="#2f9e7a"  data-posisjon="venstre"  data-apen="1" (åpen med en gang)
   Serveres av workeren på /chat.js (hentes fra den deployede commiten i GitHub). Endringer her når kundene først når en deploy er godkjent. */
(function () {
  "use strict";
  var s = document.currentScript || document.querySelector('script[src*="/chat.js"][data-kunde]');
  if (!s || window.__orveloChat) return;
  window.__orveloChat = true;
  var API = new URL(s.src, location.href).origin;
  var KUNDE = (s.getAttribute("data-kunde") || "").replace(/[^a-z0-9-]/g, "");
  var K = s.getAttribute("data-k") || "";
  if (!KUNDE) return;
  var LAGER = "orvelo-chat-" + KUNDE;

  function hent(u, o) {
    return fetch(u, o).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.__status = r.status; return d; }); });
  }

  hent(API + "/chat/oppsett?kunde=" + KUNDE + (K ? "&k=" + encodeURIComponent(K) : ""))
    .then(function (c) { if (c && !c.feil && c.navn) bygg(c); })
    .catch(function () {});

  function lysFarge(hex) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 165;
  }
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function format(t) {
    return esc(t)
      .replace(/(https?:\/\/[^\s<]+[^\s<.,!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])((?:\+47[ ]?)?(?:\d[ ]?){8})(?=$|[\s.,)])/g, function (m, a, nr) { return a + '<a href="tel:' + nr.replace(/ /g, "") + '">' + nr + "</a>"; })
      .replace(/\n/g, "<br>");
  }

  function bygg(c) {
    var farge = /^#[0-9a-f]{6}$/i.test(s.getAttribute("data-farge") || "") ? s.getAttribute("data-farge") : (c.farge || "#2f9e7a");
    var tekstFarge = lysFarge(farge) ? "#14141f" : "#ffffff";
    var venstre = (s.getAttribute("data-posisjon") || c.posisjon) === "venstre";
    var meldinger = [];
    try { meldinger = JSON.parse(sessionStorage.getItem(LAGER) || "[]"); } catch (e) {}
    if (!Array.isArray(meldinger) || !meldinger.length) meldinger = [{ role: "assistant", content: c.hilsen }];
    var opptatt = false;
    var OKT = "";
    try { OKT = sessionStorage.getItem(LAGER + "-okt") || ""; } catch (e) {}
    if (!OKT) { OKT = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); try { sessionStorage.setItem(LAGER + "-okt", OKT); } catch (e) {} }

    var vert = document.createElement("div");
    vert.setAttribute("data-orvelo-chat", "");
    vert.style.cssText = "position:fixed;z-index:2147483000;bottom:0;" + (venstre ? "left:0" : "right:0");
    var rot = vert.attachShadow ? vert.attachShadow({ mode: "open" }) : vert;
    rot.innerHTML =
      "<style>" +
      ":host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif}" +
      ".knapp{position:fixed;bottom:20px;" + (venstre ? "left" : "right") + ":20px;display:flex;align-items:center;gap:8px;border:0;cursor:pointer;" +
      "background:" + farge + ";color:" + tekstFarge + ";border-radius:999px;padding:13px 18px 13px 15px;font-size:15px;font-weight:600;" +
      "box-shadow:0 6px 24px rgba(0,0,0,.22);transition:transform .15s}" +
      ".knapp:hover{transform:translateY(-2px)}.knapp svg{width:22px;height:22px;flex:none}" +
      ".panel{position:fixed;bottom:20px;" + (venstre ? "left" : "right") + ":20px;width:370px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 40px);" +
      "background:#fff;color:#1d1d29;border-radius:18px;box-shadow:0 12px 48px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden}" +
      ".panel.apen{display:flex}" +
      ".topp{background:" + farge + ";color:" + tekstFarge + ";padding:14px 14px 13px 16px;display:flex;align-items:center;gap:10px}" +
      ".topp b{display:block;font-size:15.5px;line-height:1.25}.topp small{display:block;font-size:12.5px;opacity:.85;margin-top:1px}" +
      ".topp .t{flex:1;min-width:0}.lukk{background:transparent;border:0;color:inherit;cursor:pointer;font-size:24px;line-height:1;padding:4px 6px;border-radius:8px}" +
      ".lukk:hover{background:rgba(127,127,127,.2)}" +
      ".prik{width:9px;height:9px;border-radius:50%;background:#3ddc84;display:inline-block;margin-right:5px;vertical-align:1px}" +
      ".logg{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:9px;background:#f6f6f9}" +
      ".m{max-width:84%;padding:9px 13px;border-radius:16px;font-size:14.5px;line-height:1.45;white-space:normal;word-wrap:break-word}" +
      ".m a{color:inherit;text-decoration:underline}" +
      ".a{background:#fff;border:1px solid #e6e6ee;align-self:flex-start;border-bottom-left-radius:5px}" +
      ".u{background:" + farge + ";color:" + tekstFarge + ";align-self:flex-end;border-bottom-right-radius:5px}" +
      ".info{align-self:center;font-size:12.5px;color:#4b4b5c;background:#e9f7ef;border-radius:10px;padding:6px 10px;text-align:center}" +
      ".feil{align-self:center;font-size:13px;color:#8a1c1c;background:#fde8e8;border-radius:10px;padding:6px 10px}" +
      ".skriver{display:flex;gap:4px;padding:12px 14px}.skriver i{width:7px;height:7px;border-radius:50%;background:#9a9aad;animation:h 1s infinite}" +
      ".skriver i:nth-child(2){animation-delay:.15s}.skriver i:nth-child(3){animation-delay:.3s}@keyframes h{0%,60%,100%{opacity:.3}30%{opacity:1}}" +
      "form{display:flex;gap:8px;padding:10px;border-top:1px solid #ececf2;background:#fff}" +
      "textarea{flex:1;resize:none;border:1px solid #d9d9e3;border-radius:12px;padding:10px 12px;font-size:15px;line-height:1.35;max-height:110px;min-height:42px;color:#1d1d29;background:#fff;outline:none}" +
      "textarea:focus{border-color:" + farge + "}" +
      ".send{border:0;border-radius:12px;background:" + farge + ";color:" + tekstFarge + ";width:44px;cursor:pointer;display:flex;align-items:center;justify-content:center}" +
      ".send:disabled{opacity:.5;cursor:default}.send svg{width:20px;height:20px}" +
      ".fot{font-size:11px;color:#8b8b9c;text-align:center;padding:0 10px 8px;background:#fff}.fot a{color:inherit}" +
      "@media (max-width:520px){.panel{inset:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}}" +
      "</style>" +
      '<button class="knapp" type="button" aria-label="Åpne chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/></svg><span></span></button>' +
      '<section class="panel" role="dialog" aria-label="Chat">' +
      '<div class="topp"><div class="t"><b></b><small><span class="prik"></span>Digital assistent · svarer døgnet rundt</small></div><button class="lukk" type="button" aria-label="Lukk chat">×</button></div>' +
      '<div class="logg" aria-live="polite"></div>' +
      '<form><textarea rows="1" placeholder="Skriv en melding …" aria-label="Melding" maxlength="1000"></textarea><button class="send" type="submit" aria-label="Send"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.3 10l12.4 2-12.4 2z"/></svg></button></form>' +
      '<div class="fot">Digital assistent levert av <a href="https://orvelo.no" target="_blank" rel="noopener">Orvelo</a>. Ikke skriv sensitive opplysninger.</div>' +
      "</section>";
    document.body.appendChild(vert);

    var q = function (sel) { return rot.querySelector(sel); };
    var knapp = q(".knapp"), panel = q(".panel"), logg = q(".logg"), felt = q("textarea"), send = q(".send");
    q(".knapp span").textContent = c.knapp || "Spør oss";
    q(".topp b").textContent = c.kortnavn || c.navn;

    function lagre() { try { sessionStorage.setItem(LAGER, JSON.stringify(meldinger.slice(-30))); } catch (e) {} }
    function boble(m) {
      var el = document.createElement("div");
      el.className = "m " + (m.role === "user" ? "u" : "a");
      el.innerHTML = format(m.content);
      logg.appendChild(el);
      return el;
    }
    function merknad(klasse, t) { var el = document.createElement("div"); el.className = klasse; el.textContent = t; logg.appendChild(el); rull(); }
    function rull() { logg.scrollTop = logg.scrollHeight; }
    function tegn() {
      logg.innerHTML = "";
      if (c.prov) merknad("info", "Prøvemodus: forespørsler og beskjeder sendes ikke.");
      meldinger.forEach(boble);
      rull();
    }
    function apne() {
      panel.classList.add("apen"); knapp.style.display = "none"; tegn();
      setTimeout(function () { felt.focus(); }, 50);
    }
    function lukk() { panel.classList.remove("apen"); knapp.style.display = ""; }
    knapp.addEventListener("click", apne);
    q(".lukk").addEventListener("click", lukk);
    rot.addEventListener("keydown", function (e) { if (e.key === "Escape") lukk(); });

    felt.addEventListener("input", function () { felt.style.height = "auto"; felt.style.height = Math.min(110, felt.scrollHeight) + "px"; });
    felt.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMelding(); } });
    q("form").addEventListener("submit", function (e) { e.preventDefault(); sendMelding(); });

    function sendMelding() {
      var t = felt.value.trim();
      if (!t || opptatt) return;
      opptatt = true; send.disabled = true;
      felt.value = ""; felt.style.height = "auto";
      var m = { role: "user", content: t.slice(0, 1000) };
      meldinger.push(m); lagre(); var mEl = boble(m);
      var sk = document.createElement("div"); sk.className = "m a skriver"; sk.innerHTML = "<i></i><i></i><i></i>";
      logg.appendChild(sk); rull();
      // Hilsenen (første melding) er ikke fra Grok, så den sendes ikke med
      var historikk = meldinger.slice(meldinger[0] && meldinger[0].role === "assistant" ? 1 : 0);
      hent(API + "/chat/melding", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kunde: KUNDE, k: K || undefined, okt: OKT, meldinger: historikk }) })
        .then(function (d) {
          sk.remove();
          if (d.svar) {
            var svar = { role: "assistant", content: d.svar };
            meldinger.push(svar); lagre(); boble(svar);
            (d.handlinger || []).forEach(function (h) {
              merknad("info", h === "booket" ? (c.prov ? "Timen er booket (prøvemodus, ingen SMS sendt)." : "Timen er booket. Du får en SMS med bekreftelse.")
                : h === "time" ? (c.prov ? "Timeforespørsel registrert (prøvemodus, ikke sendt)." : "Forespørselen er sendt til " + (c.kortnavn || c.navn) + ".")
                : (c.prov ? "Beskjed registrert (prøvemodus, ikke sendt)." : "Beskjeden er sendt til " + (c.kortnavn || c.navn) + "."));
            });
          } else {
            meldinger.pop(); lagre(); mEl.remove();
            merknad("feil", d.feil || "Noe gikk galt. Prøv igjen.");
            felt.value = t;
          }
          rull();
        })
        .catch(function () {
          sk.remove(); meldinger.pop(); lagre(); mEl.remove(); felt.value = t;
          merknad("feil", "Fikk ikke kontakt. Sjekk nettet og prøv igjen.");
        })
        .then(function () { opptatt = false; send.disabled = false; felt.focus(); });
    }

    if (s.getAttribute("data-apen") === "1") apne();
  }
})();
