import { afterEach, describe, expect, test } from 'bun:test';
import { BrregAPIClient } from '../src/client.js';
import {
  BrregAPIError,
  BrregNotFoundError,
  BrregRateLimitError,
  BrregValidationError,
} from '../src/types.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replace fetch with a scripted sequence of responses and record the URLs. */
function mockFetch(responses: Array<Response | (() => Response)>) {
  const calls: string[] = [];
  let index = 0;

  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    const next = responses[Math.min(index, responses.length - 1)]!;
    index++;
    return typeof next === 'function' ? next() : next.clone();
  }) as typeof fetch;

  return calls;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

describe('buildParams', () => {
  test('joins arrays with commas, as Brreg expects', () => {
    const params = BrregAPIClient.buildParams({ naeringskode: ['41', '42'] });
    expect(params.get('naeringskode')).toBe('41,42');
  });

  test('drops undefined, null, empty strings and empty arrays', () => {
    const params = BrregAPIClient.buildParams({
      a: undefined,
      b: null,
      c: '',
      d: [],
      e: [undefined, 'x', ''],
      f: 0,
      g: false,
    });
    expect(params.has('a')).toBe(false);
    expect(params.has('b')).toBe(false);
    expect(params.has('c')).toBe(false);
    expect(params.has('d')).toBe(false);
    expect(params.get('e')).toBe('x');
    // 0 and false are meaningful filter values, not blanks.
    expect(params.get('f')).toBe('0');
    expect(params.get('g')).toBe('false');
  });
});

describe('validators', () => {
  test('organisation numbers are exactly 9 digits', () => {
    expect(BrregAPIClient.validateOrganizationNumber('923609016')).toBe(true);
    expect(BrregAPIClient.validateOrganizationNumber('92360901')).toBe(false);
    expect(BrregAPIClient.validateOrganizationNumber('9236090161')).toBe(false);
    expect(BrregAPIClient.validateOrganizationNumber('92360901a')).toBe(false);
    expect(BrregAPIClient.validateOrganizationNumber(923609016 as unknown)).toBe(false);
  });

  test('municipality numbers are exactly 4 digits', () => {
    expect(BrregAPIClient.validateMunicipalityNumber('0301')).toBe(true);
    expect(BrregAPIClient.validateMunicipalityNumber('301')).toBe(false);
  });
});

describe('error mapping', () => {
  test('400 becomes a validation error carrying the valideringsfeil detail', async () => {
    mockFetch([
      json(
        {
          feilmelding: 'Feilaktig forespoersel',
          valideringsfeil: [
            {
              feilmelding: 'Naeringskode 4 er ugyldig',
              parametere: ['naeringskode'],
              feilaktigVerdi: '[4]',
            },
          ],
        },
        { status: 400 }
      ),
    ]);

    const client = new BrregAPIClient({ maxRetries: 0 });
    const error = (await client.get('/x').catch((e) => e)) as BrregValidationError;

    expect(error).toBeInstanceOf(BrregValidationError);
    expect(error.status).toBe(400);
    // The actionable part must survive into the message.
    expect(error.message).toContain('Naeringskode 4 er ugyldig');
    expect(error.message).toContain('naeringskode');
  });

  test('404 becomes a not-found error even with an empty body', async () => {
    mockFetch([new Response('null', { status: 404, statusText: 'Not Found' })]);
    const client = new BrregAPIClient({ maxRetries: 0 });
    await expect(client.get('/x')).rejects.toBeInstanceOf(BrregNotFoundError);
  });

  test('5xx carries its status instead of reporting "undefined"', async () => {
    mockFetch([json({ feilmelding: 'oops' }, { status: 503 })]);
    const client = new BrregAPIClient({ maxRetries: 0 });
    const error = (await client.get('/x').catch((e) => e)) as BrregAPIError;

    expect(error).toBeInstanceOf(BrregAPIError);
    expect(error.status).toBe(503);
    expect(error.message).toContain('Server error');
  });

  test('429 exposes Retry-After', async () => {
    mockFetch([new Response('{}', { status: 429, headers: { 'retry-after': '7' } })]);
    const client = new BrregAPIClient({ maxRetries: 0 });
    const error = (await client.get('/x').catch((e) => e)) as BrregRateLimitError;

    expect(error).toBeInstanceOf(BrregRateLimitError);
    expect(error.retryAfterSeconds).toBe(7);
  });

  test('a non-JSON 200 is reported rather than silently returning undefined', async () => {
    mockFetch([new Response('<html>nope</html>', { status: 200 })]);
    const client = new BrregAPIClient({ maxRetries: 0 });
    await expect(client.get('/x')).rejects.toBeInstanceOf(BrregAPIError);
  });
});

describe('retries', () => {
  test('retries a 5xx and returns the eventual success', async () => {
    let attempt = 0;
    mockFetch([
      () => {
        attempt++;
        return attempt < 3 ? json({ feilmelding: 'down' }, { status: 500 }) : json({ ok: true });
      },
    ]);

    const client = new BrregAPIClient({ maxRetries: 3, cacheTtlMs: 0 });
    await expect(client.get('/x')).resolves.toEqual({ ok: true });
    expect(attempt).toBe(3);
  });

  test('does not retry a 400', async () => {
    let attempt = 0;
    mockFetch([
      () => {
        attempt++;
        return json({ feilmelding: 'bad' }, { status: 400 });
      },
    ]);

    const client = new BrregAPIClient({ maxRetries: 3 });
    await expect(client.get('/x')).rejects.toBeInstanceOf(BrregValidationError);
    expect(attempt).toBe(1);
  });

  test('gives up after maxRetries', async () => {
    let attempt = 0;
    mockFetch([
      () => {
        attempt++;
        return json({ feilmelding: 'down' }, { status: 500 });
      },
    ]);

    const client = new BrregAPIClient({ maxRetries: 2 });
    await expect(client.get('/x')).rejects.toBeInstanceOf(BrregAPIError);
    expect(attempt).toBe(3); // the first attempt plus two retries
  });
});

describe('cache', () => {
  test('serves a repeat cacheable request without another fetch', async () => {
    const calls = mockFetch([json({ n: 1 })]);
    const client = new BrregAPIClient({ cacheTtlMs: 60_000 });

    await client.get('/kommuner', { size: 5 }, true);
    await client.get('/kommuner', { size: 5 }, true);
    expect(calls.length).toBe(1);

    // A different query is a different cache key.
    await client.get('/kommuner', { size: 6 }, true);
    expect(calls.length).toBe(2);
  });

  test('does not cache when the caller does not opt in', async () => {
    const calls = mockFetch([json({ n: 1 })]);
    const client = new BrregAPIClient({ cacheTtlMs: 60_000 });

    await client.get('/enheter', { navn: 'x' });
    await client.get('/enheter', { navn: 'x' });
    expect(calls.length).toBe(2);
  });

  test('expires entries once the TTL passes', async () => {
    const calls = mockFetch([json({ n: 1 })]);
    const client = new BrregAPIClient({ cacheTtlMs: 1 });

    await client.get('/kommuner', undefined, true);
    await Bun.sleep(5);
    await client.get('/kommuner', undefined, true);
    expect(calls.length).toBe(2);
  });

  test('clearCache drops stored entries', async () => {
    const calls = mockFetch([json({ n: 1 })]);
    const client = new BrregAPIClient({ cacheTtlMs: 60_000 });

    await client.get('/kommuner', undefined, true);
    client.clearCache();
    await client.get('/kommuner', undefined, true);
    expect(calls.length).toBe(2);
  });
});

describe('url building', () => {
  test('omits the question mark when there are no parameters', async () => {
    const calls = mockFetch([json({})]);
    const client = new BrregAPIClient({ baseURL: 'https://example.test/' });
    await client.get('/enhetsregisteret/api');
    expect(calls[0]).toBe('https://example.test/enhetsregisteret/api');
  });
});
