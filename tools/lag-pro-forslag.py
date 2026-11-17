#!/usr/bin/env python3
"""Lager tre «pro»-designforslag av forsiden (design/pro/<tema>/index.html) ut fra index.html.

Felles for alle: ny hero med produktbilde, faktastripe, «Slik virker det», animasjoner med Motion
(design/pro/pro.js) og felles oppsett (design/pro/pro.css). Forskjellen ligger i temafila (ren/natt/varm.css).
Kjør:  python3 tools/lag-pro-forslag.py
Med --forside skrives valgt tema rett inn i index.html (bruk etter at Preben har valgt).
"""
import pathlib, re, sys

ROT = pathlib.Path(__file__).resolve().parent.parent
TEMAER = {
    "ren": "Forslag 1: Ren",
    "natt": "Forslag 2: Natt",
    "varm": "Forslag 3: Varm",
}

ORB = '''<div class="orb-wrap{ekstra}" data-orb><div class="orb orb--{navn}"><i class="orb-core"></i><i class="orb-shine"></i><div class="orb-face"><i></i><i></i></div></div><i class="orb-ring"></i></div>'''

HERO = '''<section class="hero hero--pro">
    <div class="hero-bg" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="hero-copy">
      <a class="hero-badge" href="#sporsmal"><b>Nytt</b> Velg stemme: Petter eller Eva</a>
      <div class="eyebrow">For håndverkere og servicebedrifter</div>
      <h1>Din egen KI-sekretær. <span class="grad">Svarer kundene døgnet rundt.</span></h1>
      <p class="lead">Orvelo lager en KI-sekretær for firmaet ditt. Den kjenner tjenestene, prisene og åpningstidene dine, snakker og skriver norsk, og svarer kundene døgnet rundt via en lenke på nettsiden din. Når kunden vil ha en avtale, foreslår den ledige tider.</p>
      <div class="hero-cta">
        <a class="btn btn--lg" href="#demo">▶ Se den i aksjon</a>
        <a class="btn btn--ghost btn--lg" href="#pris">Se pris</a>
      </div>
      <ul class="trust"><li>14 dager gratis</li><li>Ingen oppstartspris</li><li>Norsk tale og chat</li></ul>
    </div>
    <div class="hero-visual" aria-hidden="true">
      <img class="figur figur--h" src="assets/figur.svg" alt="" width="210" height="245">
      @ORB_P@
      <div class="hv-3d">
      <div class="call">
        <div class="call-top">@ORB_AV@<div><b>Petter · Hansen Rør AS</b><small>KI-sekretær på nettsiden</small></div><span class="call-live">Svarer nå</span></div>
        <div class="call-body">
          <div class="cb cb--k"><small>Kunde</small>Hei! Vasken lekker. Har dere tid denne uka?</div>
          <div class="cb cb--p"><small>Petter</small>Det ordner vi. Jeg har ledig torsdag kl. 09.00 eller fredag kl. 13.00.</div>
          <div class="cb cb--k"><small>Kunde</small>Torsdag passer fint!</div>
        </div>
      </div>
      <div class="toasts">
        <div class="toast"><span class="ti">📅</span><div><b>Booket i kalenderen</b><span>Torsdag kl. 09.00 · Vasken lekker</span></div></div>
        <div class="toast"><span class="ti">✉️</span><div><b>SMS sendt til kunden</b><span>Bekreftelse og påminnelse</span></div></div>
      </div>
      </div>
    </div>
  </section>

  <ul class="facts" data-stagger aria-label="Kort fortalt">
    <li><b>24/7</b><span>svarer kundene døgnet rundt</span></li>
    <li><b>0 kr</b><span>i oppstartspris</span></li>
    <li><b>14 dager</b><span>gratis prøvetid</span></li>
    <li><b>2 stemmer</b><span>Petter eller Eva, på norsk</span></li>
  </ul>

  <section class="sec meet" id="assistentene" aria-labelledby="meetH">
    <div class="sec-head">
      <div class="eyebrow">KI-assistentene</div>
      <h2 id="meetH">Møt Petter og Eva</h2>
      <p>Sekretæren din snakker og skriver naturlig norsk. Du velger stemme, og hvor fort den snakker.</p>
    </div>
    <div class="meet-grid" data-stagger>
      <article class="meet-card" style="--o2:#1f9c6e">
        @ORB_P@
        <div><h3>Petter</h3><span class="rolle">Mannsstemme</span>
          <ul><li>Rolig og tydelig norsk</li><li>Svarer i chat og med stemme</li><li>Foreslår ledige tider</li></ul>
          <a class="btn btn--ghost" href="#demo">Prøv demoen</a></div>
      </article>
      <article class="meet-card" style="--o2:#e2674b">
        @ORB_E@
        <div><h3>Eva</h3><span class="rolle">Kvinnestemme</span>
          <ul><li>Varm og vennlig norsk</li><li>Svarer i chat og med stemme</li><li>Foreslår ledige tider</li></ul>
          <a class="btn btn--ghost" href="#demo">Prøv demoen</a></div>
      </article>
    </div>
  </section>'''
HERO = (HERO.replace('@ORB_P@', ORB.format(ekstra='', navn='petter'))
        .replace('@ORB_AV@', ORB.format(ekstra=' call-av', navn='petter'))
        .replace('@ORB_E@', ORB.format(ekstra='', navn='eva')))

DEMO_HEAD = '''<div class="demo-head" data-reveal>
    <div class="eyebrow">Prøv selv</div>
    <h2>Hør en kunde snakke med sekretæren</h2>
    <p>Velg fag og firmanavn, og trykk på «Spill av samtalen». Skru på lyden for å høre stemmen.</p>
  </div>
  '''

STEG = '''<section class="sec" id="slik" aria-labelledby="slikH">
    <div class="sec-head" data-reveal>
      <div class="eyebrow">Slik virker det</div>
      <h2 id="slikH">I gang på tre steg</h2>
      <p>Vi gjør jobben. Det tar rundt 15–30 minutter av din tid.</p>
    </div>
    <ol class="steps" data-stagger>
      <li><b>Vi lager sekretæren</b><p>Ut fra nettsiden din, med tjenestene, prisene og åpningstidene dine. Vi går gjennom den sammen med deg.</p></li>
      <li><b>Du deler lenken</b><p>Legg knappen på nettsiden, Google-profilen og sosiale medier. Telefonnummeret ditt fungerer som før.</p></li>
      <li><b>Kundene får svar</b><p>Døgnet rundt, i chat eller med stemme. Med Pro havner avtalene rett i kalenderen og kunden får SMS.</p></li>
    </ol>
  </section>

  '''


def bygg(kilde: str, tema: str, prefiks: str, pro: str) -> str:
    s = kilde
    hode = (
        f'\n<link rel="stylesheet" href="{pro}pro.css">\n<link rel="stylesheet" href="{pro}{tema}.css">\n'
        '<script>/* Inn-animasjoner bare når Motion faktisk kjører */\n'
        'if(!matchMedia("(prefers-reduced-motion: reduce)").matches){document.documentElement.classList.add("anim");'
        'setTimeout(function(){if(!window.__orveloPro)document.documentElement.classList.remove("anim")},2500)}</script>\n'
        f'<script src="{prefiks}assets/vendor/motion-12.23.12.js" defer></script>\n<script src="{pro}pro.js" defer></script>\n'
    )
    s = s.replace("</style>\n</head>", "</style>" + hode + "</head>", 1)
    s = s.replace('<body>\n', '<body>\n<div class="progress" aria-hidden="true"></div>\n', 1)
    # Meny med knapp på mobil
    s = s.replace('<nav class="menu" aria-label="Hovedmeny">', '<nav class="menu" id="hovedmeny" aria-label="Hovedmeny">', 1)
    s = s.replace('      <a href="#sporsmal">Spørsmål</a>\n    </nav>',
                  '      <a href="#sporsmal">Spørsmål</a>\n      <a class="menu-cta" href="#kontakt">Book en prat</a>\n    </nav>\n'
                  '    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="hovedmeny" aria-label="Meny"><span></span></button>', 1)
    # Ny hero
    s = re.sub(r'<section class="hero">.*?</section>', lambda m: HERO, s, count=1, flags=re.S)
    # Demo: overskrift og stage som glir inn
    s = s.replace('<section id="demo" class="demo" aria-label="Demo">\n  ', '<section id="demo" class="demo" aria-label="Demo">\n  ' + DEMO_HEAD, 1)
    s = s.replace('<div class="stage">', '<div class="stage" data-reveal>', 1)
    # Slik virker det, før «Hva du får»
    s = s.replace('<section class="sec" id="tjenester"', STEG + '<section class="sec" id="tjenester"', 1)
    # Inn-animasjoner
    s = s.replace('<div class="sec-head">', '<div class="sec-head" data-reveal>')
    s = re.sub(r'<div class="svcs( [^"]*)?">', lambda m: m.group(0)[:-1] + ' data-stagger>', s)
    s = s.replace('<div class="plans">', '<div class="plans" data-stagger>', 1)
    s = s.replace('<section class="roi" ', '<section class="roi" data-reveal ', 1)
    s = s.replace('<section class="sec contact" ', '<section class="sec contact" data-reveal ', 1)
    # Stier når siden ligger i en undermappe
    if prefiks:
        s = s.replace('src="assets/', f'src="{prefiks}assets/').replace('href="assets/', f'href="{prefiks}assets/')
        s = s.replace('href="personvern/"', f'href="{prefiks}personvern/"')
        s = s.replace('fetch("audio/', f'fetch("{prefiks}audio/').replace('`audio/${', f'`{prefiks}audio/${{')
        s = s.replace('<meta name="viewport"', '<meta name="robots" content="noindex">\n<meta name="viewport"', 1)
        s = s.replace('<title>Orvelo KI-sekretær</title>', f'<title>{TEMAER[tema]} · Orvelo</title>', 1)
    return s


def main():
    kilde = (ROT / "index.html").read_text(encoding="utf-8")
    if "hero--pro" in kilde:
        sys.exit("index.html har allerede pro-designet. Bruk en eldre index.html som kilde.")
    if "--forside" in sys.argv:
        tema = sys.argv[sys.argv.index("--forside") + 1]
        (ROT / "index.html").write_text(bygg(kilde, tema, "", "design/pro/"), encoding="utf-8")
        print("index.html oppdatert med", tema)
        return
    for tema in TEMAER:
        ut = ROT / "design" / "pro" / tema / "index.html"
        ut.parent.mkdir(parents=True, exist_ok=True)
        ut.write_text(bygg(kilde, tema, "../../../", "../"), encoding="utf-8")
        print("skrev", ut.relative_to(ROT))


if __name__ == "__main__":
    main()
