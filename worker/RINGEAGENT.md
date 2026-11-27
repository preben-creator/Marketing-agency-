# Orvelo ringeagent («ring meg»)

`ringeagent-worker.js` er en egen Cloudflare Worker. Den gir en «ring meg»-side der en bedrift legger inn mobilnummeret sitt.
Nummeret bekreftes med en SMS-kode (Twilio), og deretter ringer Petter (OpenAI Realtime, stemmen cedar) opp fra et norsk nummer via Telnyx. Han forteller om KI-sekretæren
og sender bookinglenken (Google Avtaleplan) på SMS. Etter samtalen får Preben et sammendrag på e-post.

Hvorfor SMS-kode og avkrysning: markedsføringsloven § 15 krever forhåndssamtykke for automatiske oppringinger til
privatpersoner (også ENK). SMS-koden beviser at det er eieren av nummeret som ba om samtalen, og hvert samtykke sendes til e-posten din som logg.

## Oppsett (ca. 10 minutter)

1. Cloudflare: **Workers & Pages → Create → Create Worker**, kall den `orvelo-ring`, trykk **Deploy**.
2. **Edit code**, slett alt, lim inn hele `worker/ringeagent-worker.js`, trykk **Deploy**.
3. **Settings → Variables and Secrets → Add**:
   - Secret `OPENAI_API_KEY` (platform.openai.com). Da snakker Petter med OpenAI Realtime (`gpt-realtime-2.1`) og stemmen cedar.
   - Secret `GEMINI_API_KEY` (valgfri reserve: Gemini Live, stemmen Aoede). Velg motor med variabelen `MOTOR` = `openai`, `gemini` eller `grok`.
   - Secret `XAI_API_KEY` (samme som i orvelo-sekretar). Brukes som reserve: uten `GEMINI_API_KEY`, eller med variabelen `MOTOR` = `grok`, går samtalene til Grok som før.
   - Secret `TWILIO_ACCOUNT_SID` og Secret `TWILIO_AUTH_TOKEN` (forsiden i Twilio-konsollen)
   - Text `TWILIO_FROM` = `+17372508034` (byttes til norsk nummer senere)
   - (valgfritt) Text `BOOKING_URL`, `VARSEL_EPOST`, `STEMME`
   - (valgfritt) Text `TEST_NUMMER` = ditt mobilnummer: hopper over SMS-koden (koden blir 0000). Twilio-prøvekonto kan ikke sende SMS til Norge.
4. Åpne `https://orvelo-ring.<ditt-navn>.workers.dev/` og test med din egen mobil.
   I e-poster kan du lenke til `...workers.dev/?firma=Bedriftsnavn`, så er firmanavnet fylt ut.

## Prøvekonto i Twilio

- Kan bare ringe og sende SMS til numre du har bekreftet i Twilio (din egen mobil). Greit for testing.
- Før samtalen spilles en engelsk melding om prøvekonto, og du må trykke en tast. Den forsvinner når kontoen oppgraderes.
- Husk **Voice Geographic Permissions → Norway** (og **Messaging Geographic Permissions → Norway** for SMS).

## Kostnad

- Twilio: ca. 0,08 dollar per minutt til norsk mobil + SMS (to per samtale).
- OpenAI Realtime (cedar): ca. 0,075 dollar per minutt (ca. 0,80 kr), målt 2026-11-17.
- Gemini Live (Aoede, reserve): ca. 0,04 dollar per minutt (målt 2026-11-17: 0,028 dollar for en samtale på 44 sekunder). Lengre samtaler blir litt dyrere per minutt.
- Grok-stemme (reserve): ca. 0,08 dollar per minutt.

Lokal test av en hel telefonsamtale (falsk Telnyx-strøm, ingenting ringes eller sendes): se `tools/test-petter-samtale.mjs`.
- En samtale på 3 minutter koster rundt 5 kroner.
- Samtaler avsluttes automatisk etter 8 minutter. Bremser: maks 5 kodeforespørsler per time per nettverk og 3 per nummer.

## Hvis samtalen faller ut etter noen sekunder

Gratisplanen til Cloudflare Workers har en lav grense for CPU-tid. Lange telefonsamtaler kan da bli kuttet.
Da må du oppgradere til **Workers Paid** (5 dollar i måneden).

## E-postvarsler

Sammendrag og samtykker sendes via FormSubmit til `hilleren.bedrift@gmail.com`. Første gang kommer en
aktiverings-e-post fra FormSubmit, som du må trykke **Activate** i.

## Norsk nummer via Telnyx (samtalene)

Twilio har ikke norske nummer på lager, og norske operatører stopper anrop fra utlandet som viser et norsk mobilnummer.
Derfor går selve samtalene via Telnyx, som har norske lokalnummer. SMS-ene går fortsatt via Twilio fra avsendernavnet «Orvelo».

1. Lag konto på telnyx.com, fyll ut firmaopplysninger og fyll på litt saldo.
2. **Voice → Programmable Voice → Create Voice App** (Voice API Application):
   - Navn: `orvelo-ring`
   - Webhook URL: `https://orvelo-ring.<ditt-navn>.workers.dev/telnyx`
   - Lagre og kopier **App ID** (det er `TELNYX_CONNECTION_ID`).
3. **Voice → Outbound Voice Profiles → Add new profile**: tillat Norge, og koble profilen til `orvelo-ring`-appen.
4. **Numbers → Search & Buy → Norway**, kjøp et lokalnummer (last opp registerutskriften fra Brønnøysund hvis de spør).
   Under nummerets innstillinger velger du `orvelo-ring` som Voice-tilkobling.
5. **Account Settings → API Keys → Create API Key**.
6. Cloudflare, `orvelo-ring` → Settings → Variables and Secrets:
   - Secret `TELNYX_API_KEY` = nøkkelen fra steg 5
   - Text `TELNYX_CONNECTION_ID` = App ID fra steg 2
   - Text `TELNYX_FROM` = det norske nummeret, f.eks. `+4755123456`
   - Lim inn nyeste `worker/ringeagent-worker.js` og trykk **Deploy**.

Når alle tre `TELNYX_*` er satt, ringer workeren via Telnyx. Fjerner du dem, går den tilbake til Twilio (`TWILIO_FROM`).

SMS-ene kommer fra avsendernavnet «Orvelo» (kan endres med `SMS_AVSENDER`).

## Norsk nummer via Twilio (fra 27.11.2026)

Twilio leverte et norsk lokalnummer (+47 55 60 83 23) etter at bundelen «Orvelo Norge» ble godkjent.

- **Ringe ut:** sett `TWILIO_FROM` = `+4755608323`. Workeren ringer via Telnyx så lenge alle tre `TELNYX_*` er satt,
  så `TELNYX_FROM` må være slettet for at Twilio skal brukes.
- **Ta imot samtaler** (Orvelos demonummer eller en kundes telefonlinje): i Twilio-konsollen, Phone Numbers → Manage →
  Active numbers → nummeret → Voice Configuration:
  - A call comes in: **Webhook**, `https://orvelo-ring.preben-m-hilleren.workers.dev/twilio/innring`, **HTTP POST**
  - Lagre. Webhooken sjekker Twilio-signaturen (med `TWILIO_AUTH_TOKEN`), så adressen må være nøyaktig den samme som her.
- **Kundens telefonlinje:** kjøp ett Twilio-nummer per kunde (Norway, Local, bundelen «Orvelo Norge»), sett webhooken som over,
  og legg nummeret inn på `/lag` (del 4, Telefonlinje). Kunden viderekobler firmatelefonen sin til nummeret
  (ved ikke svar/opptatt, eller alltid). Da svarer Petter som kundens egen sekretær: ledige tider, booking, SMS og beskjeder.
- Et nummer som ikke står på `/lag`, svarer som Orvelos demonummer (spør hvilket firma du ringer fra og spiller sekretæren deres).

### Demonummeret: velg Petter eller Eva

Ringer noen Orvelos demonummer (et nummer som ikke står på `/lag`), hilser Petter som før og spør så:
«Vil du ha en mannlig eller kvinnelig KI-sekretær?» Svarer de kvinnelig, tar Eva (stemmen marin) over samtalen.
Hun får med seg det som er sagt så langt. Det virker bare med OpenAI som motor. Variabelen `STEMMEVALG` = `av` slår spørsmålet av.
Kundenes egne nummer spør ikke. Der brukes stemmen som er valgt på `/lag`.

### Demonummeret: firmaer uten sekretær

Har Orvelo ikke laget en sekretær for firmaet som ringer, søker Petter i Brønnøysundregistrene og spør om det er riktig firma.
Svarer innringeren ja, lager han en prøve-sekretær mens de venter, på samme måte som «Lag din egen demo» på orvelo.no.
Det tar rundt et halvt minutt. Sekretæren lages ut fra Brønnøysund og nettsiden til firmaet, og lagres i 14 dager.
Grenser: samme dagsgrense som på nettsiden (`PROV_PER_DAG`), høyst 3 per innringer per døgn og 2 per samtale.
Dette skjer i orvelo-sekretar (`/telefon/firmasok` og `/telefon/lagdemo`).
