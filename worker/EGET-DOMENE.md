# Flytte lenkene fra workers.dev og github.io til orvelo.no

Status 2026-11-09: forberedt, ikke slått på. orvelo.no venter på delegering hos Norid.
Tråden «Koble orvelo.no til nettsiden» eier DNS og GitHub Pages. Gjør ingenting her før den sier at domenet virker.

## Mål

| Adresse | Peker på | I dag |
|---|---|---|
| orvelo.no / www.orvelo.no | GitHub Pages (nettsiden) | preben-creator.github.io/Marketing-agency-/ |
| app.orvelo.no | worker `orvelo-sekretar` (demo, /lag, /avtale, /rediger, /sms, /rapport, chat.js) | orvelo-sekretar.preben-m-hilleren.workers.dev |
| ring.orvelo.no | worker `orvelo-ring` (Telnyx-webhook) | orvelo-ring.preben-m-hilleren.workers.dev |
| innboks.orvelo.no | worker `orvelo-innboks` | orvelo-innboks.preben-m-hilleren.workers.dev |
| preben@orvelo.no | e-post (se under) | hilleren.bedrift@gmail.com |

## Rekkefølge

1. orvelo.no virker på GitHub Pages med HTTPS (domenetråden).
2. DNS flyttes til Cloudflare (planlagt av innboks-tråden for Email Routing). Pages-postene (4 A, 4 AAAA, www CNAME) legges inn med grå sky (DNS only).
3. Cloudflare → Workers → `orvelo-sekretar` → Settings → Domains & Routes → Add → Custom domain → `app.orvelo.no`. Cloudflare lager DNS-posten og sertifikatet selv. Det samme for `ring.` og `innboks.`.
4. La workers.dev-adressene stå på. Gamle lenker i sendte e-poster, signerte avtaler og kundenes nettsider skal fortsatt virke.
5. Bytt de faste lenkene under, i én PR, og deploy `orvelo-sekretar` fra main.

## Lenker som bygges automatisk

Workeren bruker `url.origin` for lenker til demo, signering, /rediger, /sms, kalender-feed og tapt-anrop-webhook. Åpner Preben /lag eller /avtale/ny på app.orvelo.no, får alle nye lenker app.orvelo.no uten kodeendring.

## Faste lenker som må byttes (steg 5)

- `worker/sekretar-worker.js`: `SEKRETAR_URL_DEFAULT` (eller sett tekstvariabelen `SEKRETAR_URL=https://app.orvelo.no` i Cloudflare), og `Referer`/`Origin` i FormSubmit-varselet.
- `snakk/lag.html`: `OPPSTART_URL` → `https://orvelo.no/oppstart/`.
- `snakk/chat.js`: kodesnutten i kommentaren → `https://app.orvelo.no/chat.js`.
- `avtale/ny.html`: `ORVELO.nettside` → `"orvelo.no"` (kommer da med i e-postsignaturen).
- `worker/README.md`, `worker/RINGEAGENT.md`, `worker/INNBOKS.md`, `README.md`: eksempel-lenker.
- Telnyx: webhook-URL for appen `orvelo-ring` → `https://ring.orvelo.no/telnyx`.
- Meta-appen (innboks): webhook → `https://innboks.orvelo.no/meta`.
- Utenfor repoet: kontrollrommet (knappene «Demo + tilbud» og «Egen KI-sekretær»), e-postmalene i prosjektmappen (salg/epost/), Google Bedriftsprofil, Avtaleplan-beskrivelsen.

Kundenes egne nettsider som allerede har `chat.js` fra workers.dev trenger ikke endres. Den adressen fortsetter å virke.

## E-post på eget domene

To veier. Velg én sammen med innboks-tråden, fordi begge rører MX-postene:

- **A. Domeneshop e-post** (inkludert i domenet): lag kontoen preben@orvelo.no hos Domeneshop, hent den inn i Gmail (POP) og send fra Gmail med «Send e-post som» via smtp.domeneshop.no. Ekte innboks, enkel å sette opp nå. MX må fortsatt peke til Domeneshop hvis DNS flyttes til Cloudflare.
- **B. Cloudflare Email Routing**: preben@orvelo.no videresendes til Gmail. Gratis, men Cloudflare sender ikke vanlig e-post, så «Send som» i Gmail trenger fortsatt en SMTP (f.eks. Domeneshop eller Resend).

Anbefaling: A for preben@orvelo.no, og Email Routing bare på underdomenet svar.orvelo.no for innboks-tjenesten. Da kolliderer de ikke.

Husk SPF-posten når «Send som» kommer på plass, og legg til DKIM fra den som sender.
