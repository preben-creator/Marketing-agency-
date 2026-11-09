# Orvelo KI-sekretær – nettside

En statisk side for Orvelos KI-sekretær for håndverkere: HTML, CSS og JavaScript i én fil, uten byggesteg. Den kjører gratis på GitHub Pages.

## Filer

- `index.html`: hele siden (tekst, demo, pakker, priser, spørsmål og svar, kontaktskjema). CSS og JS ligger i samme fil.
- `assets/orvelo-logo.svg`, `assets/favicon.svg`: logo og fane-ikon
- `demo/index.html`: videresender gamle demo-lenker til forsiden og beholder `?bransje=` og `?firma=`

## Tilpasse

- **Demo for en kunde:** `?bransje=ror|el|snekker|maler|tak|flis|varme&firma=Firmanavn`, for eksempel `https://orvelo.no/?bransje=el&firma=Berg%20Elektro%20AS#demo`
- **Pakker og priser:** søk etter `id="pakker"` i `index.html`.
- **Kontaktskjema og e-post:** skjemaet sendes via [FormSubmit](https://formsubmit.co) til hilleren.bedrift@gmail.com. Første gang noen sender skjemaet kommer en aktiveringsmail, og den må bekreftes én gang.
- **Stemme:** demoen bruker nettleserens norske stemmer. De beste (Pernille og Finn) finnes i Microsoft Edge.

## Publisere på GitHub Pages

Settings → Pages → Deploy from a branch → `main` og `/ (root)`. Siden ligger på https://orvelo.no (GitHub bygger den på nytt hver gang noe flettes inn i `main`). Filen `CNAME` forteller GitHub hvilket domene siden bruker, og gamle lenker til https://preben-creator.github.io/Marketing-agency-/ sendes automatisk videre dit.

### Domenet orvelo.no (Domeneshop)

DNS hos Domeneshop (Mine domener → orvelo.no → DNS):

| Vert | Type | Data |
|---|---|---|
| (tom) | A | 185.199.108.153 |
| (tom) | A | 185.199.109.153 |
| (tom) | A | 185.199.110.153 |
| (tom) | A | 185.199.111.153 |
| (tom) | AAAA | 2606:50c0:8000::153 |
| (tom) | AAAA | 2606:50c0:8001::153 |
| (tom) | AAAA | 2606:50c0:8002::153 |
| (tom) | AAAA | 2606:50c0:8003::153 |
| www | CNAME | preben-creator.github.io |

I GitHub: Settings → Pages → Custom domain = `orvelo.no`, og kryss av for **Enforce HTTPS** når sertifikatet er klart.
