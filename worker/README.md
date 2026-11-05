# Snakkbar KI-sekretær (live demo)

Siden `snakk/index.html` er en ekte KI-sekretær kunden kan ringe til fra nettleseren (tale eller tekst).
Den bruker Grok sin stemme-API. For at xAI-nøkkelen aldri skal ligge i nettsiden, går alt via en liten,
gratis Cloudflare Worker (`sekretar-worker.js`). Den viser siden og lager en nøkkel som bare varer i 60 sekunder per samtale.

## Oppsett (ca. 10 minutter, én gang)

1. Lag gratis konto på https://dash.cloudflare.com/sign-up og bekreft e-posten.
2. Gå til **Workers & Pages → Create → Create Worker** (velg «Hello World»). Kall den `orvelo-sekretar` og trykk **Deploy**.
3. Trykk **Edit code**, slett alt som står der, lim inn hele `worker/sekretar-worker.js`, og trykk **Deploy**.
4. Gå til workeren → **Settings → Variables and Secrets → Add**:
   - Type **Secret**, navn `XAI_API_KEY`, verdi: xAI-nøkkelen din (fra https://console.x.ai)
   - Type **Secret**, navn `DEMO_KODE`, verdi: en kode du velger, f.eks. `dejavu2026`
   Trykk **Deploy** / **Save**.
5. Lenken til kunden blir: `https://orvelo-sekretar.<ditt-navn>.workers.dev/?k=<DEMO_KODE>`

Siden hentes fra `main` i GitHub-repoet, så endringer i `snakk/index.html` kommer ut av seg selv (innen et par minutter) uten å røre Cloudflare.

## Kostnad og grenser

- Cloudflare Workers: gratis (100 000 forespørsler per dag).
- Grok-stemme: ca. 0,08 dollar per minutt samtale (ca. 85 øre). 20 dollar holder til rundt 250 minutter.
- Innebygde bremser: maks 10 minutter per samtale, legger på etter 75 sekunder stillhet, maks 8 samtaler per 30 min per nettverk,
  og lenken virker bare med riktig `?k=`-kode. Slå av automatisk påfylling i xAI-konsollen, så kan det aldri koste mer enn saldoen.

## Ny kunde

Legg til en blokk i `KUNDER` øverst i skriptet i `snakk/index.html` (navn, åpningstider, prisliste), og bruk `?firma=<nøkkel>&k=<kode>` i lenken.

## Teste lokalt

`XAI_API_KEY=... node tools/dev-snakk.mjs` og åpne http://localhost:8787/?k=test
