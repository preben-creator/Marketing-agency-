# Sikkerhet og deploy

## Hva koden gjør nå

**Demolenker**
- Hvert firma har sin egen kode (`?kunde=<id>&k=<kode>`). Koden virker bare for det firmaet, aldri for andre kunder.
- Koden utløper 30 dager etter at lenken sist ble laget (`DEMO_DAGER`). Lag lenken på nytt på `/lag` (eller «Rette-lenke») for å forlenge.
  Salgsmotoren fornyer lenken når den lager en demo.
- Den gamle felles `DEMO_KODE` virker bare for den innebygde Deja Vu-demoen (uten `?kunde=`) og firmaene i `DEMO_KODE_KUNDER`
  (standard Deja Vu og Ramsvik, som har fått lenker med den), og bare til `DEMO_KODE_UTLOPER` (standard 2026-12-31).
- Kvoter per døgn, lagret i KV (virker på tvers av Cloudflare-instanser): 10 stemmesamtaler per demo (`DEMO_TALE_DAG`),
  60 for alle demoer til sammen (`DEMO_TALE_ALLE`), 80 chatmeldinger per demo i prøvemodus (`DEMO_CHAT_DAG`).

**Sidene og chat.js**
- Workerne henter sidene fra repoet, men alltid fra en bestemt commit (`GH_REF`), aldri fra `main`.
  Deploy-jobben setter `GH_REF` til commiten som deployes. Uten `GH_REF` brukes en fast commit i koden (`KILDE_REF_STANDARD`).
- En endring i `main` (eller en dårlig PR som blir flettet) når derfor ikke kundenes nettsider før Preben har godkjent en deploy.

**Deploy og overvåking**
- `.github/workflows/worker.yml`: testene kjører på hver PR. Etter fletting til `main` venter deployen på godkjenning
  i miljøet `produksjon`, og deployer så alle tre workerne med wrangler. Hemmeligheter og tekstvariabler i Cloudflare røres ikke (`keep_vars`).
- `.github/workflows/overvak.yml`: hvert 30. minutt sjekkes orvelo.no, GitHub Pages-adressen, `/helse` på workeren og `chat.js`.
  Feiler noe, får Preben e-post fra GitHub.

## Det Preben må slå på selv

### I GitHub (repoet → Settings)

1. **Rules → Rulesets → New branch ruleset**, navn `main`, Enforcement *Active*, Target *Default branch*. Kryss av:
   - *Restrict deletions* og *Block force pushes*
   - *Require a pull request before merging* (Required approvals: 0 holder, du er alene. Det viktige er at alt går via PR)
   - *Require status checks to pass* → legg til `test`
2. **Environments → New environment** `produksjon` → *Required reviewers*: deg selv. Kryss av *Prevent self-review* **ikke**
   (du er den eneste). *Deployment branches*: *Selected branches* → `main`.
   I samme miljø, **Environment secrets**:
   - `CLOUDFLARE_API_TOKEN`: lag på dash.cloudflare.com → My Profile → API Tokens → *Create Token* → malen
     **Edit Cloudflare Workers**, bare din konto. (Tokenet kan bare deploye workers, ikke se DNS eller betaling.)
   - `CLOUDFLARE_ACCOUNT_ID`: `702b473e150b3be788fdaf45c4d1de31`
3. **Code security**: slå på *Secret scanning* og *Push protection* (gratis for offentlige repoer), og *Dependabot alerts*.
4. **Collaborators** og **Deploy keys**: sjekk at ingen andre enn deg har skrivetilgang.
5. Din konto (github.com/settings/security): **tofaktor** på, og under *Applications* fjern apper og tokens du ikke bruker.

### I Cloudflare (orvelo-sekretar → Settings → Variables and Secrets)

- Bytt `DEMO_KODE` til en ny, lang tilfeldig kode **etter** at Deja Vu og Ramsvik har fått nye lenker (eller når du ikke
  trenger de gamle lenkene lenger). Da slutter alle gamle felles-lenker å virke med en gang.
- Valgfritt: `DEMO_KODE_KUNDER` (tom = felles kode gjelder ingen firmaer), `DEMO_KODE_UTLOPER`, `DEMO_DAGER`, kvotene over.
- I xAI-konsollen: slå av automatisk påfylling og sett et månedstak. Det er den siste bremsen på stemmekostnaden.

### Fram til GitHub Actions-deployen er satt opp

Workeren deployes som før (lim inn koden). Da står `GH_REF` tomt, og sidene hentes fra den faste commiten i koden.
Vil du vise nyere sider uten Actions, sett `GH_REF` (Text) til hele commit-id-en fra `main` i Cloudflare.

## Kjente svakheter som gjenstår

- Taletiden (10 min, legg på ved stillhet) styres fortsatt i nettleseren. Kvoten begrenser antall samtaler, ikke lengden.
- Repoet er offentlig. Å gjøre det privat krever GitHub Pro for Pages, og at workerne henter sidene med et token.
- Grensene per IP (`tooMany`, chat, kontakt) ligger i minnet per instans. Kvotene over ligger i KV og er de som teller.
