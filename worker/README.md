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

## Lag en egen sekretær for hver bedrift (knappen «Lag sekretær»)

Siden `/lag` på workeren lager en sekretær for et hvilket som helst firma. Grok leser firmaets nettside
(forsiden pluss sider om priser, tjenester, kontakt og om oss) og lager en profil med tjenester, priser,
åpningstider, ansatte og område. Du får en lenke som `/?kunde=berg-ror-x7k2&k=<kode>` som du kan sende kunden. Hvert firma får sin egen kode (lagres i KV), så lenken viser aldri koden eller navnet til en annen kunde. Lenker som alt er sendt med den gamle felles `DEMO_KODE` virker fortsatt.
Før du sender: se over feltene på siden (spesielt listen «Sjekk dette»), rett det som er feil og trykk «Lagre endringer».

Oppsett én gang (ca. 5 minutter):

1. Cloudflare: **Storage & Databases → KV → Create** og kall den `orvelo-kunder`.
2. Workeren `orvelo-sekretar` → **Settings → Bindings → Add → KV namespace**. Variabelnavn `KUNDER`, velg `orvelo-kunder`. Lagre.
3. **Settings → Variables and Secrets → Add**: type **Secret**, navn `ADMIN_KODE`, verdi: et passord bare du vet.
4. **Edit code**: lim inn den nye `worker/sekretar-worker.js` (hele filen) og trykk **Deploy**.
5. Åpne `https://orvelo-sekretar.<ditt-navn>.workers.dev/lag`, skriv inn firma, nettside og admin-koden.

Lenken kan fylles ut på forhånd, f.eks. fra kontrollrommet:
`/lag?firma=Berg%20R%C3%B8r%20AS&nettside=bergror.no&bransje=R%C3%B8rlegger&kontaktperson=Ole`

Hver ny sekretær koster ca. 1–3 øre i Grok-bruk (lesing av nettsiden). Profilene ligger i KV (gratis opptil 1000 lagringer per dag).

Deja Vu-lenken uten `?kunde=` virker som før. Du kan fortsatt legge en fast blokk i `KUNDER` øverst i `snakk/index.html`
og bruke `?firma=<nøkkel>&k=<kode>`.

## Teste lokalt

`XAI_API_KEY=... node tools/dev-snakk.mjs` og åpne http://localhost:8787/?k=test

## Tilbud og avtale med digital signering (`/avtale`)

Samme worker lager tilbud med 12 måneders avtale som kunden signerer på nett. Det bruker KV-lageret `KUNDER` og `ADMIN_KODE`
som allerede er satt opp, så det eneste du må gjøre er å lime inn den nye `worker/sekretar-worker.js` og trykke **Deploy**.

1. Åpne `https://orvelo-sekretar.<ditt-navn>.workers.dev/avtale/ny`, fyll inn kunden og prisene, og skriv admin-koden.
   «Forhåndsvis» viser dokumentet før du lager det.
2. Trykk **Lag tilbud og signeringslenke**. Du får en lenke `/avtale?id=..&t=..` og et forslag til e-post (åpnes i Gmail, sendes ikke av seg selv).
3. Kunden åpner lenken, leser tilbudet og vilkårene, velger alternativ A eller B, fyller inn navn, rolle, org.nr. og e-post,
   tegner signatur (valgfritt) og trykker **Signer avtalen**.
4. Workeren lagrer navn, tidspunkt, IP-adresse og en SHA-256-kontrollsum av avtaleteksten, og sender deg en e-post via FormSubmit.
   Kunden ser den signerte avtalen med en gang og kan lagre den som PDF. Samme lenke viser alltid den signerte kopien.
5. Listen nederst på `/avtale/ny` viser alle tilbud og om de er signert.

Vilkårene ligger i `avtale/vilkar.html`. En kopi låses inn i hvert tilbud når det lages, så endringer gjelder bare nye tilbud.
Valgfritt: `VARSEL_EPOST` (Text) hvis varslene skal til en annen e-post enn hilleren.bedrift@gmail.com.

PDF-maler (tom mal for papir og utfylt Deja Vu-eksempel): `node tools/lag-avtale-pdf.mjs [utmappe]`.

## Kunden retter sin egen sekretær (/rediger)

Kunden kan selv rette tjenester, priser, varighet (hvor lang tid som settes av i kalenderen), åpningstider,
ansatte, kontaktinfo og «dette bør sekretæren vite». Firmanavn, bransje og type kan bare du endre.

1. Åpne `/lag`, skriv admin-koden, og åpne sekretæren (enten rett etter at du har laget den, eller under
   «Åpne en sekretær du har laget før» med id-en, f.eks. `deja-vu-frisor-089t`).
2. Trykk **Lenke kunden kan rette selv**. Du får en lenke som `/rediger?kunde=<id>&r=<rettekode>`. Send den til kunden.
3. Når kunden lagrer, får du e-post (via FormSubmit til `VARSEL_EPOST`) med hva som er endret.
   De 10 forrige versjonene ligger i KV under `historikk:<id>`.

Rettekoden ligger i KV under `rediger:<id>` og er en annen enn `DEMO_KODE`, så de som bare har demolenken kan ikke endre noe.
Siden hentes fra `snakk/rediger.html` på GitHub. Ingen nye innstillinger trengs, men den nye workerkoden må limes inn i Cloudflare én gang.

## Tilleggstjenester på SMS: påminnelse, tapt anrop og Google-anmeldelse

Samme worker kan sende SMS til kundene til kundene dine:

1. **Bekreftelse og påminnelse før timen** (standard 24 timer før). Gir færre som ikke møter opp.
2. **SMS ved tapt anrop**: «Du ringte Deja Vu, men vi fikk ikke tatt telefonen. Vi ringer deg tilbake.» Kunden får en liste over hvem som skal ringes tilbake.
3. **Be om Google-anmeldelse** et par timer etter timen, bare til dem som har sagt ja. Hver SMS har en «nei takk»-lenke.

SMS sendes aldri mellom 21 og 08. Navn og mobilnummer slettes en uke etter timen, tapte anrop etter 14 dager.

### Trygt som standard
- Ingenting sendes før `SMS_PA` = `ja`.
- Så lenge «Ekte utsending» ikke er krysset av for en kunde, går alle SMS-ene til `SMS_TEST_NUMMER` (din mobil) med «[TEST ...]» foran.
- Maks 200 SMS per kunde per dag (`SMS_MAKS_DAG`).

### Oppsett (én gang, ca. 5 minutter)
1. `orvelo-sekretar` → **Settings → Variables and Secrets**:
   - Secret `TWILIO_ACCOUNT_SID` og Secret `TWILIO_AUTH_TOKEN` (samme som i `orvelo-ring`)
   - Text `SMS_TEST_NUMMER` = mobilen din, f.eks. `41232557`
   - Text `SMS_PA` = `ja`
   - (valgfritt) Text `TWILIO_FROM` = reservenummer hvis avsendernavnet blir avvist
2. **Settings → Triggers → Cron Triggers → Add**: `*/15 * * * *` (sjekker hvert kvarter om noe skal sendes).
3. Lim inn nyeste `worker/sekretar-worker.js` og trykk **Deploy**.

### Slik bruker du det
1. Åpne `/lag`, skriv admin-koden, åpne sekretæren (id) og velg **4. Tilleggstjenester på SMS**.
2. Kryss av det kunden har kjøpt, lim inn Google-anmeldelseslenken og trykk **Lagre tillegg**.
3. Trykk **Send test-SMS til meg** for hver type og se at teksten er riktig.
4. Send kunden lenken til siden `/sms?kunde=..&r=..`. Der legger de inn timer, ser tapte anrop og hva som er sendt.
   Siden har samme kode som rette-siden (`/rediger`), og rette-siden lenker dit.
5. Når kunden er fornøyd: kryss av **Ekte utsending** og lagre.

### Tapte anrop
Telefonsystemet (for eksempel Telnyx når kundens nummer viderekobles til oss) sender
`POST /tillegg/tapt?kunde=<id>&nokkel=<nøkkel>` med `{"fra":"+4791234567"}`. Adressen står på `/lag`.
Samme nummer innen 2 timer gir bare én SMS. Fasttelefoner får ikke SMS, men havner i listen.

### Kostnad
Twilio til norsk mobil: ca. 0,8 kr per SMS (160 tegn). Anmeldelses-SMS-en er to SMS fordi den har to lenker.
Tekstene unngår tegn som «» og lange streker, siden de gjør SMS-en tre ganger så dyr.

## Svar på e-post og Facebook (egen worker `orvelo-innboks`)

Se [INNBOKS.md](INNBOKS.md). Bruker samme KV-lager og rettekode som `/rediger`.
