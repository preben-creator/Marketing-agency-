# Ukentlig KI-nyhetsagent (instruks)

Denne filen er oppskriften den planlagte oppgaven følger hver mandag. Endre den her, så gjelder det fra neste uke.

## Mål
1. Et innlegg på orvelo.no/nyheter/ med ukens viktigste KI-nyheter for norske småbedrifter (håndverkere, frisører, servicebedrifter). Skrevet på norsk bokmål, nyttig og bra for SEO.
2. To e-poster til Preben: en bedriftsbriefing om hva som kan påvirke Orvelo, og en om nettsideinnlegget som venter på godkjenning.
3. Innlegget publiseres IKKE av agenten. Det legges som en PR som Preben godkjenner ved å trykke «Merge».

## Steg
1. Finn nyheter fra de siste 7 dagene (mandag til søndag). Søk bredt, for eksempel:
   - OpenAI, Google (Gemini, Workspace), Microsoft (Copilot), Anthropic (Claude), Meta, xAI, ElevenLabs, Telnyx/Twilio (tale og telefoni)
   - Norge: Digital Norway, NHO, Abelia, Datatilsynet, Digdir, E24, DN, Kode24, Shifter
   - EU: KI-forordningen (AI Act), personvern
   - Gode oppsummeringer å starte fra: lilachbullock.com «AI News This Week for Small Business», theneuron.ai
2. Sjekk hver nyhet mot en primærkilde (selskapets egen side, endringslogg eller en norsk avis) før den tas med. Usikre eller motstridende saker tas ikke med. Skriv aldri en dato, et tall eller et navn du ikke har sett i en kilde.
3. Velg 4 til 6 hovedsaker og 2 til 4 korte «Også verdt å vite». Prioriter det en småbedrift kan bruke denne uken, det som endrer hvordan kunder finner bedrifter (søk, ChatGPT, Google), telefon/tale/chat-agenter, og norske saker. Merk saker som bare gjelder USA med `<span class="merke usa">Bare USA</span>` og norske med `<span class="merke norge">Norge</span>`.
4. Lag mappen `nyheter/ÅÅÅÅ-uke-NN/` (ISO-uke for mandagen innlegget publiseres) med `index.html`. Kopier forrige ukes innlegg som mal og behold strukturen: eyebrow, h1, ingress, meta-linje, «Kort fortalt», nummererte h2 med `.kort` (hva skjedde, «Hva betyr det for deg?», kilde), «Også verdt å vite» og footer.
5. Oppdater i samme PR:
   - `nyheter/index.html`: nytt `<li class="kort">` rett under `<!-- NYE INNLEGG HER (nyeste øverst) -->`
   - `nyheter/feed.xml`: nytt `<item>` rett under markøren
   - `sitemap.xml`: ny `<url>` rett under `<!-- NYE INNLEGG HER -->`, og sett `lastmod` på `/nyheter/` til dagens dato
6. Kjør `node tools/test-nyheter.mjs`. Den må være grønn.
7. Lag en gren `nyheter/ÅÅÅÅ-uke-NN`, commit, push og åpne en PR mot `main` med tittel «KI-nytt uke NN: <kort tittel>». Sett preben-creator som assignee.
8. Send de to e-postene (se under).

## Skrivestil for innlegget
- Norsk bokmål, korte setninger, du-form. Ingen tankestreker som pynt, ingen engelske moteord når det finnes et norsk ord (skriv «KI», ikke «AI»).
- Tittel (h1) og `<title>` skal nevne de to viktigste sakene konkret. `<title>` slutter med « – Orvelo». `meta description` 140 til 160 tegn.
- «Hva betyr det for deg?» skal alltid gi ett konkret råd en håndverker eller frisør kan gjøre denne uken.
- Innleggene er nøytral, nyttig informasjon for bedrifter. De skal vise at Orvelo holder seg oppdatert, ikke selge noe. Ikke nevn Orvelo, KI-sekretær, Petter/Eva, priser eller «book en prat» i innlegget, og ikke legg til salgsbokser. Ikke skriv råd som peker mot eller frarår et bestemt produkt.
- Hva det betyr for Orvelo hører bare hjemme i briefingen til Preben, aldri på nettsiden.
- Fyll ut JSON-LD (NewsArticle), canonical, og og:-taggene med riktig URL og dato.

## To e-poster hver mandag
Begge sendes til Prebens egen e-postadresse, som står i den planlagte oppgaven (fra samme konto via Gmail-koblingen). Ingen andre mottakere, aldri. Bruk htmlBody med enkel formatering, kort og på norsk.

**E-post 1: «Bedriftsbriefing uke NN: <det viktigste i fem ord>»** (for Preben som bedriftseier, maks ca. 250 ord)
1. Det som kan påvirke Orvelo denne uken: konkurrenter innen KI-telefon/sekretær, prisendringer hos OpenAI/Grok/Gemini/Telnyx/Twilio, nye regler (KI-forordningen, markedsføringsloven, personvern), nye muligheter
2. Ett konkret forslag til hva Preben bør gjøre denne uken
Dette innholdet havner aldri på nettsiden.

**E-post 2: «Nettsiden uke NN: nytt innlegg klart til godkjenning»**
1. Tittelen på innlegget og 3 til 6 punkter om hva det handler om
2. Lenke til PR-en med teksten «Godkjenn innlegget: trykk Merge her»
3. Lenke til hvordan det vil se ut etter merge (https://orvelo.no/nyheter/ÅÅÅÅ-uke-NN/)

## Aldri
- Aldri merge PR-en selv eller pushe til main.
- Aldri lagre eller skrive ut passord, nøkler eller tokens.
- Aldri sende e-post til andre enn Preben selv.
