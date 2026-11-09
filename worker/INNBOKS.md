# Innboks: KI-sekretæren svarer på e-post og Facebook-meldinger

Bedriften videresender e-posten sin og kobler Facebook-siden til sekretæren. For hver ny melding lager sekretæren
et forslag til svar med samme kunnskap som telefonsekretæren (tjenester, priser, åpningstider fra profilen på `/lag`).
Bedriften får varsel på e-post (og SMS hvis ønsket), åpner innboks-siden, retter om nødvendig og trykker **Send**.

Koden ligger i `worker/innboks-worker.js` (egen worker, `orvelo-innboks`) og siden i `snakk/innboks.html`.
Den bruker samme KV-lager (`KUNDER`) som `orvelo-sekretar`, så profiler og rettekoder er de samme.

## Hvordan det virker

```
Kunde ──e-post──> post@firma.no ──videresending──> inn-k3x9p2mq@svar.orvelo.no ─┐
Kunde ──Messenger──> Facebook-siden ──Meta webhook──> /meta ───────────────────────┤
                                                                                     ▼
                                          Grok lager svarforslag (sorterer bort reklame, spam, varsler)
                                                                                     ▼
                                    Varsel til bedriften  ──>  /innboks (godkjenn, rett, send eller dropp)
                                                                                     ▼
                       E-post: sendes fra «Firma <svar@svar.orvelo.no>», svar-til post@firma.no
                       Messenger: sendes fra Facebook-siden (innen 24 timer etter kundens melding)
```

- **Forslag til godkjenning er standard.** Ingenting går til sluttkunden før noen i bedriften trykker «Send».
- **Autosvar** finnes bare for Messenger og er av som standard. Slås det på, sendes bare svar som kun gjentar fakta
  fra profilen (åpningstider, adresse, priser) og ikke lover noe. Klager, penger og timeavtaler går alltid til godkjenning.
- E-post kan også sendes fra bedriftens egen e-post med knappen **Åpne i e-post** (fungerer uten Cloudflare-sending).
- Meldinger slettes automatisk etter 30 dager. Ukesrapporten får bare tema og kanal (ikke selve meldingen).
- Grensen er 60 svarforslag per firma per døgn (`MAKS_PER_DAG`), så en spam-storm ikke koster noe særlig.

## Oppsett for Preben (én gang)

### 1. Flytt DNS for orvelo.no til Cloudflare (gratis, ca. 15 minutter)
Cloudflare kan bare ta imot og sende e-post for domener der Cloudflare styrer DNS. Domeneshop er fortsatt registrar.
1. Cloudflare → **Add a domain** → `orvelo.no` → Free. Cloudflare kopierer DNS-postene. Sjekk at disse er med:
   GitHub Pages-postene (A/CNAME for orvelo.no og www), MX, SPF (TXT) og DMARC (TXT).
2. Domeneshop → orvelo.no → **Navnetjenere** → bytt til de to Cloudflare viser. Det tar fra minutter til noen timer.
3. Sjekk at https://orvelo.no fortsatt virker og at e-post til orvelo.no kommer frem.

### 2. Slå på e-post for `svar.orvelo.no`
1. Cloudflare → orvelo.no → **Email → Email Routing** → **Enable** for underdomenet `svar.orvelo.no`
   (rører ikke e-posten på selve orvelo.no).
2. **Routing rules → Catch-all** → Action **Send to a Worker** → `orvelo-innboks`.
3. **Email → Email Sending** → legg til `svar.orvelo.no` og legg inn DNS-postene den foreslår (SPF/DKIM).

### 3. Lag workeren
1. Workers & Pages → Create → Worker → navn `orvelo-innboks` → Deploy → **Edit code** → lim inn hele
   `worker/innboks-worker.js` → Deploy.
2. **Settings → Bindings**: KV namespace `KUNDER` → `orvelo-kunder`. **Send email** med navn `EMAIL`.
3. **Settings → Variables and Secrets**:
   - `XAI_API_KEY` (Secret) og `ADMIN_KODE` (Secret): de samme som på `orvelo-sekretar`
   - `SVAR_DOMENE` (Text): `svar.orvelo.no`
   - Valgfritt for SMS-varsel: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (samme som ringeagenten)

### 4. Koble en kunde
1. Åpne `https://orvelo-innboks.<ditt-navn>.workers.dev/oppsett`, skriv admin-koden og sekretær-id-en (fra `/lag`).
2. Fyll inn bedriftens egen e-post og hvor varselet skal, og trykk **Lagre oppsett**.
   Du får en adresse som `inn-k3x9p2mq@svar.orvelo.no` og lenken til bedriftens innboks.
3. Bruk **Test et svarforslag** nederst på siden for å se hvordan svarene blir før kunden kobles på.
4. Bedriften setter opp videresending (se under). Innboks-lenken bruker samme kode som rette-lenken på `/rediger`.

### Videresending hos bedriften
- **Gmail / Google Workspace:** Innstillinger → Videresending og POP/IMAP → Legg til en videresendingsadresse.
  Gmail sender en bekreftelse til sekretæren: den dukker opp i innboksen som «Bekreft videresending fra Gmail»
  med lenken. Velg «Behold Gmails kopi i innboksen».
- **Outlook / Microsoft 365:** Innstillinger → E-post → Videresending → slå på og lim inn adressen. Huk av
  «Behold en kopi». (Noen 365-kontoer har ekstern videresending sperret av administrator.)
- **Domeneshop webmail:** Kontrollpanel → E-post → Videresending → legg til adressen, behold kopi.
- Fungerer også for hånd: videresend én e-post, så finner sekretæren den egentlige avsenderen.

## Facebook / Messenger (krever godkjenning fra Meta)

Koden er klar (`/meta`), men Meta må godkjenne appen før den kan svare på meldinger fra vanlige folk.
1. https://developers.facebook.com → **Create app** → type **Business**. Koble den til Orvelo sin Business-konto.
2. **Business-verifisering** (Meta Business Settings → Security Center): last opp bevis for ENK-en (org.nr. 938 720 673).
3. Legg til produktet **Messenger** → **Webhooks**: Callback URL `https://orvelo-innboks.<ditt-navn>.workers.dev/meta`,
   Verify token = et ord du velger. Abonner på `messages`.
4. Legg inn i workeren: `META_APP_SECRET` (App settings → Basic → App secret) og `META_VERIFY_TOKEN` (ordet over).
5. **App Review**: be om **Advanced Access** til `pages_messaging` (og `pages_manage_metadata`, `pages_show_list`).
   Meta vil ha en skjermvideo av hvordan det brukes og en personvernerklæring (lenke til orvelo.no/personvern).
   Regn med 1–4 uker.
6. Til testing før godkjenning: legg til deg selv og en testperson som **Tester** på appen. Da virker alt for dem.
7. For hver kunde: kunden gir deg tilgang til Facebook-siden (eller logger inn med Facebook Login når det er bygget),
   du henter **side-id** og **Page access token** (Graph API Explorer → velg siden → «Get Page Access Token»,
   bytt til en langtidsnøkkel) og legger dem inn på `/oppsett`.

Regler fra Meta: Siden kan svare innen 24 timer etter kundens siste melding. Etter det må bedriften svare selv i
Facebook. Instagram-meldinger kan legges til senere på samme måte (`instagram_manage_messages`).

## Personvern (databehandleravtalen)

- Dagens databehandleravtale dekker allerede «innholdet i samtalen» og underleverandørene Cloudflare, xAI (med nullagring)
  og Twilio. Ingen ny underleverandør trengs for e-post. Meta er ikke underleverandør: det er bedriftens egen Facebook-side.
- E-post kan inneholde mer enn en telefonsamtale (vedlegg, sitater, andres opplysninger). Vedlegg leses ikke,
  sitert tekst fjernes, og meldingene slettes etter 30 dager.
- Forslag til ny tekst i punktet «Formål og type opplysninger» (bør tas med i juridisk sjekk):
  > «... svare på henvendelser på telefon, chat, e-post og meldinger i sosiale medier som kunden kobler til, ...
  > E-post og meldinger lagres i inntil 30 dager. Vedlegg behandles ikke.»
- Sidenøkler fra Facebook ligger i Cloudflare KV (kryptert lagring) og vises aldri på innboks-siden.

## Teste lokalt

`node tools/test-innboks.mjs` tester e-postlesing (Outlook, Gmail, videresendt), løkkesperre, innboks og sending med
falske tjenester. `XAI_API_KEY=... node tools/test-innboks.mjs ekte` lager i tillegg ekte svarforslag med Grok.
Ingenting sendes i noen av testene.
