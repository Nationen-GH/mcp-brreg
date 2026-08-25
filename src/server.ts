import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { BrregAPIClient } from './client.js';
import { NACEUtils } from './nace-utils.js';
import { TOOLS } from './tools.js';
import { errorResult, paginationHint, toolResult, type ToolResult } from './compact.js';
import { companyPageUrl, NACE_SOURCE_URL, type UnitKind } from './links.js';
import {
  BrregAPIError,
  BrregNotFoundError,
  BrregRateLimitError,
  BrregValidationError,
} from './types.js';

export const SERVER_NAME = 'mcp-brreg';
export const SERVER_VERSION = '1.2.0';

const API = '/enhetsregisteret/api';

/** Reference endpoints whose contents change at most a few times a year. */
const CACHEABLE = true;

type Args = Record<string, unknown>;

export class BrregMCPServer {
  private readonly server: Server;
  private readonly client: BrregAPIClient;

  constructor(client: BrregAPIClient = new BrregAPIClient()) {
    this.server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {} } }
    );
    this.client = client;
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: rawArgs } = request.params;
      const args = (rawArgs ?? {}) as Args;

      try {
        return await this.dispatch(name, args);
      } catch (error) {
        return errorResult(describeToolError(error));
      }
    });
  }

  private dispatch(name: string, args: Args): Promise<ToolResult> {
    switch (name) {
      case 'search_companies':
        return this.searchUnits(`${API}/enheter`, args, 'enhet');
      case 'search_subunits':
        return this.searchUnits(`${API}/underenheter`, args, 'underenhet');
      case 'get_company':
        return this.getUnit(`${API}/enheter`, args, 'enhet');
      case 'get_subunit':
        return this.getUnit(`${API}/underenheter`, args, 'underenhet');
      case 'get_company_roles':
        return this.getCompanyRoles(args);
      case 'get_services':
        return this.simpleGet(API, args, CACHEABLE);
      case 'get_organization_forms':
        return this.pagedGet(`${API}/organisasjonsformer`, args, CACHEABLE);
      case 'get_organization_forms_for_units':
        return this.pagedGet(`${API}/organisasjonsformer/enheter`, args, CACHEABLE);
      case 'get_organization_forms_for_subunits':
        return this.pagedGet(`${API}/organisasjonsformer/underenheter`, args, CACHEABLE);
      case 'get_organization_form':
        return this.getOrganizationForm(args);
      case 'get_municipalities':
        return this.pagedGet(`${API}/kommuner`, args, CACHEABLE);
      case 'get_municipality':
        return this.getMunicipality(args);
      case 'get_role_types':
        return this.simpleGet(`${API}/roller/rolletyper`, args, CACHEABLE);
      case 'get_role_group_types':
        return this.simpleGet(`${API}/roller/rollegruppetyper`, args, CACHEABLE);
      case 'get_role_representatives':
        return this.simpleGet(`${API}/roller/representanter`, args, CACHEABLE);
      case 'get_company_updates':
        return this.getUpdates(`${API}/oppdateringer/enheter`, args, 'enhet');
      case 'get_subunit_updates':
        return this.getUpdates(`${API}/oppdateringer/underenheter`, args, 'underenhet');
      case 'search_nace_codes':
        return this.searchNACECodes(args);
      case 'get_nace_classification_info':
        return Promise.resolve(
          toolResult(NACEUtils.getClassificationInfo(), {
            compact: true,
            meta: { _source: NACE_SOURCE_URL },
          })
        );
      default:
        throw new BrregValidationError(`Unknown tool: ${name}`);
    }
  }

  // -- unit search -----------------------------------------------------------

  private async searchUnits(endpoint: string, args: Args, kind: UnitKind): Promise<ToolResult> {
    const isMainUnit = kind === 'enhet';
    assertOrgNumbers(args.organizationNumber, 'organizationNumber');
    assertOrgNumber(args.parentCompany, 'parentCompany');
    assertMunicipalityNumbers(args.municipalityNumber, 'municipalityNumber');
    assertMunicipalityNumbers(args.postalMunicipalityNumber, 'postalMunicipalityNumber');

    const { codes: industryCodes, truncated } = resolveIndustryCodes(args);

    const common = {
      navn: args.name,
      organisasjonsnummer: args.organizationNumber,
      overordnetEnhet: args.parentCompany,
      fraAntallAnsatte: args.fromEmployees,
      tilAntallAnsatte: args.toEmployees,
      registrertIMvaregisteret: args.registeredInVAT,
      kommunenummer: args.municipalityNumber,
      naeringskode: industryCodes,
      ...pagingParams(args),
    };

    const params = isMainUnit
      ? {
          ...common,
          konkurs: args.bankrupt,
          underAvvikling: args.underLiquidation,
          underTvangsavviklingEllerTvangsopplosning: args.underCompulsoryLiquidation,
          registrertIForetaksregisteret: args.registeredInBusinessRegister,
          organisasjonsform: args.organizationForm,
          'postadresse.kommunenummer': args.postalMunicipalityNumber,
          sisteInnsendteAarsregnskap: args.lastSubmittedAnnualAccounts,
        }
      : common;

    const response = await this.client.get(endpoint, this.client.buildParams(params));

    const meta = paginationHint(response) ?? {};
    if (truncated) {
      meta._warning =
        'expandIndustryCodes hit its 500-code ceiling, so the filter was truncated. The API expands codes hierarchically on its own — drop expandIndustryCodes and pass the broader code instead.';
    }

    return toolResult(response, { compact: wantsCompact(args), meta, sourceLinks: kind });
  }

  private async getUnit(endpoint: string, args: Args, kind: UnitKind): Promise<ToolResult> {
    const orgNr = args.organizationNumber;
    assertOrgNumber(orgNr, 'organizationNumber', true);

    const response = await this.client.get(`${endpoint}/${orgNr as string}`);
    return toolResult(response, { compact: wantsCompact(args), sourceLinks: kind });
  }

  private async getCompanyRoles(args: Args): Promise<ToolResult> {
    const orgNr = args.organizationNumber;
    assertOrgNumber(orgNr, 'organizationNumber', true);

    const response = await this.client.get(`${API}/enheter/${orgNr as string}/roller`);
    return toolResult(response, {
      compact: wantsCompact(args),
      // The roles payload carries no organisation number of its own, so the
      // reference link goes in as metadata: roles are shown on the company page.
      meta: { _source: companyPageUrl(orgNr as string) },
    });
  }

  // -- reference data --------------------------------------------------------

  private async simpleGet(endpoint: string, args: Args, cacheable = false): Promise<ToolResult> {
    const response = await this.client.get(endpoint, undefined, cacheable);
    return toolResult(response, { compact: wantsCompact(args) });
  }

  private async pagedGet(endpoint: string, args: Args, cacheable = false): Promise<ToolResult> {
    const params = this.client.buildParams(pagingParams(args));
    const response = await this.client.get(endpoint, params, cacheable);
    return toolResult(response, {
      compact: wantsCompact(args),
      meta: paginationHint(response),
    });
  }

  private async getOrganizationForm(args: Args): Promise<ToolResult> {
    const code = args.organizationCode;
    if (typeof code !== 'string' || !/^[A-Za-z0-9-]{1,10}$/.test(code)) {
      throw new BrregValidationError(
        `Invalid organisation form code: ${JSON.stringify(code)}. Expected a short code such as "AS" or "ENK".`
      );
    }

    const response = await this.client.get(
      `${API}/organisasjonsformer/${encodeURIComponent(code.toUpperCase())}`,
      undefined,
      CACHEABLE
    );
    return toolResult(response, { compact: wantsCompact(args) });
  }

  private async getMunicipality(args: Args): Promise<ToolResult> {
    const number = args.municipalityNumber;
    if (!BrregAPIClient.validateMunicipalityNumber(number)) {
      throw new BrregValidationError(
        `Invalid municipality number: ${JSON.stringify(number)}. Must be exactly 4 digits, e.g. "0301".`
      );
    }

    const response = await this.client.get(
      `${API}/kommuner/${number as string}`,
      undefined,
      CACHEABLE
    );
    return toolResult(response, { compact: wantsCompact(args) });
  }

  private async getUpdates(endpoint: string, args: Args, kind: UnitKind): Promise<ToolResult> {
    assertOrgNumbers(args.organizationNumber, 'organizationNumber');

    const params = this.client.buildParams({
      dato: args.date,
      updatedBefore: args.updatedBefore,
      oppdateringsid: args.updateId,
      organisasjonsnummer: args.organizationNumber,
      includeChanges: args.includeChanges,
      ...pagingParams(args),
    });

    const response = await this.client.get(endpoint, params);
    return toolResult(response, {
      compact: wantsCompact(args),
      meta: paginationHint(response),
      sourceLinks: kind,
    });
  }

  // -- offline NACE lookup ---------------------------------------------------

  private async searchNACECodes(args: Args): Promise<ToolResult> {
    const { searchText, parentCode, exactCode, level } = args;
    const includeHierarchy = args.includeHierarchy !== false;
    const limit = clamp(numberOr(args.limit, 50), 1, 500);

    let matches;
    if (typeof exactCode === 'string' && exactCode) {
      const hit = NACEUtils.getNACEByCode(exactCode);
      matches = hit ? [hit] : [];
    } else if (typeof parentCode === 'string' && parentCode) {
      matches = NACEUtils.getHierarchicalCodes(parentCode);
    } else if (typeof searchText === 'string' && searchText.trim()) {
      matches = NACEUtils.searchNACECodes(searchText);
    } else if (typeof level === 'string' && level) {
      matches = NACEUtils.getNACECodesByLevel(level);
    } else {
      // No criteria used to dump all ~1800 codes into the context window.
      matches = NACEUtils.getTopLevelNACECodes();
    }

    const total = matches.length;
    const page = matches.slice(0, limit);
    // A single hit is a deliberate lookup, so the notes are worth their tokens.
    const includeNotes = args.includeNotes === true || total === 1;

    const codes = page.map((item) => ({
      code: item.code,
      name: item.name,
      ...(item.shortName && item.shortName !== item.name ? { shortName: item.shortName } : {}),
      level: item.level,
      parentCode: item.parentCode,
      ...(includeHierarchy ? { fullCodePath: item.fullCodePath } : {}),
      ...(includeNotes && item.notes ? { notes: item.notes } : {}),
    }));

    return toolResult(
      {
        totalResults: total,
        returned: codes.length,
        ...(total > codes.length
          ? { _hint: `${total - codes.length} more matches; raise "limit" or narrow the query.` }
          : {}),
        codes,
        _source: NACE_SOURCE_URL,
      },
      { compact: true }
    );
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);
  }

  async close(): Promise<void> {
    await this.server.close();
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function wantsCompact(args: Args): boolean {
  return args.compact !== false;
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Brreg pages are zero-based. `page` is passed through untouched so callers
 * keep full control, but negatives are clamped rather than sent as a 400.
 */
function pagingParams(args: Args): Record<string, unknown> {
  const params: Record<string, unknown> = { sort: args.sort };
  if (args.page !== undefined) params.page = Math.max(0, numberOr(args.page, 0));
  if (args.size !== undefined) params.size = Math.max(1, numberOr(args.size, 20));
  return params;
}

/**
 * Resolve the `naeringskode` filter.
 *
 * The API matches codes hierarchically already, so client-side expansion is
 * opt-in only; see the `expandIndustryCodes` note in tools.ts.
 */
function resolveIndustryCodes(args: Args): { codes: unknown; truncated: boolean } {
  const codes = args.industryCode;
  if (!Array.isArray(codes) || codes.length === 0) return { codes, truncated: false };
  if (args.expandIndustryCodes !== true) return { codes, truncated: false };

  const expanded = NACEUtils.expandIndustryCodes(codes.map(String));
  return { codes: expanded.codes, truncated: expanded.truncated };
}

function assertOrgNumber(value: unknown, field: string, required = false): void {
  if (value === undefined || value === null) {
    if (required) {
      throw new BrregValidationError(
        `Missing required parameter "${field}" (9-digit organisation number).`
      );
    }
    return;
  }
  if (!BrregAPIClient.validateOrganizationNumber(value)) {
    throw new BrregValidationError(
      `Invalid organisation number in "${field}": ${JSON.stringify(value)}. Must be exactly 9 digits, e.g. "923609016".`
    );
  }
}

function assertOrgNumbers(value: unknown, field: string): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    throw new BrregValidationError(`"${field}" must be an array of 9-digit organisation numbers.`);
  }
  for (const entry of value) assertOrgNumber(entry, field);
}

function assertMunicipalityNumbers(value: unknown, field: string): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    throw new BrregValidationError(`"${field}" must be an array of 4-digit municipality numbers.`);
  }
  for (const entry of value) {
    if (!BrregAPIClient.validateMunicipalityNumber(entry)) {
      throw new BrregValidationError(
        `Invalid municipality number in "${field}": ${JSON.stringify(entry)}. Must be exactly 4 digits, e.g. "0301".`
      );
    }
  }
}

/** Turn a thrown error into a message a model can act on. */
export function describeToolError(error: unknown): string {
  if (error instanceof BrregValidationError) return `Validation error: ${error.message}`;
  if (error instanceof BrregNotFoundError) return `Not found: ${error.message}`;
  if (error instanceof BrregRateLimitError) {
    const wait = error.retryAfterSeconds ? ` Retry after ${error.retryAfterSeconds}s.` : '';
    return `Rate limited by Brreg: ${error.message}.${wait}`;
  }
  if (error instanceof BrregAPIError) {
    return `API error${error.status ? ` (${error.status})` : ''}: ${error.message}`;
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}
