#!/usr/bin/env python3
"""Lager designforslag av forsiden i design/<variant>/index.html.

Teksten og demoen hentes fra index.html, så forslagene alltid har samme innhold
som forsiden. Bare farger, skrift og form byttes. Kjør fra repo-roten:

    python3 tools/lag-designvarianter.py
"""
import re
from pathlib import Path

from designfigurer import FIGURER, CSS as FIGUR_CSS

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "index.html").read_text(encoding="utf-8")
LOGO = (ROOT / "assets" / "orvelo-logo.svg").read_text(encoding="utf-8")
OUT = ROOT / "design"

VARIANTER = [
    {
        "slug": "naa",
        "navn": "Dagens side",
        "kort": "Mørk, lilla og cyan. Teknisk og moderne.",
        "fonts": None,
        "logo": ("#7c5cff", "#00d4ff", "#f2f3f7"),
        "css": "",
    },
    {
        "slug": "fjord",
        "navn": "Fjord",
        "kort": "Lys og rolig. Dyp fjordblå og grønnblå. Ryddig og tillitsvekkende.",
        "fonts": "family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Instrument+Sans:wght@400;500;600",
        "logo": ("#0d5c75", "#14998f", "#0f2531"),
        "css": """
:root{
  --bg:#f2f5f7;--bg-alt:#e9eff3;--surface:#ffffff;--surface-2:#eef3f6;--border:#d3dde4;
  --text:#0f2531;--muted:#566a76;--accent:#0d5c75;--accent-2:#0f7f86;--ok:#1d8a55;--warn:#a85f00;
  --accent-deep:#0a4458;--phone:#0f2531;--on-accent:#ffffff;--radius:12px;
  --font-body:"Instrument Sans",system-ui,sans-serif;--font-head:"Bricolage Grotesque","Instrument Sans",system-ui,sans-serif;
  color-scheme:light;
}
h1,h2{font-weight:800;letter-spacing:-.03em}
.hero{padding-top:56px;padding-bottom:30px}
.hero h1{font-size:clamp(2.2rem,5.4vw,3.8rem)}
.phone{box-shadow:0 30px 70px -35px rgba(15,37,49,.55)}
.plan,.roi,.contact{border-radius:16px}
.plan.best{box-shadow:0 22px 50px -30px rgba(13,92,117,.6)}
.svc{border-radius:12px}
.btn{border-radius:10px}
.firm,.tag,.status{border-radius:10px}
/* Fjordlinjer bak toppen */
body{background-image:repeating-linear-gradient(180deg,transparent 0 26px,rgba(13,92,117,.05) 26px 27px);background-size:100% 520px;background-repeat:no-repeat}
""",
    },
    {
        "slug": "verksted",
        "navn": "Verksted",
        "kort": "Mørk grafitt med signaloransje. Kraftig, rett fram, laget for håndverkere.",
        "fonts": "family=Archivo:wght@400;500;600;700&family=Big+Shoulders+Display:wght@700;800",
        "logo": ("#ff6b1a", "#ffc23d", "#f3efe6"),
        "css": """
:root{
  --bg:#161513;--bg-alt:#1d1b18;--surface:#23211d;--surface-2:#2d2a25;--border:#3e3a33;
  --text:#f3efe6;--muted:#aaa296;--accent:#ff6b1a;--accent-2:#ffc23d;--ok:#7bd88f;--warn:#ffc23d;
  --accent-deep:#c94e0c;--phone:#0c0b0a;--on-accent:#161513;--radius:4px;
  --font-body:"Archivo",system-ui,sans-serif;--font-head:"Big Shoulders Display","Archivo",system-ui,sans-serif;
  color-scheme:dark;
}
h1,h2,h3{text-transform:uppercase;letter-spacing:.01em;font-weight:800}
.hero h1{font-size:clamp(2.6rem,7vw,5rem);line-height:.95}
.hero{padding-top:44px}
.hero::before{content:"";display:block;height:10px;max-width:220px;margin:0 auto 26px;background:repeating-linear-gradient(-45deg,var(--accent-2) 0 12px,var(--bg) 12px 24px);border-radius:2px}
.plan h3,.card h3,.svc b{text-transform:none;letter-spacing:0}
.card h3{font-family:var(--font-body);font-weight:700}
.price{font-size:2.6rem}
.btn{border-radius:4px;background:var(--accent);box-shadow:3px 3px 0 var(--accent-2);font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:.9rem}
.btn:hover{transform:translate(-1px,-1px);box-shadow:4px 4px 0 var(--accent-2)}
.btn--ghost{background:var(--surface);box-shadow:3px 3px 0 var(--border)}
.firm,.tag,.status,.sys,.bransjer a,.pill,.plan .badge,.svc .tier{border-radius:4px}
.plan,.roi,.contact,.svc,.card,.faq details,.sms,.slot{border-radius:6px}
.plan.best{box-shadow:6px 6px 0 var(--accent)}
.plan .badge{background:var(--accent-2);color:var(--on-accent)}
.grad{background:none;color:var(--accent);-webkit-text-fill-color:currentColor}
.eyebrow{color:var(--accent-2)}
.phone{border-radius:30px;box-shadow:0 30px 70px -30px rgba(255,107,26,.35)}
.screen{border-radius:22px}
""",
    },
    {
        "slug": "vennlig",
        "navn": "Vennlig",
        "kort": "Lys mintgrønn med korall. Myk, rund og imøtekommende.",
        "fonts": "family=Fredoka:wght@500;600;700&family=Nunito:wght@400;600;700",
        "logo": ("#1f7a5a", "#e0674c", "#1c2b24"),
        "css": """
:root{
  --bg:#eef6f1;--bg-alt:#e2efe7;--surface:#ffffff;--surface-2:#f1f8f4;--border:#cfe2d6;
  --text:#1c2b24;--muted:#56695f;--accent:#1f7a5a;--accent-2:#c24f36;--ok:#1f7a5a;--warn:#b5651d;
  --accent-deep:#17614a;--phone:#1c2b24;--on-accent:#ffffff;--radius:26px;
  --font-body:"Nunito",system-ui,sans-serif;--font-head:"Fredoka","Nunito",system-ui,sans-serif;
  color-scheme:light;
}
h1,h2,h3{font-weight:600;letter-spacing:-.01em}
.hero{padding-top:52px}
.hero h1{font-size:clamp(2.3rem,5.6vw,3.9rem)}
.grad{background:none;color:var(--accent-2);-webkit-text-fill-color:currentColor;text-decoration:underline wavy color-mix(in srgb,var(--accent-2) 45%,transparent);text-decoration-thickness:3px;text-underline-offset:10px}
.btn{background:var(--accent);box-shadow:0 8px 20px -10px rgba(31,122,90,.8);font-weight:700}
.btn:hover{background:var(--accent-deep)}
.btn--ghost{background:var(--surface);box-shadow:none}
.eyebrow{text-transform:none;letter-spacing:0;font-size:.95rem;font-weight:700}
.plan,.roi,.contact{border-radius:30px}
.svc,.card,.faq details{border-radius:22px}
.svc .i{font-size:1.6rem;width:48px;height:48px;display:grid;place-items:center;border-radius:16px;background:var(--bg-alt)}
.plan.best{box-shadow:0 24px 50px -30px rgba(31,122,90,.6)}
.plan .badge{background:var(--accent-2);color:#fff}
.phone{box-shadow:0 30px 70px -35px rgba(28,43,36,.5)}
.msg{border-radius:20px}
""",
    },
]

# Faste farger i originalen som må følge temaet.
FASTE = [
    (r"rgba\(124,92,255,([.\d]+)\)", lambda m: f"color-mix(in srgb,var(--accent) {float(m.group(1))*100:g}%,transparent)"),
    (r"rgba\(0,212,255,([.\d]+)\)", lambda m: f"color-mix(in srgb,var(--accent-2) {float(m.group(1))*100:g}%,transparent)"),
    (r"rgba\(10,11,16,([.\d]+)\)", lambda m: f"color-mix(in srgb,var(--bg) {float(m.group(1))*100:g}%,transparent)"),
    (r"rgba\(255,255,255,\.15\)", lambda m: "color-mix(in srgb,var(--text) 15%,transparent)"),
    (r"background:#05060a", lambda m: "background:var(--phone)"),
    (r"#5b3fe0|#3d2aa3", lambda m: "var(--accent-deep)"),
    (r"color:#fff\}", lambda m: "color:var(--on-accent)}"),
]

FELLES_TEMA = """
:root{--accent-deep:#5b3fe0;--phone:#05060a;--on-accent:#fff}
.btn--ghost{color:var(--text)}
.msg.cust,.msg.cust small{color:var(--on-accent)}
.msg.cust small{opacity:.8}
.form input,.form select,.form textarea{color:var(--text)}
.forslag{position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:50;display:flex;gap:12px;align-items:center;background:var(--text);color:var(--bg);font:600 .85rem/1.2 var(--font-body);padding:9px 10px 9px 16px;border-radius:999px;box-shadow:0 10px 30px -10px rgba(0,0,0,.5);white-space:nowrap}
.forslag a{color:inherit;background:color-mix(in srgb,var(--bg) 18%,transparent);padding:6px 12px;border-radius:999px;text-decoration:none}
footer{padding-bottom:80px}
"""


def logo(stop1, stop2, tekst):
    svg = re.sub(r"<metadata>.*?</metadata>", "", LOGO, flags=re.S)
    svg = svg.replace(' xmlns:c2pa="http://c2pa.org/manifest"', "")
    svg = re.sub(r'<rect width="100%" height="100%" fill="#0a0b10"/>', "", svg)
    svg = svg.replace("#7c5cff", stop1).replace("#00d4ff", stop2).replace("#f2f3f7", tekst)
    return svg


def lag(v, nr):
    html = SRC
    for pat, fn in FASTE:
        html = re.sub(pat, fn, html)
    # Stier: siden ligger to mapper ned.
    html = html.replace('src="assets/orvelo-logo.svg"', 'src="logo.svg"')
    html = html.replace('href="assets/favicon.svg"', 'href="../../assets/favicon.svg"')
    html = html.replace('fetch("audio/manifest.json")', 'fetch("../../audio/manifest.json")')
    html = html.replace("new Audio(`audio/", "new Audio(`../../audio/")
    html = html.replace('<a href="./" class="brand">', '<a href="../../" class="brand">')
    # Ikke la Google indeksere forslagene.
    html = re.sub(r'<link rel="canonical"[^>]*>', '<meta name="robots" content="noindex">', html)
    html = re.sub(r"<title>[^<]*</title>", f"<title>Orvelo – designforslag {v['navn']}</title>", html)
    if v["fonts"]:
        html = re.sub(r'<link href="https://fonts.googleapis.com/css2\?[^"]*" rel="stylesheet">',
                      f'<link href="https://fonts.googleapis.com/css2?{v["fonts"]}&display=swap" rel="stylesheet">', html)
    figur = v["slug"] in FIGURER
    html = html.replace("</style>", FELLES_TEMA + v["css"] + (FIGUR_CSS if figur else "") + "</style>", 1)
    if figur:
        html = html.replace('<section class="hero">', '<section class="hero">\n    '
                            '<img class="figur figur--h" src="figur.svg" alt="" width="210" height="245">\n    '
                            '<img class="figur figur--v" src="figur.svg" alt="" width="160" height="187">', 1)
    etikett = v["navn"] if nr == 0 else f'Forslag {nr}: {v["navn"]}'
    bar = (f'<div class="forslag" role="note">{etikett}'
           f'<a href="../index.html">Sammenlign alle</a></div>\n</body>')
    html = html.replace("</body>", bar, 1)
    d = OUT / v["slug"]
    d.mkdir(parents=True, exist_ok=True)
    (d / "index.html").write_text(html, encoding="utf-8")
    (d / "logo.svg").write_text(logo(*v["logo"]), encoding="utf-8")
    if figur:
        (d / "figur.svg").write_text(FIGURER[v["slug"]](), encoding="utf-8")


def oversikt():
    kort = []
    for nr, v in enumerate(VARIANTER):
        merke = "Slik er den nå" if nr == 0 else f"Forslag {nr}"
        kort.append(f"""
    <article class="v" id="{v['slug']}">
      <div class="frame"><iframe src="{v['slug']}/index.html" title="{v['navn']}" loading="lazy" tabindex="-1"></iframe></div>
      <div class="info">
        <span class="nr">{merke}</span>
        <h2>{v['navn']}</h2>
        <p>{v['kort']}</p>
        <a class="open" href="{v['slug']}/index.html" target="_top">Åpne hele siden</a>
      </div>
    </article>""")
    side = f"""<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="robots" content="noindex">
<title>Orvelo designforslag</title>
<link rel="icon" href="../assets/favicon.svg">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
<style>
/* Rutenett med levende forhåndsvisninger, ett kort per forslag */
:root{{--bg:#f4f5f7;--fg:#14161c;--muted:#5d6370;--card:#ffffff;--line:#dfe2e8;--accent:#3f4cc9;
  --head:"Space Grotesk",system-ui,sans-serif;--body:"Inter",system-ui,sans-serif}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--bg:#111318;--fg:#eef0f4;--muted:#9aa1ae;--card:#1a1d24;--line:#2a2e38;--accent:#9aa6ff;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#111318;--fg:#eef0f4;--muted:#9aa1ae;--card:#1a1d24;--line:#2a2e38;--accent:#9aa6ff;color-scheme:dark}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--fg);font:400 16px/1.5 var(--body);padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}}
main{{max-width:1240px;margin:0 auto;padding-block:36px 60px}}
h1,h2{{font-family:var(--head);margin:0;text-wrap:balance}}
h1{{font-size:clamp(1.7rem,4vw,2.4rem)}}
.lead{{color:var(--muted);max-width:62ch;margin:8px 0 28px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,520px),1fr));gap:22px}}
.v{{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}}
.frame{{position:relative;aspect-ratio:16/11;overflow:hidden;border-bottom:1px solid var(--line);max-width:100%}}
.frame iframe{{position:absolute;top:0;left:0;width:1280px;height:880px;border:0;transform-origin:0 0;pointer-events:none}}
.info{{padding:16px 18px 18px;display:grid;gap:6px;min-width:0}}
.nr{{font-size:.75rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}}
.info p{{margin:0;color:var(--muted)}}
.open{{justify-self:start;margin-top:6px;color:var(--accent);font-weight:600}}
.open:focus-visible{{outline:2px solid var(--accent);outline-offset:3px}}
</style>
</head>
<body>
<main>
  <h1>Tre designforslag for orvelo.no</h1>
  <p class="lead">Samme tekst og demo som forsiden, med ulike farger, skrift og stil. Trykk «Åpne hele siden» for å prøve en av dem. Forsiden endres ikke før du har valgt.</p>
  <div class="grid">{''.join(kort)}
  </div>
</main>
<script>
function skaler(){{document.querySelectorAll('.frame').forEach(f=>{{const i=f.querySelector('iframe');i.style.transform='scale('+(f.clientWidth/1280)+')';}});}}
addEventListener('resize',skaler);skaler();
</script>
</body>
</html>
"""
    (OUT / "index.html").write_text(side, encoding="utf-8")


if __name__ == "__main__":
    for nr, v in enumerate(VARIANTER):
        lag(v, nr)
    oversikt()
    print("Laget", ", ".join(v["slug"] for v in VARIANTER))
