/* Petter og Eva: halvt menneske, halvt robot. Tegnet i SVG, med lag som flytter seg ulikt (3D-dybde),
   øyne som følger musa, blunking og munn som beveger seg når de snakker.
   Bruk: <div class="robot" data-robot="petter|eva"></div>. Snakk: OrveloRobot.snakk(el, true/false, lyd?) */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const TYPER = {
    petter: { hud: ["#ffd9bd", "#e0a47e", "#a8714f"], har: "#1c1a19", harLys: "#3a3532", iris: ["#7dffc4", "#18b07a", "#0a3d2b"], lepper: "#b0715a", bryn: "#2a2523", glod: "#3ddc97" },
    eva: { hud: ["#ffe6d6", "#efbca0", "#b98066"], har: "#15131a", harLys: "#3b3442", iris: ["#a8f0ff", "#2bb3c9", "#0b3a44"], lepper: "#c8706a", bryn: "#2b2328", glod: "#7ee8fa" },
  };
  let teller = 0;

  function svg(type) {
    const t = TYPER[type] || TYPER.petter, id = "r" + (++teller), eva = type === "eva";
    const harBak = eva
      ? `<path d="M100 14C42 14 22 64 26 118c3 40-4 86-18 122h72l2-40c-14-20-22-50-22-82 0-46 18-74 40-74s40 28 40 74c0 32-8 62-22 82l2 40h72c-14-36-21-82-18-122C178 64 158 14 100 14Z" fill="url(#${id}har)"/>`
      : "";
    const harFram = eva
      ? `<path d="M100 22c-38 0-62 26-66 70 18-10 34-28 44-46 8 18 30 34 58 40 12 3 24 4 32 3-6-40-30-67-68-67Z" fill="url(#${id}har)"/><path d="M60 52c10-14 26-22 44-22" stroke="${t.harLys}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>`
      : `<path d="M100 22c-40 0-62 24-64 62 10-6 16-18 20-30 20 10 52 12 80 6 14-3 22 4 28 18 4-36-22-56-64-56Z" fill="url(#${id}har)"/><path d="M58 46c18-12 46-16 70-10" stroke="${t.harLys}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>`;
    const bryn = eva
      ? `<path d="M58 96c8-6 20-8 30-4" stroke="${t.bryn}" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M112 92c10-4 22-2 30 4" stroke="#55606a" stroke-width="3" fill="none" stroke-linecap="round"/>`
      : `<path d="M56 97c9-7 22-9 33-4" stroke="${t.bryn}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M111 93c11-5 24-3 33 4" stroke="#4d5861" stroke-width="4.5" fill="none" stroke-linecap="round"/>`;
    const kjeve = eva ? "C162 160 140 202 100 210C60 202 38 160 36 114" : "C164 166 142 208 100 214C58 208 36 166 34 114";
    return `<svg viewBox="0 0 200 260" xmlns="${NS}" aria-hidden="true" focusable="false">
<defs>
  <radialGradient id="${id}hud" cx="38%" cy="34%" r="75%"><stop offset="0" stop-color="${t.hud[0]}"/><stop offset=".6" stop-color="${t.hud[1]}"/><stop offset="1" stop-color="${t.hud[2]}"/></radialGradient>
  <linearGradient id="${id}met" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef3f6"/><stop offset=".35" stop-color="#a9b5bd"/><stop offset=".7" stop-color="#5d6a73"/><stop offset="1" stop-color="#232a30"/></linearGradient>
  <linearGradient id="${id}mork" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3238"/><stop offset="1" stop-color="#0c1013"/></linearGradient>
  <linearGradient id="${id}har" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.harLys}"/><stop offset=".5" stop-color="${t.har}"/><stop offset="1" stop-color="#050506"/></linearGradient>
  <radialGradient id="${id}iris" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="${t.iris[0]}"/><stop offset=".55" stop-color="${t.iris[1]}"/><stop offset="1" stop-color="${t.iris[2]}"/></radialGradient>
  <radialGradient id="${id}lys" cx="30%" cy="22%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <radialGradient id="${id}skygge" cx="78%" cy="80%" r="70%"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></radialGradient>
  <filter id="${id}glo" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <clipPath id="${id}ansikt"><path d="M100 30C150 30 168 70 166 114${kjeve}C34 70 50 30 100 30Z"/></clipPath>
  <clipPath id="${id}robot"><path d="M104 20C116 62 98 98 116 132c10 20 0 44-12 54-6 6-4 18 0 30H210V20Z"/></clipPath>
</defs>
<g class="rl-bak">${harBak}
  <path d="M8 262c6-30 30-44 62-46l30 8 30-8c32 2 56 16 62 46Z" fill="url(#${id}mork)"/>
  <path d="M70 216l30 8 30-8" stroke="${t.glod}" stroke-width="2" fill="none" filter="url(#${id}glo)" opacity=".9"/>
  <path d="M30 240c10-12 24-20 40-24M170 240c-10-12-24-20-40-24" stroke="#3a454d" stroke-width="2" fill="none"/>
  <path d="M78 180h44v44l-22 6-22-6Z" fill="url(#${id}mork)"/>
  <path d="M82 202h36M82 212h36" stroke="#46525a" stroke-width="2"/>
  <path d="M104 196v26" stroke="${t.glod}" stroke-width="1.6" filter="url(#${id}glo)" opacity=".8"/>
</g>
<g class="rl-hode">
  ${eva ? "" : `<path d="M38 104c-10-4-16 6-14 18 2 14 10 22 18 20" fill="url(#${id}hud)"/><path d="M34 112c-4 4-3 12 2 16" stroke="${t.hud[2]}" stroke-width="2" fill="none" opacity=".6"/>`}
  <g clip-path="url(#${id}ansikt)">
    <rect x="0" y="0" width="200" height="230" fill="url(#${id}hud)"/>
    <g clip-path="url(#${id}robot)">
      <rect x="0" y="0" width="200" height="230" fill="url(#${id}met)"/>
      <path d="M118 60c18 4 34 14 42 30M122 150c14-2 28-10 36-22M132 40v26M150 170l-12-14" stroke="#2f383f" stroke-width="1.6" fill="none" opacity=".75"/>
      <path d="M120 128c8 2 16 0 22-6" stroke="${t.glod}" stroke-width="1.6" fill="none" filter="url(#${id}glo)"/>
      <circle cx="160" cy="62" r="2.2" fill="${t.glod}" filter="url(#${id}glo)"/>
    </g>
    <path d="M104 20C116 62 98 98 116 132c10 20 0 44-12 54-6 6-4 18 0 30" stroke="#20272c" stroke-width="2.4" fill="none"/>
    <path d="M106 20C118 62 100 98 118 132c10 20 0 44-12 54" stroke="${t.glod}" stroke-width="1.2" fill="none" opacity=".55" filter="url(#${id}glo)"/>
    ${eva ? `<ellipse cx="66" cy="140" rx="14" ry="8" fill="#f08a7a" opacity=".22"/>` : `<path d="M44 150c10 34 30 56 56 60v-14c-20-2-40-20-50-50Z" fill="#3a2a22" opacity=".12"/>`}
    <rect x="0" y="0" width="200" height="230" fill="url(#${id}lys)"/>
    <rect x="0" y="0" width="200" height="230" fill="url(#${id}skygge)"/>
  </g>
  <g transform="translate(164 120)"><circle r="17" fill="url(#${id}mork)" stroke="#8d99a1" stroke-width="2"/><circle r="10" fill="none" stroke="${t.glod}" stroke-width="2.4" filter="url(#${id}glo)"/><circle r="4" fill="${t.glod}" filter="url(#${id}glo)"/></g>
  ${harFram}
</g>
<g class="rl-trekk">
  ${bryn}
  <g class="r-oye" transform-origin="72 112"><path d="M56 113c6-9 26-11 34 0-8 9-28 9-34 0Z" fill="#f6f3ef"/><g class="r-iris"><circle cx="73" cy="112.5" r="7.4" fill="url(#${id}iris)"/><circle cx="73" cy="112.5" r="3.2" fill="#071a12"/><circle cx="70.6" cy="110" r="1.8" fill="#fff"/></g><path d="M55 113c7-11 28-12 36 0" stroke="#3a2a22" stroke-width="${eva ? 2.8 : 2}" fill="none" stroke-linecap="round"/>${eva ? `<path d="M56 111l-4-3M59 107l-3-4M64 104l-1-4" stroke="#2a1f1c" stroke-width="1.6" stroke-linecap="round"/>` : ""}</g>
  <g class="r-oye" transform-origin="128 112"><path d="M110 113c8-11 28-9 34 0-6 9-26 9-34 0Z" fill="#11181c"/><g class="r-iris"><circle cx="127" cy="112.5" r="7.6" fill="url(#${id}iris)" filter="url(#${id}glo)"/><circle cx="127" cy="112.5" r="3" fill="#e9fff6"/></g><path d="M109 113c8-12 29-12 36 0" stroke="#1d2428" stroke-width="2" fill="none" stroke-linecap="round"/></g>
  <path d="M100 118c-2 12-6 22-9 28 4 3 12 3 16 0" stroke="${t.hud[2]}" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>
  <g class="r-munn" transform="translate(100 168)">
    <path class="r-innside" d="M-15 0c6 2 24 2 30 0-3 12-27 12-30 0Z" fill="#2a0f0d"/><path class="r-innside" d="M-8 1h16v3h-16Z" fill="#f4f1ee" opacity=".85"/>
    <path class="r-overleppe" d="M-17 0c5-6 11-6 17-3 6-3 12-3 17 3-10 3-24 3-34 0Z" fill="${t.lepper}"/>
    <path class="r-underleppe" d="M-16 1c9 3 23 3 32 0-3 8-10 11-16 11s-13-3-16-11Z" fill="${t.lepper}"/>
    <path class="r-underleppe" d="M-8 6c5 2 11 2 16 0" stroke="#fff" stroke-opacity=".3" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </g>
</g>
</svg>`;
  }

  function lag(el) {
    if (el.dataset.klar) return;
    el.dataset.klar = "1";
    el.innerHTML = svg(el.dataset.robot);
    const g = (s) => el.querySelectorAll(s);
    el._deler = { bak: g(".rl-bak")[0], hode: g(".rl-hode")[0], trekk: g(".rl-trekk")[0], iris: g(".r-iris"), oyne: g(".r-oye"), inn: g(".r-innside"), under: g(".r-underleppe") };
    settMunn(el, 0);
  }

  function settMunn(el, v) {
    const d = el._deler; if (!d) return;
    v = Math.max(0, Math.min(1, v));
    d.inn.forEach((i) => i.setAttribute("transform", `scale(1 ${0.2 + v * 2.3})`));
    d.under.forEach((u) => u.setAttribute("transform", `translate(0 ${v * 12})`));
  }

  // Ser mot et punkt (x, y i -1..1). Lagene flytter seg ulikt, så hodet får dybde.
  function se(el, x, y) {
    const d = el._deler; if (!d) return;
    d.bak.setAttribute("transform", `translate(${(-x * 3).toFixed(2)} ${(-y * 2).toFixed(2)})`);
    d.hode.setAttribute("transform", `translate(${(x * 3).toFixed(2)} ${(y * 2).toFixed(2)})`);
    d.trekk.setAttribute("transform", `translate(${(x * 6).toFixed(2)} ${(y * 4).toFixed(2)})`);
    d.iris.forEach((i) => i.setAttribute("transform", `translate(${(x * 3).toFixed(2)} ${(y * 2).toFixed(2)})`));
    el.style.setProperty("--ry", (x * 14).toFixed(2) + "deg");
    el.style.setProperty("--rx", (-y * 10).toFixed(2) + "deg");
  }

  function blunk(el) {
    const d = el._deler; if (!d) return;
    d.oyne.forEach((o) => { o.style.transition = "transform .09s"; o.style.transform = "scaleY(.08)"; });
    setTimeout(() => d.oyne.forEach((o) => { o.style.transform = ""; }), 120);
  }

  // Snakking: følger lyden hvis vi har den, ellers stavelser i et naturlig mønster
  let ctx = null;
  function analyseFor(lyd) {
    if (!lyd) return null;
    if (lyd._an) return lyd._an;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      lyd._kilde = ctx.createMediaElementSource(lyd); lyd._an = ctx.createAnalyser(); lyd._an.fftSize = 512;
      lyd._kilde.connect(lyd._an); lyd._an.connect(ctx.destination);
      return lyd._an;
    } catch (e) { lyd._an = null; return null; }
  }
  // kilde: et <audio>-element, en funksjon som gir det (lyden lages kanskje litt etter at snakkingen starter), eller ingenting
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
        v = Math.min(1, Math.sqrt(s / buf.length) * 5.5);
      } else {
        const t = (n - t0) / 1000;
        v = Math.max(0, Math.sin(t * 13) * 0.55 + Math.sin(t * 7.3 + 1) * 0.35 + 0.25) * (0.75 + 0.25 * Math.sin(t * 1.7));
      }
      jevn += (v - jevn) * 0.45; settMunn(el, jevn);
      el._raf = requestAnimationFrame(steg);
    };
    el._raf = requestAnimationFrame(steg);
  }

  // Demoen: roboten i telefonen snakker når sekretæren snakker
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
    if (roligere) return;
    // Blunker innimellom, hver i sin takt (stopper når fanen ikke vises)
    alle.forEach((el, i) => {
      const neste = () => { el._blunk = setTimeout(() => { if (!document.hidden) blunk(el); neste(); }, 2600 + Math.random() * 3500); };
      setTimeout(neste, i * 700);
    });
    if (window.matchMedia("(hover: hover)").matches) {
      let vent = false;
      window.addEventListener("pointermove", (e) => {
        if (vent) return; vent = true;
        requestAnimationFrame(() => {
          vent = false;
          alle.forEach((el) => {
            const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
            const x = (e.clientX - (r.left + r.width / 2)) / (innerWidth / 2), y = (e.clientY - (r.top + r.height / 2)) / (innerHeight / 2);
            se(el, Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
          });
        });
      }, { passive: true });
    }
  }
  window.OrveloRobot = { lag, snakk, blunk, se };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
