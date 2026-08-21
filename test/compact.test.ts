import { describe, expect, test } from 'bun:test';
import {
  errorResult,
  flattenEmbedded,
  paginationHint,
  stripHalNoise,
  toolResult,
} from '../src/compact.js';

describe('stripHalNoise', () => {
  test('removes _links at every depth', () => {
    const input = {
      navn: 'EQUINOR ASA',
      _links: { self: { href: 'https://example.test' } },
      organisasjonsform: { kode: 'ASA', _links: { self: { href: 'x' } } },
      adresser: [{ poststed: 'STAVANGER', _links: { self: { href: 'y' } } }],
    };

    expect(stripHalNoise(input)).toEqual({
      navn: 'EQUINOR ASA',
      organisasjonsform: { kode: 'ASA' },
      adresser: [{ poststed: 'STAVANGER' }],
    });
  });

  test('leaves primitives, nulls and arrays of scalars alone', () => {
    expect(stripHalNoise({ a: 1, b: null, c: ['x', 'y'], d: false })).toEqual({
      a: 1,
      b: null,
      c: ['x', 'y'],
      d: false,
    });
  });

  test('does not mistake a field merely containing "links" for HAL noise', () => {
    expect(stripHalNoise({ hjemmesidelinks: 'keep me' })).toEqual({
      hjemmesidelinks: 'keep me',
    });
  });

  test('terminates on a self-referential structure', () => {
    const cyclic: Record<string, unknown> = { navn: 'loop' };
    cyclic.self = cyclic;
    expect(() => stripHalNoise(cyclic)).not.toThrow();
  });
});

describe('flattenEmbedded', () => {
  test('lifts the embedded collection to the top level', () => {
    const input = { _embedded: { enheter: [{ navn: 'A' }] }, page: { number: 0 } };
    expect(flattenEmbedded(input)).toEqual({ enheter: [{ navn: 'A' }], page: { number: 0 } });
  });

  test('passes through payloads without _embedded', () => {
    const single = { organisasjonsnummer: '923609016' };
    expect(flattenEmbedded(single)).toEqual(single);
    expect(flattenEmbedded(null)).toBeNull();
    expect(flattenEmbedded([1, 2])).toEqual([1, 2]);
  });
});

describe('paginationHint', () => {
  test('points at the next zero-based page', () => {
    const hint = paginationHint({
      page: { number: 0, totalPages: 60, size: 3, totalElements: 179 },
    });
    expect(hint?._hint).toContain('page=1');
    expect(hint?._hint).toContain('zero-based');
  });

  test('says so on the last page', () => {
    const hint = paginationHint({
      page: { number: 59, totalPages: 60, size: 3, totalElements: 179 },
    });
    expect(hint?._hint).toContain('last page');
  });

  test('returns undefined without page metadata', () => {
    expect(paginationHint({ navn: 'x' })).toBeUndefined();
    expect(paginationHint(null)).toBeUndefined();
  });
});

describe('toolResult', () => {
  test('compacts by default and is materially smaller', () => {
    const payload = {
      _embedded: { enheter: [{ navn: 'A', _links: { self: { href: 'https://example.test/a' } } }] },
      _links: { self: { href: 'https://example.test' } },
      page: { number: 0, totalPages: 1, size: 1, totalElements: 1 },
    };

    const compact = toolResult(payload).content[0]!.text;
    const raw = toolResult(payload, { compact: false }).content[0]!.text;

    expect(JSON.parse(compact)).toEqual({
      enheter: [{ navn: 'A' }],
      page: { number: 0, totalPages: 1, size: 1, totalElements: 1 },
    });
    expect(compact.length).toBeLessThan(raw.length);
    expect(compact).not.toContain('_links');
    expect(raw).toContain('_links');
  });

  test('merges meta into the emitted object', () => {
    const text = toolResult({ a: 1 }, { meta: { _hint: 'next' } }).content[0]!.text;
    expect(JSON.parse(text)).toEqual({ a: 1, _hint: 'next' });
  });

  test('errorResult flags isError', () => {
    const result = errorResult('boom');
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('boom');
  });
});
