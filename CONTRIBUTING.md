# Bidra

## Kom i gang

```bash
bun install
bun run dev              # watch, stdio
```

Kjør hele pipelinen før du åpner en PR:

```bash
./build-and-run.sh check   # typecheck, format, test, build, røyktest under Node
```

Det er det samme CI kjører. Går den grønt lokalt, går den grønt der.

## Verktøykjeden er pinnet

`bun-version` i workflow-filene og `oven/bun:<versjon>-alpine` i `Dockerfile`
peker på en **eksakt** bun-versjon, ikke `latest`. Grunnen er `bun install
--frozen-lockfile`: en ny bun-utgivelse som skriver om `bun.lock` velter CI uten
at noen har endret en linje kode.

Skal du oppgradere bun, gjør begge deler i samme commit:

1. Bump versjonen i `.github/workflows/ci.yml`, `.github/workflows/upstream-contract.yml` og `Dockerfile`.
2. Kjør `bun install` med **samme** versjon lokalt og commit `bun.lock`.

## Konvensjoner

* **Testene skal være offline.** `bun test` stubber `globalThis.fetch` og
  gjenoppretter den i `afterEach`. Alt som trenger nettverk hører hjemme i
  `test/integration.test.ts`, som hopper over seg selv uten
  `BRREG_RUN_INTEGRATION=1`.
* **stdout er JSON-RPC-kanalen på stdio. All logging går til stderr.** En
  `console.log` i serverkoden ødelegger protokollen.
* **Valider identifikatorer før nettverkskallet** — orgnummer, kommunenummer,
  organisasjonsformer — og returner en feilmelding som sier hva riktig format
  er, slik at modellen kan rette seg selv.
* **Aldri legg til en query-parameter du ikke har bekreftet mot det ekte
  API-et.** `/check-upstream` finnes for å teste antakelser.
* Verktøynavn og -beskrivelser er engelske. Brregs norske feltnavn hører bare
  hjemme i wire-mappingen i `src/server.ts`.
* Svar er kompakte som standard — `_links` fjernet, `_embedded` løftet, JSON
  minifisert. `compact: false` gir rådokumentet.
* Formatering er Prettier, 100 kolonner, enkle fnutter. `bun run format`.

## Legge til et verktøy

1. Skjema i `src/tools.ts` — **bare** skjema, ingen logikk.
2. Dispatch og parametermapping i `src/server.ts`.
3. Test i `test/server.test.ts`. Testene der driver en ekte MCP-`Client` over
   `InMemoryTransport`, så skjemafeil dukker opp som feilende tester.
4. Dokumenter verktøyet i README-tabellen.

## Oppstrømsantakelser

Fire antakelser bærer denne serveren, og ingen av dem er åpenbare fra koden:
nullbasert paginering, hierarkisk `naeringskode`-utvidelse, at registeret bruker
SN2025, og at 400-svar inneholder `valideringsfeil`. De er dokumentert i
[.claude/CLAUDE.md](.claude/CLAUDE.md) og voktes av
`test/integration.test.ts`, som en ukentlig workflow kjører mot det ekte API-et.

Endrer du noe som rører ved dem, oppdater både testen og notatet.

## Pull requests

Hold dem små og forklar *hvorfor*, ikke bare hva. Sjekklisten i
PR-malen er den samme som `./build-and-run.sh check`.
