"""KI-figurer (maskoter) til designforslagene. Én figur per stil, tegnet som SVG."""

HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 280" role="img" aria-label="{navn}">'


def fjord():
    ink, blå, teal, lys, hvit = "#0f2531", "#0d5c75", "#5fd4c9", "#14998f", "#ffffff"
    return HEAD.format(navn="Liora, KI-sekretær") + f"""
<ellipse cx="120" cy="270" rx="72" ry="8" fill="{ink}" opacity=".12"/>
<path d="M68,214 Q40,190 46,158" fill="none" stroke="{blå}" stroke-width="14" stroke-linecap="round"/>
<circle cx="46" cy="152" r="11" fill="{hvit}" stroke="{ink}" stroke-width="3"/>
<path d="M60,270 C60,204 88,186 120,186 C152,186 180,204 180,270 Z" fill="{blå}"/>
<path d="M104,188 L120,212 L136,188 Z" fill="{hvit}"/>
<circle cx="120" cy="240" r="11" fill="none" stroke="{hvit}" stroke-width="4"/>
<path d="M172,214 Q186,240 178,262" fill="none" stroke="{blå}" stroke-width="14" stroke-linecap="round"/>
<circle cx="120" cy="120" r="62" fill="{hvit}" stroke="{ink}" stroke-width="4"/>
<rect x="78" y="96" width="84" height="54" rx="27" fill="{ink}"/>
<path d="M97,128 Q105,116 113,128 M127,128 Q135,116 143,128" fill="none" stroke="{teal}" stroke-width="5" stroke-linecap="round"/>
<path d="M111,139 Q120,146 129,139" fill="none" stroke="{teal}" stroke-width="4" stroke-linecap="round"/>
<path d="M52,122 A68,68 0 0 1 188,122" fill="none" stroke="{blå}" stroke-width="8" stroke-linecap="round"/>
<rect x="44" y="106" width="18" height="34" rx="9" fill="{blå}"/>
<rect x="178" y="106" width="18" height="34" rx="9" fill="{blå}"/>
<path d="M53,138 Q54,168 90,168" fill="none" stroke="{blå}" stroke-width="5" stroke-linecap="round"/>
<circle cx="95" cy="168" r="7" fill="{lys}"/>
<rect x="166" y="14" width="66" height="42" rx="15" fill="{lys}"/>
<path d="M180,54 L174,72 L196,55 Z" fill="{lys}"/>
<path d="M184,35 V35 M195,27 V43 M206,31 V39 M217,25 V45" stroke="{hvit}" stroke-width="5" stroke-linecap="round"/>
</svg>"""


def verksted():
    mørk, oransje, gul, krem, grå = "#161513", "#ff6b1a", "#ffc23d", "#f3efe6", "#3e3a33"
    return HEAD.format(navn="KI-sekretær med hjelm") + f"""
<ellipse cx="120" cy="272" rx="74" ry="7" fill="#000" opacity=".35"/>
<path d="M64,206 L48,252" stroke="{oransje}" stroke-width="16" stroke-linecap="round"/>
<path d="M176,206 L204,170" stroke="{oransje}" stroke-width="16" stroke-linecap="round"/>
<rect x="192" y="124" width="28" height="48" rx="5" fill="{mørk}" stroke="{krem}" stroke-width="3"/>
<path d="M198,148 h4 l3,-8 l4,16 l3,-8 h4" fill="none" stroke="{gul}" stroke-width="2.5" stroke-linejoin="round"/>
<rect x="104" y="172" width="32" height="18" fill="{grå}"/>
<rect x="60" y="186" width="120" height="84" rx="8" fill="{oransje}" stroke="{mørk}" stroke-width="5"/>
<rect x="86" y="204" width="68" height="38" rx="4" fill="{mørk}"/>
<path d="M94,223 h10 l5,-11 l7,22 l6,-15 l5,8 h19" fill="none" stroke="{gul}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
<path d="M60,256 H180" stroke="{mørk}" stroke-width="5"/>
<rect x="66" y="84" width="108" height="92" rx="14" fill="{krem}" stroke="{mørk}" stroke-width="5"/>
<rect x="80" y="110" width="80" height="40" rx="6" fill="{mørk}"/>
<rect x="96" y="122" width="14" height="14" rx="3" fill="{gul}"/>
<rect x="130" y="122" width="14" height="14" rx="3" fill="{gul}"/>
<path d="M106,162 H134" stroke="{mørk}" stroke-width="5" stroke-linecap="round"/>
<path d="M62,92 Q62,40 120,38 Q178,40 178,92 Z" fill="{gul}" stroke="{mørk}" stroke-width="5" stroke-linejoin="round"/>
<rect x="112" y="40" width="16" height="50" rx="3" fill="#e0a520"/>
<rect x="50" y="86" width="140" height="13" rx="6" fill="{gul}" stroke="{mørk}" stroke-width="5"/>
<rect x="52" y="114" width="16" height="36" rx="4" fill="{mørk}"/>
<rect x="172" y="114" width="16" height="36" rx="4" fill="{mørk}"/>
<path d="M60,148 Q62,178 96,178" fill="none" stroke="{mørk}" stroke-width="5"/>
<rect x="94" y="172" width="12" height="10" rx="2" fill="{oransje}" stroke="{mørk}" stroke-width="3"/>
</svg>"""


def vennlig():
    grønn, mørk, korall, hvit, mørkgrønn = "#3fa77c", "#1c2b24", "#e0674c", "#ffffff", "#1f7a5a"
    return HEAD.format(navn="Vennlig KI-sekretær") + f"""
<ellipse cx="120" cy="272" rx="70" ry="7" fill="{mørk}" opacity=".12"/>
<ellipse cx="96" cy="262" rx="20" ry="9" fill="{mørkgrønn}"/>
<ellipse cx="144" cy="262" rx="20" ry="9" fill="{mørkgrønn}"/>
<path d="M44,178 Q26,200 36,224" fill="none" stroke="{grønn}" stroke-width="15" stroke-linecap="round"/>
<path d="M194,168 Q222,148 218,114" fill="none" stroke="{grønn}" stroke-width="15" stroke-linecap="round"/>
<circle cx="218" cy="106" r="11" fill="{grønn}"/>
<path d="M120,62 C176,62 200,112 198,172 C196,232 166,262 120,262 C74,262 44,232 42,172 C40,112 64,62 120,62 Z" fill="{grønn}"/>
<ellipse cx="120" cy="212" rx="46" ry="36" fill="{hvit}" opacity=".22"/>
<ellipse cx="98" cy="140" rx="15" ry="17" fill="{hvit}"/>
<ellipse cx="142" cy="140" rx="15" ry="17" fill="{hvit}"/>
<circle cx="100" cy="144" r="8" fill="{mørk}"/>
<circle cx="144" cy="144" r="8" fill="{mørk}"/>
<circle cx="103" cy="140" r="3" fill="{hvit}"/>
<circle cx="147" cy="140" r="3" fill="{hvit}"/>
<ellipse cx="78" cy="170" rx="11" ry="6" fill="{korall}" opacity=".6"/>
<ellipse cx="162" cy="170" rx="11" ry="6" fill="{korall}" opacity=".6"/>
<path d="M104,170 Q120,188 136,170" fill="none" stroke="{mørk}" stroke-width="5" stroke-linecap="round"/>
<path d="M50,142 C50,56 190,56 190,142" fill="none" stroke="{korall}" stroke-width="8" stroke-linecap="round"/>
<ellipse cx="48" cy="148" rx="11" ry="17" fill="{korall}"/>
<ellipse cx="192" cy="148" rx="11" ry="17" fill="{korall}"/>
<path d="M50,164 Q58,194 90,192" fill="none" stroke="{korall}" stroke-width="5" stroke-linecap="round"/>
<circle cx="94" cy="192" r="6" fill="{korall}"/>
<path d="M156,10 h56 a14,14 0 0 1 14,14 v14 a14,14 0 0 1 -14,14 h-36 l-14,14 v-14 h-6 a14,14 0 0 1 -14,-14 v-14 a14,14 0 0 1 14,-14 Z" fill="{korall}"/>
<circle cx="170" cy="31" r="4.5" fill="{hvit}"/><circle cx="184" cy="31" r="4.5" fill="{hvit}"/><circle cx="198" cy="31" r="4.5" fill="{hvit}"/>
</svg>"""


FIGURER = {"fjord": fjord, "verksted": verksted, "vennlig": vennlig}

CSS = """
.hero{position:relative;isolation:isolate}
.figur{position:absolute;z-index:-1;bottom:-6px;width:210px;height:auto;pointer-events:none;animation:sveve 6s ease-in-out infinite}
.figur--h{right:0}
.figur--v{left:0;width:160px;transform:scaleX(-1);opacity:.55;animation-delay:-3s}
@keyframes sveve{50%{translate:0 -8px}}
@media (max-width:1000px){.figur--v{display:none}.figur--h{position:static;display:block;margin:0 auto 14px;width:120px}}
"""
