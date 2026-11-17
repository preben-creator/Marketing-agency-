# Ukentlig KI-nyhetsagent (instruks)

Denne filen er oppskriften den planlagte oppgaven følger hver mandag. Endre den her, så gjelder det fra neste uke.

## Mål
1. Et innlegg på orvelo.no/nyheter/ med ukens viktigste KI-nyheter for norske småbedrifter (håndverkere, frisører, servicebedrifter). Skrevet på norsk bokmål, nyttig og bra for SEO.
2. En kort briefing på e-post til Preben om hva som skjer, og hva det betyr for Orvelo.
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
8. Send briefingen på e-post (se under).

## Skrivestil for innlegget
- Norsk bokmål, korte setninger, du-form. Ingen tankestreker som pynt, ingen engelske moteord når det finnes et norsk ord (skriv «KI», ikke «AI»).
- Tittel (h1) og `<title>` skal nevne de to viktigste sakene konkret. `<title>` slutter med « – Orvelo». `meta description` 140 til 160 tegn.
- «Hva betyr det for deg?» skal alltid gi ett konkret råd en håndverker eller frisør kan gjøre denne uken.
- Innleggene er nøytral, nyttig informasjon for bedrifter. De skal vise at Orvelo holder seg oppdatert, ikke selge noe. Ikke nevn Orvelo, KI-sekretær, Petter/Eva, priser eller «book en prat» i innlegget, og ikke legg til salgsbokser. Ikke skriv råd som peker mot eller frarår et bestemt produkt.
- Hva det betyr for Orvelo hører bare hjemme i briefingen til Preben, aldri på nettsiden.
- Fyll ut JSON-LD (NewsArticle), canonical, og og:-taggene med riktig URL og dato.

## Briefing på e-post
- Til: Prebens egen e-postadresse, som står i den planlagte oppgaven (sendes fra samme konto via Gmail-koblingen). Ingen andre mottakere, aldri.
- Emne: «KI-briefing uke NN: <det viktigste i fem ord>»
- Innhold, kort og på norsk (maks ca. 250 ord):
  1. De 3 viktigste tingene som skjedde, én setning hver
  2. Hva det betyr for Orvelo (konkurrenter innen KI-telefon/sekretær, nye muligheter, priser på OpenAI/Grok/Gemini/Telnyx/Twilio, regler som AI Act og markedsføringsloven)
  3. Ett forslag til hva Preben kan gjøre denne uken
  4. Lenke til PR-en med teksten «Godkjenn innlegget: trykk Merge her» og lenke til hvordan det vil se ut (https://orvelo.no/nyheter/ÅÅÅÅ-uke-NN/ etter merge)
- Bruk htmlBody med enkel formatering.

## Aldri
- Aldri merge PR-en selv eller pushe til main.
- Aldri lagre eller skrive ut passord, nøkler eller tokens.
- Aldri sende e-post til andre enn Preben selv.
