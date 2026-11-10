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

## Booking med kalender og SMS-bekreftelse (tillegget «kalender»)

Slås på per kunde på `/lag` → «4. Tilleggstjenester» → «Booking med kalender». Da:

- **booker chatten timen selv** (i stedet for å sende en forespørsel). Timen lagres i `timer:<id>`, og tiden blir opptatt for nye bookinger. Timer bedriften legger inn selv på `/sms`-siden blir også opptatt.
- **får sluttkunden SMS** med bekreftelse og en lenke til `/t/<kode>`: «Legg i Google Kalender», «Legg i iPhone- eller Outlook-kalender» (.ics) og «Avbestill timen». Avbestiller kunden, blir tiden ledig igjen, og bedriften får e-post.
- **ser bedriften timene** på `/sms`-siden, og kan abonnere på sin egen kalender-feed (`/kal/<id>/<nøkkel>.ics`) i Google Kalender, Outlook eller iPhone. Google henter feeden noen ganger i døgnet; iPhone og Outlook oftere.
- **får bedriften e-post** for hver ny time (til «Varsel-e-post» under chat-innstillingene, ellers til Preben).

Samme sikkerhet som SMS-tilleggene: ingenting sendes før `SMS_PA = ja`, og så lenge «Ekte utsending» er av, går SMS-en til `SMS_TEST_NUMMER`. Bookes det mellom 21 og 08, sendes bekreftelsen kl. 08 av cron-runden (`*/15 * * * *`). Med demokode (prøvemodus) lagres og sendes ingenting. Er mobilnummeret ikke norsk, blir det en vanlig forespørsel som før.

Telefonsekretæren kan bruke samme `leggInnTime(env, id, profil, cfg, {...}, "telefon")` når den går live.

## Ukesrapport til kundene (`/rapport`)

Hver mandag morgen lager workeren en rapport for forrige uke til hver kunde: antall samtaler og chatter, hva kundene ville
(bestille time, pris, åpningstider …), nye bookinger, beskjeder, tapte anrop og hvor mange minutter som er brukt av pakken denne måneden.

**Hva som lagres (personvern):** når en samtale på sekretærsiden er ferdig, sender siden utskriften til workeren. Grok lager ett kort tema
(uten navn og nummer), og bare dette lagres i KV: tidspunkt, kanal, varighet, tema, kategori, bookinger og beskjeder med fornavn og de
to siste sifrene i mobilnummeret. Utskriften og lyd lagres ikke. Alt slettes automatisk etter 62 dager. Gjelder bare lenker med `?kunde=`.

Oppsett:

1. Lim inn den nye `worker/sekretar-worker.js` og trykk **Deploy**. Da begynner loggingen.
2. **Settings → Triggers → Cron Triggers → Add** (i tillegg til `*/15 * * * *` for SMS): `0 6 * * 1` (mandag kl. 07 vinter / 08 sommer). Uten flere innstillinger
   får du da bare en oversikt på e-post hver mandag. Ingenting går til kundene.
3. Åpne `/rapport`, skriv admin-koden, velg kunde og trykk **Eksempel med oppdiktede tall** eller **Forrige uke**.
4. For å sende til kundene: lag gratis konto på [resend.com](https://resend.com), legg til domenet `orvelo.no` og legg inn
   DNS-postene Resend viser hos Domeneshop. Sett så i Cloudflare:
   - Secret `RESEND_API_KEY` = nøkkelen fra Resend
   - (valgfritt) Text `RAPPORT_FRA` = `Orvelo <rapport@orvelo.no>`
   - Text `RAPPORT_SEND` = `ja` (først når du vil at kundene skal få rapporten)
5. På `/rapport`: skriv kundens e-post, velg pakke, kryss av «Send rapporten til kunden hver mandag» og trykk **Lagre**.
   «Send forrige uke til meg» sender en prøve til deg først.

Kunden får rapporten bare når både `RAPPORT_SEND = ja` og avkrysningen er på. Du får alltid en kopi (blindkopi) og en oversikt.
Uker uten henvendelser sendes ikke. Andre kanaler (telefonlinje, chat, SMS, tilbakeringing) kan logge til samme rapport med `loggHendelse()`.

## Chat på kundens nettside

Samme sekretær kan svare skriftlig i en chat-boble på kundens egen nettside.

1. Gå til `/lag`, åpne sekretæren (id) og trykk **Chat på kundens nettside**.
2. Velg farge, tekst på knappen og varsel-e-post (firmaets e-post). Sett **Chat: På** og lagre.
3. Kopier koden og lim den inn rett før `</body>` på kundens nettside (WordPress, Wix, Squarespace osv.):
   `<script src="https://orvelo-sekretar.preben-m-hilleren.workers.dev/chat.js" data-kunde="<id>" async></script>`
4. **Prøv chatten** åpner en prøveside med firmaets chat. Der lagres og sendes ingenting, så den passer også i salg.

Godt å vite:
- Chatten er av til du slår den på. Fyller du ut «Bare på disse domenene», virker den bare der.
- Kundens kalender er ikke koblet til ennå. En time fra chatten er en **forespørsel** som går på e-post til firmaet,
  og sekretæren sier at firmaet bekrefter. Ledige tider = åpningstider minus forespørsler som alt er kommet inn.
- Første e-post til en ny adresse kommer fra FormSubmit med en bekreftelseslenke firmaet må trykke på én gang.
- Bremser: 40 meldinger per 10 min per besøkende, og `CHAT_MAKS_DAG` (standard 400) meldinger per firma per døgn.
- Ingen nye innstillinger i Cloudflare trengs. Bare lim inn ny workerkode etter at PR-en er merget.

## Svar på e-post og Facebook (egen worker `orvelo-innboks`)

Se [INNBOKS.md](INNBOKS.md). Bruker samme KV-lager og rettekode som `/rediger`.

## Kontaktskjemaet på nettsiden (`/kontakt`)

Skjemaet på orvelo.no sender til `POST /kontakt` på denne workeren i stedet for FormSubmit.

- Henvendelsen lagres i KV (`henvendelse:<tid>:<id>`) og slettes automatisk etter 12 måneder, slik personvernerklæringen sier.
- Du får SMS om nye henvendelser når `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` og `TWILIO_FROM` er satt. Mottaker er `VARSEL_MOBIL` (Text, standard 412 32 557).
- Er `RESEND_API_KEY` satt, får du også e-post til `VARSEL_EPOST`. Det samme gjelder de andre varslene fra workeren, som da ikke lenger går via FormSubmit.
- Alle henvendelser som JSON: `/kontakt/liste?a=<ADMIN_KODE>`.

Nettsiden faller tilbake til FormSubmit bare hvis `/kontakt` svarer 404, altså før denne koden er lastet opp.
