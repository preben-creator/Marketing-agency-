# Orvelo KI-sekretær – nettside

En statisk side for Orvelos KI-sekretær for håndverkere: HTML, CSS og JavaScript i én fil, uten byggesteg. Den kjører gratis på GitHub Pages.

## Filer

- `index.html`: hele siden (tekst, demo, pakker, priser, spørsmål og svar, kontaktskjema). CSS og JS ligger i samme fil.
- `assets/orvelo-logo.svg`, `assets/favicon.svg`: logo og fane-ikon
- `demo/index.html`: videresender gamle demo-lenker til forsiden og beholder `?bransje=` og `?firma=`

## Tilpasse

- **Demo for en kunde:** `?bransje=ror|el|snekker|maler|tak|flis|varme&firma=Firmanavn`, for eksempel `https://preben-creator.github.io/marketing-agency-/?bransje=el&firma=Berg%20Elektro%20AS#demo`
- **Pakker og priser:** søk etter `id="pakker"` i `index.html`.
- **Kontaktskjema:** lag et gratis skjema på [formspree.io](https://formspree.io) og sett adressen i skjemaets `action`.
- **E-post:** `hei@orvelo.no` er en plassholder. Bytt den ut med din egen.
- **Stemme:** demoen bruker nettleserens norske stemmer. De beste (Pernille og Finn) finnes i Microsoft Edge.

## Publisere på GitHub Pages

Settings → Pages → Deploy from a branch → `main` og `/ (root)`.
