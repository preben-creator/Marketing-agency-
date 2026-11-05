# Orvelo KI-sekretær – nettside

En statisk side for Orvelos KI-sekretær for håndverkere: HTML, CSS og JavaScript i én fil, uten byggesteg. Den kjører gratis på GitHub Pages.

## Filer

- `index.html`: hele siden (tekst, demo, pakker, priser, spørsmål og svar, kontaktskjema). CSS og JS ligger i samme fil.
- `assets/orvelo-logo.svg`, `assets/favicon.svg`: logo og fane-ikon
- `demo/index.html`: videresender gamle demo-lenker til forsiden og beholder `?bransje=` og `?firma=`

## Tilpasse

- **Demo for en kunde:** `?bransje=ror|el|snekker|maler|tak|flis|varme&firma=Firmanavn`, for eksempel `https://preben-creator.github.io/Marketing-agency-/?bransje=el&firma=Berg%20Elektro%20AS#demo`
- **Pakker og priser:** søk etter `id="pakker"` i `index.html`.
- **Kontaktskjema og e-post:** skjemaet sendes via [FormSubmit](https://formsubmit.co) til hilleren.bedrift@gmail.com. Første gang noen sender skjemaet kommer en aktiveringsmail, og den må bekreftes én gang.
- **Stemme:** demoen bruker nettleserens norske stemmer. De beste (Pernille og Finn) finnes i Microsoft Edge.

## Publisere på GitHub Pages

Settings → Pages → Deploy from a branch → `main` og `/ (root)`. Siden ligger på https://preben-creator.github.io/Marketing-agency-/ (GitHub bygger den på nytt hver gang noe flettes inn i `main`).
