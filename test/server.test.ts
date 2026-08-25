import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { BrregAPIClient } from '../src/client.js';
import { BrregMCPServer, describeToolError } from '../src/server.js';
import { TOOLS } from '../src/tools.js';
import { BrregNotFoundError, BrregRateLimitError, BrregValidationError } from '../src/types.js';

const realFetch = globalThis.fetch;

/** URLs the server asked for during a test. */
let requestedUrls: string[] = [];

function stubBrreg(
  body: unknown = {
    _embedded: { enheter: [] },
    page: { number: 0, totalPages: 1, size: 20, totalElements: 0 },
  }
) {
  requestedUrls = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

async function connectedClient() {
  const server = new BrregMCPServer(new BrregAPIClient({ cacheTtlMs: 0, maxRetries: 0 }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

/** Query parameters of the single upstream call a tool made. */
function lastQuery(): URLSearchParams {
  expect(requestedUrls.length).toBe(1);
  return new URL(requestedUrls[0]!).searchParams;
}

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ text: string }> }).content;
  return content[0]!.text;
}

let ctx: Awaited<ReturnType<typeof connectedClient>>;

beforeEach(async () => {
  stubBrreg();
  ctx = await connectedClient();
});

afterEach(async () => {
  await ctx.client.close();
  await ctx.server.close();
  globalThis.fetch = realFetch;
});

describe('tool catalogue', () => {
  test('lists every tool with a usable schema', async () => {
    const { tools } = await ctx.client.listTools();
    expect(tools.length).toBe(TOOLS.length);

    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.description!.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  test('tool names are unique', () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });

  test('paged tools document pages as zero-based', () => {
    for (const tool of TOOLS) {
      const page = (
        tool.inputSchema.properties as
          Record<string, { default?: unknown; description?: string }> | undefined
      )?.page;
      if (!page) continue;
      expect(page.default).toBe(0);
      expect(page.description).toContain('Zero-based');
    }
  });
});

describe('search_companies', () => {
  test('maps arguments onto Brreg parameter names', async () => {
    await ctx.client.callTool({
      name: 'search_companies',
      arguments: {
        name: 'Equinor',
        bankrupt: false,
        underLiquidation: true,
        registeredInVAT: true,
        organizationForm: ['AS', 'ASA'],
        municipalityNumber: ['0301'],
        lastSubmittedAnnualAccounts: '2023',
        size: 5,
      },
    });

    const query = lastQuery();
    expect(query.get('navn')).toBe('Equinor');
    expect(query.get('konkurs')).toBe('false');
    expect(query.get('underAvvikling')).toBe('true');
    expect(query.get('registrertIMvaregisteret')).toBe('true');
    expect(query.get('organisasjonsform')).toBe('AS,ASA');
    expect(query.get('kommunenummer')).toBe('0301');
    expect(query.get('sisteInnsendteAarsregnskap')).toBe('2023');
    expect(query.get('size')).toBe('5');
  });

  test('passes page through unchanged, including page 0', async () => {
    await ctx.client.callTool({ name: 'search_companies', arguments: { name: 'x', page: 0 } });
    expect(lastQuery().get('page')).toBe('0');
  });

  test('omits page entirely when the caller does not set one', async () => {
    await ctx.client.callTool({ name: 'search_companies', arguments: { name: 'x' } });
    expect(lastQuery().has('page')).toBe(false);
  });

  test('sends industry codes verbatim, because the API expands them itself', async () => {
    await ctx.client.callTool({
      name: 'search_companies',
      arguments: { industryCode: ['41'] },
    });
    expect(lastQuery().get('naeringskode')).toBe('41');
  });

  test('expands industry codes only when explicitly asked to', async () => {
    await ctx.client.callTool({
      name: 'search_companies',
      arguments: { industryCode: ['01.1'], expandIndustryCodes: true },
    });

    const codes = lastQuery().get('naeringskode')!.split(',');
    expect(codes[0]).toBe('01.1');
    expect(codes.length).toBeGreaterThan(1);
    expect(codes).toContain('01.11');
  });

  test('rejects a malformed organisation number before calling the API', async () => {
    const result = await ctx.client.callTool({
      name: 'search_companies',
      arguments: { organizationNumber: ['12345'] },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Validation error');
    expect(requestedUrls.length).toBe(0);
  });

  test('rejects a malformed municipality number before calling the API', async () => {
    const result = await ctx.client.callTool({
      name: 'search_companies',
      arguments: { municipalityNumber: ['301'] },
    });

    expect(result.isError).toBe(true);
    expect(requestedUrls.length).toBe(0);
  });

  test('adds a zero-based pagination hint to the payload', async () => {
    stubBrreg({
      _embedded: { enheter: [{ navn: 'A', _links: { self: { href: 'x' } } }] },
      page: { number: 0, totalPages: 9, size: 1, totalElements: 9 },
    });

    const result = await ctx.client.callTool({
      name: 'search_companies',
      arguments: { name: 'A' },
    });
    const payload = JSON.parse(textOf(result));

    expect(payload.enheter).toEqual([{ navn: 'A' }]); // flattened and de-noised
    expect(payload._hint).toContain('page=1');
  });

  test('compact:false keeps the raw HAL document', async () => {
    stubBrreg({
      _embedded: { enheter: [{ navn: 'A', _links: { self: { href: 'x' } } }] },
      page: { number: 0, totalPages: 1, size: 1, totalElements: 1 },
    });

    const result = await ctx.client.callTool({
      name: 'search_companies',
      arguments: { name: 'A', compact: false },
    });

    expect(textOf(result)).toContain('_links');
    expect(textOf(result)).toContain('_embedded');
    expect(textOf(result)).not.toContain('webUrl');
  });
});

describe('source links', () => {
  test('search hits carry the public brreg page of each company', async () => {
    stubBrreg({
      _embedded: { enheter: [{ organisasjonsnummer: '923609016', navn: 'EQUINOR ASA' }] },
      page: { number: 0, totalPages: 1, size: 1, totalElements: 1 },
    });

    const result = await ctx.client.callTool({
      name: 'search_companies',
      arguments: { name: 'Equinor' },
    });
    const payload = JSON.parse(textOf(result));

    expect(payload.enheter[0].webUrl).toBe(
      'https://virksomhet.brreg.no/nb/oppslag/enheter/923609016'
    );
  });

  test('get_company includes its own webUrl', async () => {
    stubBrreg({ organisasjonsnummer: '923609016', navn: 'EQUINOR ASA' });

    const result = await ctx.client.callTool({
      name: 'get_company',
      arguments: { organizationNumber: '923609016' },
    });

    expect(JSON.parse(textOf(result)).webUrl).toBe(
      'https://virksomhet.brreg.no/nb/oppslag/enheter/923609016'
    );
  });

  test('get_subunit links to the subunit page', async () => {
    stubBrreg({ organisasjonsnummer: '973152351', navn: 'AVDELING' });

    const result = await ctx.client.callTool({
      name: 'get_subunit',
      arguments: { organizationNumber: '973152351' },
    });

    expect(JSON.parse(textOf(result)).webUrl).toBe(
      'https://virksomhet.brreg.no/nb/oppslag/underenheter/973152351'
    );
  });

  test('get_company_roles points _source at the company page', async () => {
    stubBrreg({ rollegrupper: [] });

    const result = await ctx.client.callTool({
      name: 'get_company_roles',
      arguments: { organizationNumber: '923609016' },
    });

    expect(JSON.parse(textOf(result))._source).toBe(
      'https://virksomhet.brreg.no/nb/oppslag/enheter/923609016'
    );
  });

  test('the change feed links every updated unit', async () => {
    stubBrreg({
      _embedded: {
        oppdaterteEnheter: [{ oppdateringsid: 7, organisasjonsnummer: '923609016' }],
      },
      page: { number: 0, totalPages: 1, size: 1, totalElements: 1 },
    });

    const result = await ctx.client.callTool({ name: 'get_company_updates', arguments: {} });
    const payload = JSON.parse(textOf(result));

    expect(payload.oppdaterteEnheter[0].webUrl).toBe(
      'https://virksomhet.brreg.no/nb/oppslag/enheter/923609016'
    );
  });

  test('NACE lookups cite the SSB Klass classification page', async () => {
    const search = await ctx.client.callTool({
      name: 'search_nace_codes',
      arguments: { exactCode: '01.110' },
    });
    const info = await ctx.client.callTool({ name: 'get_nace_classification_info', arguments: {} });

    expect(JSON.parse(textOf(search))._source).toBe('https://www.ssb.no/klass/klassifikasjoner/6');
    expect(JSON.parse(textOf(info))._source).toBe('https://www.ssb.no/klass/klassifikasjoner/6');
  });
});

describe('single-resource lookups', () => {
  test('get_company hits the enheter endpoint', async () => {
    await ctx.client.callTool({
      name: 'get_company',
      arguments: { organizationNumber: '923609016' },
    });
    expect(requestedUrls[0]).toContain('/enhetsregisteret/api/enheter/923609016');
  });

  test('get_subunit hits the underenheter endpoint', async () => {
    await ctx.client.callTool({
      name: 'get_subunit',
      arguments: { organizationNumber: '923609016' },
    });
    expect(requestedUrls[0]).toContain('/enhetsregisteret/api/underenheter/923609016');
  });

  test('get_company_roles hits the roller sub-resource', async () => {
    await ctx.client.callTool({
      name: 'get_company_roles',
      arguments: { organizationNumber: '923609016' },
    });
    expect(requestedUrls[0]).toContain('/enheter/923609016/roller');
  });

  test('get_company reports a missing organisation number', async () => {
    const result = await ctx.client.callTool({ name: 'get_company', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('organizationNumber');
    expect(requestedUrls.length).toBe(0);
  });

  test('get_organization_form uppercases and escapes the code', async () => {
    await ctx.client.callTool({
      name: 'get_organization_form',
      arguments: { organizationCode: 'as' },
    });
    expect(requestedUrls[0]).toContain('/organisasjonsformer/AS');
  });

  test('get_organization_form rejects a path-traversal attempt', async () => {
    const result = await ctx.client.callTool({
      name: 'get_organization_form',
      arguments: { organizationCode: '../../enheter' },
    });
    expect(result.isError).toBe(true);
    expect(requestedUrls.length).toBe(0);
  });

  test('get_municipality validates the number', async () => {
    const result = await ctx.client.callTool({
      name: 'get_municipality',
      arguments: { municipalityNumber: '30' },
    });
    expect(result.isError).toBe(true);
    expect(requestedUrls.length).toBe(0);
  });
});

describe('search_nace_codes', () => {
  test('resolves an exact code without touching the network', async () => {
    const result = await ctx.client.callTool({
      name: 'search_nace_codes',
      arguments: { exactCode: '01.110' },
    });

    const payload = JSON.parse(textOf(result));
    expect(requestedUrls.length).toBe(0);
    expect(payload.totalResults).toBe(1);
    expect(payload.codes[0].code).toBe('01.110');
    // A single hit is a deliberate lookup, so notes come along.
    expect(payload.codes[0].notes).toBeDefined();
  });

  test('caps results and says how many were withheld', async () => {
    const result = await ctx.client.callTool({
      name: 'search_nace_codes',
      arguments: { parentCode: 'A', limit: 5 },
    });

    const payload = JSON.parse(textOf(result));
    expect(payload.returned).toBe(5);
    expect(payload.totalResults).toBeGreaterThan(5);
    expect(payload._hint).toContain('more matches');
  });

  test('returns the 22 sections instead of the whole classification when given no criteria', async () => {
    const result = await ctx.client.callTool({ name: 'search_nace_codes', arguments: {} });
    const payload = JSON.parse(textOf(result));
    expect(payload.totalResults).toBe(22);
  });

  test('reports an unknown code as an empty result rather than an error', async () => {
    const result = await ctx.client.callTool({
      name: 'search_nace_codes',
      arguments: { exactCode: '99.999' },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result)).totalResults).toBe(0);
  });
});

describe('get_nace_classification_info', () => {
  test('returns metadata without the 1800 items', async () => {
    const result = await ctx.client.callTool({
      name: 'get_nace_classification_info',
      arguments: {},
    });
    const payload = JSON.parse(textOf(result));

    expect(payload.itemCount).toBeGreaterThan(1000);
    expect(payload.classificationItems).toBeUndefined();
    expect(textOf(result).length).toBeLessThan(4000);
  });
});

describe('updates feed', () => {
  test('maps the cursor arguments onto Brreg names', async () => {
    await ctx.client.callTool({
      name: 'get_company_updates',
      arguments: { date: '2026-01-01T00:00:00.000Z', updateId: 42, includeChanges: true },
    });

    const query = lastQuery();
    expect(query.get('dato')).toBe('2026-01-01T00:00:00.000Z');
    expect(query.get('oppdateringsid')).toBe('42');
    expect(query.get('includeChanges')).toBe('true');
  });
});

describe('describeToolError', () => {
  test('labels each error class distinctly', () => {
    expect(describeToolError(new BrregValidationError('bad'))).toStartWith('Validation error');
    expect(describeToolError(new BrregNotFoundError('gone'))).toStartWith('Not found');
    expect(describeToolError(new BrregRateLimitError('slow', 5))).toContain('Retry after 5s');
    expect(describeToolError(new Error('boom'))).toBe('Error: boom');
  });
});
