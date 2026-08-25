/**
 * Human-facing source links.
 *
 * The API serves JSON from data.brreg.no, but the page a person can open to
 * verify the same record lives on virksomhet.brreg.no. Compact responses get a
 * `webUrl` on every unit (and a `_source` on derived data sets) so a model can
 * cite where the information came from. Raw responses (`compact: false`) are
 * left untouched — they are documented as the unmodified API document.
 */

/** Public lookup portal for the Norwegian Business Registry. */
const PORTAL = 'https://virksomhet.brreg.no/nb/oppslag';

/** SSB Klass page for the SN2025 classification bundled with this server. */
export const NACE_SOURCE_URL = 'https://www.ssb.no/klass/klassifikasjoner/6';

export function companyPageUrl(orgNumber: string): string {
  return `${PORTAL}/enheter/${orgNumber}`;
}

export function subunitPageUrl(orgNumber: string): string {
  return `${PORTAL}/underenheter/${orgNumber}`;
}

export type UnitKind = 'enhet' | 'underenhet';

/** Collection keys (after `_embedded` flattening) that hold units of each kind. */
const UNIT_ARRAY_KEYS: Record<UnitKind, readonly string[]> = {
  enhet: ['enheter', 'oppdaterteEnheter'],
  underenhet: ['underenheter', 'oppdaterteUnderenheter'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function withWebUrl(unit: unknown, toUrl: (orgNumber: string) => string): unknown {
  if (!isRecord(unit) || typeof unit.organisasjonsnummer !== 'string') return unit;
  return { ...unit, webUrl: toUrl(unit.organisasjonsnummer) };
}

/**
 * Add a `webUrl` to every unit in a flattened payload.
 *
 * Handles the three shapes the Enhetsregisteret tools produce: a single unit
 * (`get_company`/`get_subunit`), a search page (`enheter`/`underenheter`
 * arrays) and the change feed (`oppdaterteEnheter`/`oppdaterteUnderenheter`),
 * keying on the `organisasjonsnummer` each entry carries.
 */
export function addSourceLinks(payload: unknown, kind: UnitKind): unknown {
  if (!isRecord(payload)) return payload;

  const toUrl = kind === 'enhet' ? companyPageUrl : subunitPageUrl;

  if (typeof payload.organisasjonsnummer === 'string') {
    return withWebUrl(payload, toUrl);
  }

  for (const key of UNIT_ARRAY_KEYS[kind]) {
    const items = payload[key];
    if (!Array.isArray(items)) continue;
    return { ...payload, [key]: items.map((item) => withWebUrl(item, toUrl)) };
  }

  return payload;
}
