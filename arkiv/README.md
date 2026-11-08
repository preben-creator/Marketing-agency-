# Arkiv: det vi tok bort fra nettsiden 8. november 2026

Uken 9.–15. november 2026 viser nettsiden bare ett tilbud: KI-sekretæren til
7 990 kr i oppstart (første måned inkludert) + 1 490 kr/mnd eks. mva,
12 måneders binding med automatisk fornyelse. Vi lover bare det som virker i dag.

Det som ble tatt bort, skal bygges videre fra helgen 14.–15. november.

## Hvor det gamle ligger

- `arkiv/nettside-full-2026-11-08.html`: hele forsiden slik den var før endringen,
  med pakkene Start, Pro og Komplett og alle tjenestene. Siden har `noindex`, så
  søkemotorer viser den ikke. Åpne den på `/arkiv/nettside-full-2026-11-08.html`.
- Git: commit `6eedf14` på `main` har alt slik det var (også faktateksten i
  `snakk/index.html` og pakkene i e-posten fra `snakk/lag.html`).

## Pakkene som var på siden

- **Start**: 1 490 kr/mnd, oppstart 7 990 kr. Chat på nettsiden, råd ved akutte
  skader, ferdig arbeidsordre på e-post eller SMS.
- **Pro**: 2 990 kr/mnd, oppstart 19 900 kr. Alt i Start, pluss booking rett i
  kalenderen (Google eller Outlook), bilde av jobben, SMS-bekreftelse og
  påminnelse, flere språk, månedsrapport.
- **Komplett**: 5 990 kr/mnd, oppstart 39 900 kr. Alt i Pro, pluss
  KI-telefonsvarer, tilbudsutkast, bilag fra bilde, fakturautkast (Tripletex,
  Fiken, PowerOffice), ferdigmelding med bilder, Google-anmeldelse og purring,
  oversikt for daglig leder.

## Det som må bygges før det kan lovas igjen

1. Svar på kundens eget telefonnummer (Twilio, venter på godkjenning i Trust Hub).
2. SMS-bekreftelse og påminnelse til sluttkunden.
3. Ferdig arbeidsordre/beskjed til firmaet på SMS eller e-post (i dag lagres ikke
   bestillinger og beskjeder fra sekretæren noe sted).
4. Booking rett i firmaets egen kalender (Google eller Outlook).
5. Bilde av jobben, flere språk, månedsrapport.
6. Tilbuds- og fakturautkast, bilag fra bilde, ferdigmelding, anmeldelser og purring.

Når noe er ferdig: legg det tilbake på forsiden, i `produkt()` i
`snakk/index.html`, i `PAKKER` i `snakk/lag.html` og i tjenestelisten i
`avtale/ny.html` og `tools/lag-avtale-pdf.mjs`.
