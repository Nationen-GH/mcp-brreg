import { describe, expect, test } from 'bun:test';
import { addSourceLinks, companyPageUrl, subunitPageUrl } from '../src/links.js';

describe('page URLs', () => {
  test('point at the public lookup portal', () => {
    expect(companyPageUrl('923609016')).toBe(
      'https://virksomhet.brreg.no/nb/oppslag/enheter/923609016'
    );
    expect(subunitPageUrl('973152351')).toBe(
      'https://virksomhet.brreg.no/nb/oppslag/underenheter/973152351'
    );
  });
});

describe('addSourceLinks', () => {
  test('adds webUrl to a single unit', () => {
    const out = addSourceLinks({ organisasjonsnummer: '923609016', navn: 'EQUINOR ASA' }, 'enhet');
    expect(out).toEqual({
      organisasjonsnummer: '923609016',
      navn: 'EQUINOR ASA',
      webUrl: companyPageUrl('923609016'),
    });
  });

  test('adds webUrl to every hit in a flattened search page', () => {
    const out = addSourceLinks(
      {
        enheter: [{ organisasjonsnummer: '923609016' }, { organisasjonsnummer: '914594685' }],
        page: { number: 0 },
      },
      'enhet'
    ) as { enheter: Array<{ webUrl?: string }>; page: unknown };

    expect(out.enheter.map((e) => e.webUrl)).toEqual([
      companyPageUrl('923609016'),
      companyPageUrl('914594685'),
    ]);
    expect(out.page).toEqual({ number: 0 });
  });

  test('uses the subunit portal path for underenheter', () => {
    const out = addSourceLinks(
      { underenheter: [{ organisasjonsnummer: '973152351' }] },
      'underenhet'
    ) as { underenheter: Array<{ webUrl?: string }> };

    expect(out.underenheter[0]!.webUrl).toBe(subunitPageUrl('973152351'));
  });

  test('links change-feed entries by their organisation number', () => {
    const out = addSourceLinks(
      { oppdaterteEnheter: [{ oppdateringsid: 1, organisasjonsnummer: '923609016' }] },
      'enhet'
    ) as { oppdaterteEnheter: Array<{ webUrl?: string }> };

    expect(out.oppdaterteEnheter[0]!.webUrl).toBe(companyPageUrl('923609016'));
  });

  test('leaves entries without an organisation number, and non-objects, alone', () => {
    expect(addSourceLinks({ enheter: [{ navn: 'no orgnr' }] }, 'enhet')).toEqual({
      enheter: [{ navn: 'no orgnr' }],
    });
    expect(addSourceLinks(null, 'enhet')).toBeNull();
    expect(addSourceLinks([1, 2], 'enhet')).toEqual([1, 2]);
    expect(addSourceLinks({ page: { number: 0 } }, 'enhet')).toEqual({ page: { number: 0 } });
  });
});
