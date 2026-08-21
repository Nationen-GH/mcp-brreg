# Brønnøysundregistrene MCP Server

En [Model Context Protocol](https://modelcontextprotocol.io)-server som gir
språkmodeller tilgang til
[Enhetsregisteret](https://data.brreg.no/enhetsregisteret/api/docs/index.html)
— norske foretak, underenheter, roller, næringskoder og kommuner.

Støtter **stdio** lokalt og **Streamable HTTP** for remote.

---

## Kom i gang

### Lokalt (stdio)

```bash
bun install
bun run start
```

eller `./build-and-run.sh`, som også sjekker at Bun finnes.

### Remote (HTTP)

```bash
AUTH_TOKEN=$(openssl rand -hex 32) docker compose up -d
```

`docker compose` nekter å starte uten `AUTH_TOKEN` — porten er dessuten bundet
til `127.0.0.1` som standard. Sett den til `0.0.0.0` bare når serveren står bak
TLS-terminering.

Uten Compose:

```bash
docker build -t mcp-server-brreg .
docker run -d -p 127.0.0.1:3000:3000 \
  -e TRANSPORT=http \
  -e AUTH_TOKEN="$(openssl rand -hex 32)" \
  --name mcp-server-brreg mcp-server-brreg
```

| Endepunkt | Beskrivelse |
| --- | --- |
| `POST/GET /mcp` | Streamable HTTP |
| `GET /health` | Helsesjekk, brukes av Docker |
| `GET /` | Metadata om serveren |

Den gamle HTTP+SSE-transporten (`GET /sse` + `POST /messages`, MCP 2024-11-05)
er fjernet. `TRANSPORT=sse` godtas fortsatt som alias for `http`, slik at et
eksisterende oppsett fortsetter å servere `/mcp` i stedet for å falle stille
tilbake til stdio — men det logger en advarsel. Pek klienter mot `/mcp`.

---

## Klientoppsett

Se `mcp-config.json` for ferdige blokker — én per transport. Serveren heter
`brreg` i alle sammen, slik at verktøynavnene modellen ser
(`mcp__brreg__search_companies` og de andre) er de samme uansett om du kjører
via npx, Bun, Docker eller remote. Bytter du transport, trenger du bare å bytte
innmaten:

```jsonc
{
  "mcpServers": {
    "brreg": {
      // Lokalt, uten å installere noe
      "command": "npx",
      "args": ["-y", "mcp-server-brreg"],
      "env": { "TRANSPORT": "stdio" }

      // ... eller remote, med bearer-token:
      // "type": "http",
      // "url": "https://mcp.example.no/mcp",
      // "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

---

## Miljøvariabler

| Variabel | Standard | Beskrivelse |
| --- | --- | --- |
| `TRANSPORT` | `stdio`, eller `http` hvis `PORT` er satt | `stdio` eller `http`. `sse` godtas fortsatt som utfaset alias for `http`. |
| `PORT` | `3000` | Port for HTTP-transporten |
| `HOST` | `0.0.0.0` | Bind-adresse |
| `AUTH_TOKEN` / `BEARER_TOKEN` | *ingen* | Krever `Authorization: Bearer <token>`. **Sett den alltid** når serveren er nåbar utenfra. |
| `ALLOWED_ORIGINS` | `*` | Kommaseparert CORS-allowlist for nettleserklienter |
| `BRREG_BASE_URL` | `https://data.brreg.no` | Overstyr API-roten |
| `BRREG_TIMEOUT_MS` | `30000` | Timeout per forespørsel |
| `BRREG_MAX_RETRIES` | `3` | Antall forsøk etter det første, ved 429 og 5xx |
| `BRREG_CACHE_TTL_MS` | `300000` | Cache-levetid for oppslagsdata. `0` slår av cachen. |
| `BRREG_NACE_DATA` | *bundlet fil* | Sti til en egen SN-klassifikasjon |

Se `.env.example`.

---

## Verktøy

### Foretak og underenheter

| Verktøy | Beskrivelse |
| --- | --- |
| `search_companies` | Søk i hovedenheter: navn, orgnr, ansatte, konkurs, avvikling, MVA, organisasjonsform, kommune, næringskode, siste årsregnskap |
| `get_company` | Full oppføring for ett foretak |
| `search_subunits` | Søk i underenheter (f.eks. alle avdelinger til ett foretak) |
| `get_subunit` | Full oppføring for én underenhet |

### Roller

| Verktøy | Beskrivelse |
| --- | --- |
| `get_company_roles` | Styre, daglig leder, revisor, signatur og prokura |
| `get_role_types`, `get_role_group_types`, `get_role_representatives` | Gyldige rolletyper |

### Næringskoder (SN2025/NACE)

| Verktøy | Beskrivelse |
| --- | --- |
| `search_nace_codes` | Slå opp koder offline — fritekst, eksakt kode, barn av en kode, eller alle på ett nivå |
| `get_nace_classification_info` | Hvilken klassifikasjonsversjon serveren bruker |

### Oppslagsdata og sporing

| Verktøy | Beskrivelse |
| --- | --- |
| `get_organization_forms` og varianter, `get_organization_form` | Organisasjonsformer (AS, ENK, ASA …) |
| `get_municipalities`, `get_municipality` | Kommuner og kommunenummer |
| `get_services` | Endepunktene i Enhetsregisteret-API-et |
| `get_company_updates`, `get_subunit_updates` | Endringsfeed, med markør for å hente videre |

### Hierarkiske næringskoder

Enhetsregisteret utvider næringskoder selv. `41` treffer `41.000`, `01.1`
treffer `01.11` og `01.110`, og seksjonsbokstaver som `F` treffer hele
seksjonen. **Send den bredeste koden du mener** — det er ikke nødvendig å ramse
opp underkoder.

Registeret klassifiserer nå etter **SN2025**, ikke SN2007. Gamle koder som
`41.109` gir null treff. Bruk `search_nace_codes` for å finne riktig kode.

### Paginering

Sidetall er **nullbasert**. Første side er `page: 0`. Alle svar med flere sider
får et `_hint`-felt som sier hvilken side du er på og hva neste er.

### Kompakte svar

Brreg svarer med HAL-dokumenter der hvert nøstede objekt har en `_links`-blokk.
Serveren fjerner den, løfter `_embedded` opp, og minifiserer JSON-en. Det er
39 % mindre på et foretakssøk, 69 % på roller og 84 % på kommunelisten. Sett
`compact: false` på et kall for å få råsvaret med lenker.

---

## Utvikling

```bash
bun run dev             # watch, stdio
bun test                # hermetisk, ingen nettverk
bun run test:integration  # mot det ekte API-et
bun run typecheck
bun run format
./build-and-run.sh check  # alt over, pluss build og røyktest under Node
```

`test/integration.test.ts` sjekker antakelsene serveren hviler på — nullbasert
paginering, hierarkisk `naeringskode`, at registeret bruker SN2025, og at
400-svar inneholder `valideringsfeil`. En ukentlig GitHub Actions-jobb kjører
dem og åpner en issue hvis noe har endret seg oppstrøms.

Se [.claude/CLAUDE.md](.claude/CLAUDE.md) for arkitektur og konvensjoner.

---

## Datakilder

* [Enhetsregisteret Åpne Data](https://data.brreg.no/enhetsregisteret/api/docs/index.html) — Brønnøysundregistrene, [NLOD](https://data.norge.no/nlod/no/2.0)
* [SN2025](https://www.ssb.no/klass/klassifikasjoner/6) — SSB Klass, bundlet som `data/nace-codes-full.json`

Serveren gjør bare oppslag i åpne data og trenger ingen API-nøkkel mot Brreg.

## Lisens

MIT — se [LICENSE](LICENSE).
