# Brønnøysundregistrene MCP Server

En [MCP](https://modelcontextprotocol.io)-server som gir
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
docker build -t mcp-brreg .
docker run -d -p 127.0.0.1:3000:3000 \
  -e TRANSPORT=http \
  -e AUTH_TOKEN="$(openssl rand -hex 32)" \
  --name mcp-brreg mcp-brreg
```

| Endepunkt | Beskrivelse |
| --- | --- |
| `POST/GET /mcp` | Streamable HTTP |
| `GET /health` | Helsesjekk, brukes av Docker |
| `GET /` | Metadata om serveren |

---

## Klientoppsett

Se `mcp-config.json` for ferdige blokker.

```jsonc
{
  "mcpServers": {
    "brreg": {
      "command": "bun",
      "args": ["run", "src/index.ts"],
      "cwd": "/absolute/path/to/mcp-brreg",
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
| `TRANSPORT` | `stdio`, eller `http` hvis `PORT` er satt | `stdio` eller `http`. |
| `PORT` | `3000` | |
| `HOST` | `0.0.0.0` | |
| `AUTH_TOKEN` / `BEARER_TOKEN` | *ingen* | Krever `Authorization: Bearer <token>`. |
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

### Kildelenker

Alle svar peker tilbake til siden informasjonen kommer fra, slik at modellen
kan oppgi kilde:

* Hvert foretak og hver underenhet får `webUrl` — den offentlige oppslagssiden
  på [virksomhet.brreg.no](https://virksomhet.brreg.no), også i søketreff og
  endringsfeeden.
* `get_company_roles` får `_source` — foretakssiden der rollene står.
* NACE-oppslagene får `_source` — SN2025-klassifikasjonen hos SSB.

Lenkene legges bare på kompakte svar; `compact: false` gir API-dokumentet
uendret.

### Paginering

Sidetall er **nullbasert**. Første side er `page: 0`. Alle svar med flere sider
får et `_hint`-felt som sier hvilken side du er på og hva neste er.

### Kompakte svar

Brreg svarer med HAL-dokumenter der hvert nøstede objekt har en `_links`-blokk
med API-URL-er. Serveren fjerner den, løfter `_embedded` opp, og minifiserer
JSON-en. Det er 39 % mindre på et foretakssøk, 69 % på roller og 84 % på
kommunelisten. Sett `compact: false` på et kall for å få råsvaret.

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

---

## Datakilder

* [Enhetsregisteret Åpne Data](https://data.brreg.no/enhetsregisteret/api/docs/index.html) — Brønnøysundregistrene, [NLOD](https://data.norge.no/nlod/no/2.0)
* [SN2025](https://www.ssb.no/klass/klassifikasjoner/6) — SSB Klass, bundlet som `data/nace-codes-full.json`

Serveren gjør bare oppslag i åpne data og trenger ingen API-nøkkel mot Brreg.

## Lisens

MIT — se [LICENSE](LICENSE).
