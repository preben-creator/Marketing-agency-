/* Petter og Eva: fotorealistiske portretter (halvt menneske, halvt robot, laget med bildegenerator i vidIQ).
   Munnen beveger seg når de snakker: en myk maske over hake og underleppe flyttes ned og viser munnhulen bak.
   I demoen følger munnen lyden (Web Audio). Hodet vipper i 3D etter musa.
   Bruk: <div class="robot" data-robot="petter|eva"></div>. Snakk: OrveloRobot.snakk(el, true/false, lyd?) */
(function () {
  "use strict";
  const skript = document.currentScript && document.currentScript.src;
  const rot = skript ? skript.replace(/design\/pro\/robot\.js.*$/, "") : "";
  // Munnens plassering i bildet (prosent): midten av leppesømmen og bredden på munnen
  const TYPER = {
    petter: { bilde: "assets/ki/petter", mx: 50.8, my: 60.7, mw: 18 },
    eva: { bilde: "assets/ki/eva", mx: 50.9, my: 58.6, mw: 17 },
  };

  function lag(el) {
    if (el.dataset.klar) return;
    const t = TYPER[el.dataset.robot] || TYPER.petter;
    el.dataset.klar = "1";
    el.classList.add("foto-ki");
    el.style.setProperty("--mx", t.mx + "%");
    el.style.setProperty("--my", t.my + "%");
    el.style.setProperty("--mw", t.mw + "%");
    const src = rot + t.bilde;
    el.style.setProperty("--bilde", `url("${src}.webp")`);
    el.innerHTML =
      `<picture><source srcset="${src}.webp" type="image/webp"><img class="fk-bilde" src="${src}.jpg" alt="" width="800" height="800" decoding="async"></picture>` +
      `<span class="fk-munn" aria-hidden="true"></span><span class="fk-kjeve" aria-hidden="true"></span>`;
    el._deler = { munn: el.querySelector(".fk-munn"), kjeve: el.querySelector(".fk-kjeve") };
  }

  function settMunn(el, v) {
    const d = el._deler; if (!d) return;
    v = Math.max(0, Math.min(1, v));
    d.kjeve.style.transform = `translateY(${(v * 1.5).toFixed(3)}%)`;
    d.munn.style.transform = `translateX(-50%) scaleY(${(0.1 + v * 0.9).toFixed(3)})`;
    d.munn.style.opacity = v > 0.04 ? "1" : "0";
  }

  function se(el, x, y) {
    el.style.setProperty("--ry", (x * 10).toFixed(2) + "deg");
    el.style.setProperty("--rx", (-y * 7).toFixed(2) + "deg");
  }
  function blunk() {}

  let ctx = null;
  function analyseFor(lyd) {
    if (!lyd) return null;
    if (lyd._an !== undefined) return lyd._an;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      lyd._kilde = ctx.createMediaElementSource(lyd); lyd._an = ctx.createAnalyser(); lyd._an.fftSize = 512;
      lyd._kilde.connect(lyd._an); lyd._an.connect(ctx.destination);
    } catch (e) { lyd._an = null; }
    return lyd._an;
  }
  // kilde: et <audio>-element, en funksjon som gir det, eller ingenting (da snakker munnen i et naturlig mønster)
  function snakk(el, paa, kilde) {
    if (!el._deler) lag(el);
    cancelAnimationFrame(el._raf); el.classList.toggle("snakker", !!paa);
    if (!paa) { settMunn(el, 0); return; }
    const buf = new Uint8Array(512), t0 = performance.now(); let jevn = 0;
    const steg = (n) => {
      const lyd = typeof kilde === "function" ? kilde() : kilde;
      const an = lyd && !lyd.paused ? analyseFor(lyd) : null;
      let v;
      if (an) {
        an.getByteTimeDomainData(buf);
        let s = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; s += x * x; }
        v = Math.min(1, Math.sqrt(s / buf.length) * 5);
      } else {
        const t = (n - t0) / 1000;
        v = Math.max(0, Math.sin(t * 12) * 0.5 + Math.sin(t * 6.9 + 1) * 0.3 + 0.2) * (0.7 + 0.3 * Math.sin(t * 1.6));
      }
      jevn += (v - jevn) * 0.4; settMunn(el, jevn);
      el._raf = requestAnimationFrame(steg);
    };
    el._raf = requestAnimationFrame(steg);
  }

  // Demoen: Petter i telefonen snakker når sekretæren snakker
  function kobleDemo() {
    const bar = document.getElementById("callbar"), r = bar && bar.querySelector("[data-robot]");
    if (!r) return;
    new MutationObserver(() => {
      const na = bar.classList.contains("talking");
      if (na !== r.classList.contains("snakker")) snakk(r, na, () => window.__orveloLyd);
    }).observe(bar, { attributes: true, attributeFilter: ["class"] });
  }

  const roligere = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function start() {
    const alle = Array.from(document.querySelectorAll("[data-robot]"));
    alle.forEach(lag);
    kobleDemo();
    if (roligere || !window.matchMedia("(hover: hover)").matches) return;
    let vent = false;
    window.addEventListener("pointermove", (e) => {
      if (vent) return; vent = true;
      requestAnimationFrame(() => {
        vent = false;
        alle.forEach((el) => {
          const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight || r.width < 80) return;
          const x = (e.clientX - (r.left + r.width / 2)) / (innerWidth / 2), y = (e.clientY - (r.top + r.height / 2)) / (innerHeight / 2);
          se(el, Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
        });
      });
    }, { passive: true });
  }
  // Bytt hvem som vises (Petter/Eva), f.eks. når besøkende velger stemme i demoen
  function bytt(el, type) {
    if (!TYPER[type] || el.dataset.robot === type && el.dataset.klar) return;
    cancelAnimationFrame(el._raf); el.classList.remove("snakker");
    el.dataset.robot = type; delete el.dataset.klar; el._deler = null; lag(el);
  }
  window.OrveloRobot = { lag, snakk, blunk, se, bytt };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
