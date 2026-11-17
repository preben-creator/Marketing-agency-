/* Orvelo «pro»: animasjoner med Motion (motion.dev, laget av folkene bak Framer Motion, for vanlig JavaScript).
   Alt innhold vises også uten dette skriptet. html.anim settes i <head> og fjernes om Motion ikke lastes. */
(function () {
  "use strict";
  const html = document.documentElement;
  const M = window.Motion;
  const roligere = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Meny på mobil
  const knapp = document.querySelector(".menu-btn"), meny = document.getElementById("hovedmeny");
  if (knapp && meny) {
    knapp.addEventListener("click", () => {
      const apen = knapp.getAttribute("aria-expanded") === "true";
      knapp.setAttribute("aria-expanded", String(!apen));
      meny.classList.toggle("open", !apen);
    });
    meny.addEventListener("click", (e) => { if (e.target.closest("a")) { knapp.setAttribute("aria-expanded", "false"); meny.classList.remove("open"); } });
  }

  // Toppmenyen får glass og kant når man har rullet litt
  const topp = document.querySelector("header.top");
  const settTopp = () => topp && topp.classList.toggle("scrolled", window.scrollY > 8);
  settTopp(); window.addEventListener("scroll", settTopp, { passive: true });

  // Lyskjegle som følger musa på kortene
  document.addEventListener("pointermove", (e) => {
    const k = e.target.closest && e.target.closest(".svc,.plan");
    if (!k) return;
    const r = k.getBoundingClientRect();
    k.style.setProperty("--mx", (e.clientX - r.left) + "px");
    k.style.setProperty("--my", (e.clientY - r.top) + "px");
  }, { passive: true });

  if (!M || roligere) { html.classList.remove("anim"); return; }
  window.__orveloPro = true;
  const { animate, inView, stagger, scroll } = M;
  const fjær = { type: "spring", stiffness: 140, damping: 20, mass: 0.9 };

  // Rullelinje øverst
  const linje = document.querySelector(".progress");
  if (linje && scroll) scroll(animate(linje, { scaleX: [0, 1] }, { ease: "linear" }));

  // Hero: tekst først, så samtalen som blir til booking og SMS
  const tekst = document.querySelectorAll(".hero-copy > *");
  animate(tekst, { opacity: [0, 1], y: [18, 0], filter: ["blur(6px)", "blur(0px)"] }, { duration: 0.7, delay: stagger(0.08), ease: [0.22, 1, 0.36, 1] });
  const kort = document.querySelector(".call");
  if (kort) {
    animate(kort, { opacity: [0, 1], y: [30, 0], scale: [0.97, 1] }, { ...fjær, delay: 0.25 });
    const bobler = kort.querySelectorAll(".call-body > *");
    animate(bobler, { opacity: [0, 1], y: [10, 0] }, { duration: 0.45, delay: stagger(0.55, { startDelay: 0.8 }), ease: "easeOut" });
    const varsler = document.querySelectorAll(".toast");
    animate(varsler, { opacity: [0, 1], x: [-16, 0], scale: [0.95, 1] }, { ...fjær, delay: stagger(0.35, { startDelay: 0.8 + bobler.length * 0.55 }) });
  }

  // Seksjoner glir inn når de kommer til syne
  document.querySelectorAll("[data-reveal]").forEach((el) => {
    inView(el, () => { animate(el, { opacity: [0, 1], y: [28, 0] }, { duration: 0.7, ease: [0.22, 1, 0.36, 1] }); }, { margin: "0px 0px -12% 0px" });
  });
  document.querySelectorAll("[data-stagger]").forEach((gruppe) => {
    inView(gruppe, () => {
      animate(Array.from(gruppe.children), { opacity: [0, 1], y: [24, 0] }, { duration: 0.6, delay: stagger(0.07), ease: [0.22, 1, 0.36, 1] });
    }, { margin: "0px 0px -10% 0px" });
  });

  // Prisene teller opp én gang
  document.querySelectorAll(".price").forEach((p) => {
    const node = p.firstChild; if (!node || node.nodeType !== 3) return;
    const slutt = node.textContent, tall = parseInt(slutt.replace(/\D/g, ""), 10);
    if (!tall) return;
    inView(p, () => {
      animate(0, tall, { duration: 1.1, ease: [0.22, 1, 0.36, 1],
        onUpdate: (v) => { node.textContent = Math.round(v).toLocaleString("nb-NO").replace(/ /g, " ") + " "; },
        onComplete: () => { node.textContent = slutt; } });
    });
  });

  // FAQ åpner og lukker mykt
  document.querySelectorAll(".faq details").forEach((d) => {
    const s = d.querySelector("summary");
    s.addEventListener("click", (e) => {
      e.preventDefault();
      const lukket = s.offsetHeight + 4;
      if (d.open) {
        animate(d, { height: [d.offsetHeight + "px", lukket + "px"] }, { duration: 0.28, ease: "easeInOut" }).then(() => { d.open = false; d.style.height = ""; });
      } else {
        d.open = true;
        const full = d.offsetHeight;
        animate(d, { height: [lukket + "px", full + "px"] }, { duration: 0.32, ease: [0.22, 1, 0.36, 1] }).then(() => { d.style.height = ""; });
      }
    });
  });
})();
