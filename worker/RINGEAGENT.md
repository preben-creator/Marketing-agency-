# Orvelo ringeagent («ring meg»)

`ringeagent-worker.js` er en egen Cloudflare Worker. Den gir en «ring meg»-side der en bedrift legger inn mobilnummeret sitt.
Nummeret bekreftes med en SMS-kode, og deretter ringer Ara (Grok-stemmen) opp via Twilio. Hun forteller om KI-sekretæren
og sender bookinglenken (Google Avtaleplan) på SMS. Etter samtalen får Preben et sammendrag på e-post.

Hvorfor SMS-kode og avkrysning: markedsføringsloven § 15 krever forhåndssamtykke for automatiske oppringinger til
privatpersoner (også ENK). SMS-koden beviser at det er eieren av nummeret som ba om samtalen, og hvert samtykke sendes til e-posten din som logg.

## Oppsett (ca. 10 minutter)

1. Cloudflare: **Workers & Pages → Create → Create Worker**, kall den `orvelo-ring`, trykk **Deploy**.
2. **Edit code**, slett alt, lim inn hele `worker/ringeagent-worker.js`, trykk **Deploy**.
3. **Settings → Variables and Secrets → Add**:
   - Secret `XAI_API_KEY` (samme som i orvelo-sekretar)
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
- Grok-stemme: ca. 0,08 dollar per minutt.
- En samtale på 3 minutter koster rundt 5 kroner.
- Samtaler avsluttes automatisk etter 8 minutter. Bremser: maks 5 kodeforespørsler per time per nettverk og 3 per nummer.

## Hvis samtalen faller ut etter noen sekunder

Gratisplanen til Cloudflare Workers har en lav grense for CPU-tid. Lange telefonsamtaler kan da bli kuttet.
Da må du oppgradere til **Workers Paid** (5 dollar i måneden).

## E-postvarsler

Sammendrag og samtykker sendes via FormSubmit til `hilleren.bedrift@gmail.com`. Første gang kommer en
aktiverings-e-post fra FormSubmit, som du må trykke **Activate** i.
