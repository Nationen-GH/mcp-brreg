# Sikkerhet

## Rapportere en sårbarhet

Bruk **[Report a vulnerability](https://github.com/Nationen-GH/mcp-brreg/security/advisories/new)**
under Security-fanen. Da havner rapporten i en privat rådgivning, ikke i en
offentlig issue.

Ikke åpne en vanlig issue for sårbarheter.

Forvent en bekreftelse innen en uke. Er hullet reelt, får du beskjed når en fiks
er ute.

## Hva som er relevant

Serveren gjør bare oppslag i åpne data fra Brønnøysundregistrene. Den har ingen
API-nøkkel, ingen database og lagrer ingenting utover en cache i minnet. Den
interessante angrepsflaten er derfor **HTTP-transporten**, ikke dataene:

| Område | Hva som er verdt å se på |
| --- | --- |
| `AUTH_TOKEN` | Tokensammenligningen i `tokensMatch` er konstant-tid med vilje. Timing-lekkasjer er i scope. |
| CORS | `ALLOWED_ORIGINS` styrer hvem som når serveren fra nettleser. `*` kombinert med et token er en reell feilkonfigurasjon. |
| Sesjoner | Streamable HTTP deler ut sesjons-ID-er. Sesjonsgjetting eller kryssing mellom sesjoner er i scope. |
| Ressursbruk | Kall som får serveren til å bruke ubegrenset minne eller åpne ubegrensede oppstrømsforbindelser. |
| Injeksjon | Parametre som slipper gjennom valideringen og videre inn i URL-en mot `data.brreg.no`. |

Ikke i scope: innholdet i Enhetsregisteret (det er offentlige, åpne data), og
rate limits hos Brreg.

## Kjør den trygt

* **Sett alltid `AUTH_TOKEN`** når serveren er nåbar utenfra. Uten den slipper
  hvem som helst som når porten til å bruke serveren — den logger en advarsel
  ved oppstart, men starter likevel.
* Bind til `127.0.0.1` og sett TLS-terminering foran. `docker-compose.yml` gjør
  dette som standard.
* Sett `ALLOWED_ORIGINS` til de faktiske originene dine, ikke `*`, når
  nettleserklienter er involvert.
* Token i query-streng (`?token=`) godtas for klienter som ikke kan sette
  headere, men havner i access-logger og proxy-historikk. Bruk
  `Authorization: Bearer` når du kan.

## Versjoner

Bare siste utgivelse får sikkerhetsfikser.
