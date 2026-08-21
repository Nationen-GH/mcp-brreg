/**
 * Contract tests against the live Brreg API.
 *
 * Skipped unless BRREG_RUN_INTEGRATION=1, so the default `bun test` run stays
 * hermetic and offline. CI runs these on a schedule to catch upstream changes —
 * the register migrated from SN2007 to SN2025 industry codes, which silently
 * broke every hard-coded code in this repository's docs.
 */
import { describe, expect, test } from 'bun:test';
import { BrregAPIClient } from '../src/client.js';
import { NACEUtils } from '../src/nace-utils.js';

const enabled = process.env.BRREG_RUN_INTEGRATION === '1';
const suite = enabled ? describe : describe.skip;

const client = new BrregAPIClient({ cacheTtlMs: 0 });

interface Paged {
  page: { number: number; totalPages: number; totalElements: number; size: number };
}

suite('live Brreg API', () => {
  test('pages are zero-based', async () => {
    const first = await client.get<Paged>('/enhetsregisteret/api/enheter', {
      navn: 'Equinor',
      size: 3,
    });
    expect(first.page.number).toBe(0);

    const second = await client.get<Paged>('/enhetsregisteret/api/enheter', {
      navn: 'Equinor',
      size: 3,
      page: 1,
    });
    expect(second.page.number).toBe(1);
  });

  test('naeringskode is matched hierarchically by the API', async () => {
    const division = await client.get<Paged>('/enhetsregisteret/api/enheter', {
      naeringskode: '01.1',
      size: 1,
    });
    const klasse = await client.get<Paged>('/enhetsregisteret/api/enheter', {
      naeringskode: '01.11',
      size: 1,
    });

    expect(division.page.totalElements).toBeGreaterThan(0);
    // The broader code must be a superset; if this fails, drop the passthrough
    // in server.ts and expand client-side again.
    expect(division.page.totalElements).toBeGreaterThanOrEqual(klasse.page.totalElements);
  });

  test('section letters are accepted as industry codes', async () => {
    const section = await client.get<Paged>('/enhetsregisteret/api/enheter', {
      naeringskode: 'A',
      size: 1,
    });
    expect(section.page.totalElements).toBeGreaterThan(0);
  });

  test('the bundled classification matches the codes the register uses', async () => {
    const response = await client.get<{ naeringskode1?: { kode: string } }>(
      '/enhetsregisteret/api/enheter/923609016'
    );
    const code = response.naeringskode1?.kode;
    expect(code).toBeDefined();
    // A code the register returns must exist in the classification we ship,
    // otherwise search_nace_codes and search_companies disagree.
    expect(NACEUtils.getNACEByCode(code!)).not.toBeNull();
  });

  test('a 400 carries an actionable valideringsfeil message', async () => {
    const error = await client
      .get('/enhetsregisteret/api/enheter', { naeringskode: '4' })
      .catch((e) => e as Error);
    expect(error.message).toContain('ugyldig');
  });

  test('an unknown organisation number is a 404', async () => {
    const error = await client
      .get('/enhetsregisteret/api/enheter/000000000')
      .catch((e) => e as { status?: number });
    expect(error.status).toBe(404);
  });
});
