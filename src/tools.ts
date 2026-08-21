import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Tool definitions for the Brreg MCP server.
 *
 * Two conventions matter here and are repeated in every schema that needs them:
 *
 * 1. Brreg pages are **zero-based**. The previous schemas documented and
 *    defaulted `page` to 1, so a model asking for "the first page" silently got
 *    the second one.
 * 2. `naeringskode` is matched hierarchically **by the API itself** — `41`
 *    matches `41.000`, and section letters such as `F` work too. Callers do not
 *    need to enumerate subcodes.
 */

const pageParam = {
  type: 'number' as const,
  description: 'Zero-based page index. The first page is 0.',
  default: 0,
  minimum: 0,
};

const sizeParam = (max: number, dflt = 20) => ({
  type: 'number' as const,
  description: `Results per page (default ${dflt}, max ${max}).`,
  default: dflt,
  minimum: 1,
  maximum: max,
});

const compactParam = {
  type: 'boolean' as const,
  description:
    'Strip HAL `_links` boilerplate and minify the JSON (default true). Set false only when you need the raw API document including hypermedia links.',
  default: true,
};

const sortParam = (example: string) => ({
  type: 'string' as const,
  description: `Sort as "field,DIRECTION" — e.g. ${example}. Direction must be ASC or DESC.`,
});

/** Page/size/compact, the trio every paged tool shares. */
const pagingProps = (maxSize: number, sortExample?: string) => ({
  page: pageParam,
  size: sizeParam(maxSize),
  ...(sortExample ? { sort: sortParam(sortExample) } : {}),
  compact: compactParam,
});

const orgNumberProp = {
  type: 'string' as const,
  description: 'Norwegian organisation number, exactly 9 digits (e.g. 923609016).',
  pattern: '^\\d{9}$',
};

export const TOOLS: Tool[] = [
  {
    name: 'search_companies',
    description:
      'Search main units (hovedenheter) in the Norwegian Business Registry. Returns a page of matching companies. Use get_company for the full record of one company.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Free-text company name match (1-180 characters).',
          minLength: 1,
          maxLength: 180,
        },
        organizationNumber: {
          type: 'array',
          items: { type: 'string', pattern: '^\\d{9}$' },
          description: 'Restrict to these organisation numbers (9 digits each).',
        },
        parentCompany: {
          type: 'string',
          description: 'Organisation number of the parent unit (public sector hierarchies).',
          pattern: '^\\d{9}$',
        },
        fromEmployees: {
          type: 'number',
          description: 'Minimum number of employees (inclusive).',
          minimum: 0,
        },
        toEmployees: {
          type: 'number',
          description: 'Maximum number of employees (inclusive).',
          minimum: 0,
        },
        bankrupt: { type: 'boolean', description: 'Filter on bankruptcy status (konkurs).' },
        underLiquidation: {
          type: 'boolean',
          description: 'Filter on voluntary liquidation (under avvikling).',
        },
        underCompulsoryLiquidation: {
          type: 'boolean',
          description:
            'Filter on compulsory liquidation or dissolution (under tvangsavvikling eller tvangsoppløsning).',
        },
        registeredInVAT: {
          type: 'boolean',
          description: 'Filter on registration in the VAT register (Merverdiavgiftsregisteret).',
        },
        registeredInBusinessRegister: {
          type: 'boolean',
          description: 'Filter on registration in the Business Register (Foretaksregisteret).',
        },
        organizationForm: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Organisation form codes, e.g. ["AS", "ENK"]. Use get_organization_forms to list valid codes.',
        },
        municipalityNumber: {
          type: 'array',
          items: { type: 'string', pattern: '^\\d{4}$' },
          description:
            'Municipality numbers (4 digits, e.g. ["0301"]). Use get_municipalities to look them up.',
        },
        postalMunicipalityNumber: {
          type: 'array',
          items: { type: 'string', pattern: '^\\d{4}$' },
          description: 'Match on the postal address municipality instead of the business address.',
        },
        industryCode: {
          type: 'array',
          items: { type: 'string' },
          description:
            'SN2025/NACE codes. Matching is hierarchical on the API side: "41" matches 41.000, "01.1" matches 01.11 and 01.110, and section letters such as "F" match the whole section. Pass the broadest code you mean — do not enumerate subcodes. Use search_nace_codes to find a code.',
        },
        lastSubmittedAnnualAccounts: {
          type: 'string',
          description: 'Year of the most recently filed annual accounts, e.g. "2023".',
          pattern: '^\\d{4}$',
        },
        expandIndustryCodes: {
          type: 'boolean',
          description:
            'Deprecated. Expands industryCode to every descendant code before querying. Off by default because the API already matches hierarchically; enabling it only makes the request URL longer.',
          default: false,
        },
        ...pagingProps(10_000, '"navn,ASC" or "antallAnsatte,DESC"'),
      },
    },
  },
  {
    name: 'get_company',
    description:
      'Get the full record for one main unit by organisation number, including addresses, industry codes, registry flags and historical names.',
    inputSchema: {
      type: 'object',
      properties: { organizationNumber: orgNumberProp, compact: compactParam },
      required: ['organizationNumber'],
    },
  },
  {
    name: 'get_company_roles',
    description:
      'Get registered roles for one main unit — board members, CEO, auditor, accountant and signature/procuration rights, grouped by role type.',
    inputSchema: {
      type: 'object',
      properties: { organizationNumber: orgNumberProp, compact: compactParam },
      required: ['organizationNumber'],
    },
  },
  {
    name: 'search_subunits',
    description:
      'Search subunits (underenheter) — the individual establishments belonging to a main unit. Filter by parentCompany to list every location of a company.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Free-text subunit name match (1-180 characters).',
          minLength: 1,
          maxLength: 180,
        },
        organizationNumber: {
          type: 'array',
          items: { type: 'string', pattern: '^\\d{9}$' },
          description: 'Restrict to these subunit organisation numbers.',
        },
        parentCompany: {
          type: 'string',
          description: 'Organisation number of the owning main unit.',
          pattern: '^\\d{9}$',
        },
        fromEmployees: { type: 'number', description: 'Minimum employees.', minimum: 0 },
        toEmployees: { type: 'number', description: 'Maximum employees.', minimum: 0 },
        registeredInVAT: { type: 'boolean', description: 'Filter on VAT registration.' },
        municipalityNumber: {
          type: 'array',
          items: { type: 'string', pattern: '^\\d{4}$' },
          description: 'Municipality numbers (4 digits).',
        },
        industryCode: {
          type: 'array',
          items: { type: 'string' },
          description: 'SN2025/NACE codes; matched hierarchically by the API.',
        },
        ...pagingProps(10_000, '"navn,ASC"'),
      },
    },
  },
  {
    name: 'get_subunit',
    description: 'Get the full record for one subunit by organisation number.',
    inputSchema: {
      type: 'object',
      properties: { organizationNumber: orgNumberProp, compact: compactParam },
      required: ['organizationNumber'],
    },
  },
  {
    name: 'get_services',
    description: 'List the endpoints the Brreg Enhetsregisteret API exposes.',
    inputSchema: { type: 'object', properties: { compact: compactParam } },
  },
  {
    name: 'get_organization_forms',
    description:
      'List all organisation form codes (AS, ENK, ASA, ...) with descriptions. Cached, safe to call freely.',
    inputSchema: { type: 'object', properties: pagingProps(1000, '"kode,ASC"') },
  },
  {
    name: 'get_organization_forms_for_units',
    description: 'List organisation forms that apply to main units.',
    inputSchema: { type: 'object', properties: pagingProps(1000, '"kode,ASC"') },
  },
  {
    name: 'get_organization_forms_for_subunits',
    description: 'List organisation forms that apply to subunits.',
    inputSchema: { type: 'object', properties: pagingProps(1000, '"kode,ASC"') },
  },
  {
    name: 'get_organization_form',
    description: 'Look up one organisation form by its code.',
    inputSchema: {
      type: 'object',
      properties: {
        organizationCode: {
          type: 'string',
          description: 'Organisation form code, e.g. "AS", "ENK", "ASA".',
        },
        compact: compactParam,
      },
      required: ['organizationCode'],
    },
  },
  {
    name: 'get_municipalities',
    description:
      'List Norwegian municipalities with their 4-digit numbers. Cached, safe to call freely.',
    inputSchema: { type: 'object', properties: pagingProps(1000, '"navn,ASC"') },
  },
  {
    name: 'get_municipality',
    description: 'Look up one municipality by its 4-digit number.',
    inputSchema: {
      type: 'object',
      properties: {
        municipalityNumber: {
          type: 'string',
          description: 'Municipality number, exactly 4 digits (e.g. "0301" for Oslo).',
          pattern: '^\\d{4}$',
        },
        compact: compactParam,
      },
      required: ['municipalityNumber'],
    },
  },
  {
    name: 'get_role_types',
    description: 'List valid role types (daglig leder, styreleder, revisor, ...). Cached.',
    inputSchema: { type: 'object', properties: { compact: compactParam } },
  },
  {
    name: 'get_role_group_types',
    description: 'List role group types (styre, revisor, regnskapsfører, ...). Cached.',
    inputSchema: { type: 'object', properties: { compact: compactParam } },
  },
  {
    name: 'get_role_representatives',
    description: 'List role representative types. Cached.',
    inputSchema: { type: 'object', properties: { compact: compactParam } },
  },
  {
    name: 'get_company_updates',
    description:
      'Poll the change feed for main units. Use `date` for a time window or `updateId` to resume from a previous cursor.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description:
            'Include updates from this instant onwards, ISO-8601 with milliseconds and Z, e.g. "2026-01-01T00:00:00.000Z".',
        },
        updatedBefore: {
          type: 'string',
          description: 'Include updates up to this instant, same ISO-8601 format as `date`.',
        },
        updateId: {
          type: 'number',
          description: 'Resume from this update id (>= 1). Sort by id,ASC to page forward.',
          minimum: 1,
        },
        organizationNumber: {
          type: 'array',
          items: { type: 'string', pattern: '^\\d{9}$' },
          description: 'Restrict the feed to these organisation numbers.',
        },
        includeChanges: {
          type: 'boolean',
          description: 'Include the field-level changes behind each update.',
        },
        ...pagingProps(10_000, '"id,ASC" (only id is sortable)'),
      },
    },
  },
  {
    name: 'get_subunit_updates',
    description: 'Poll the change feed for subunits. Same parameters as get_company_updates.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description:
            'Include updates from this instant onwards, ISO-8601 with milliseconds and Z.',
        },
        updatedBefore: {
          type: 'string',
          description: 'Include updates up to this instant, same ISO-8601 format as `date`.',
        },
        updateId: {
          type: 'number',
          description: 'Resume from this update id (>= 1).',
          minimum: 1,
        },
        organizationNumber: {
          type: 'array',
          items: { type: 'string', pattern: '^\\d{9}$' },
          description: 'Restrict the feed to these organisation numbers.',
        },
        includeChanges: {
          type: 'boolean',
          description: 'Include the field-level changes behind each update.',
        },
        ...pagingProps(10_000, '"id,ASC" (only id is sortable)'),
      },
    },
  },
  {
    name: 'search_nace_codes',
    description:
      'Look up SN2025/NACE industry codes offline, from the classification bundled with this server. Use it to turn a plain-language industry ("bakeri", "programmering") into a code you can pass to search_companies. Exactly one of searchText, exactCode, parentCode or level is used, in that order of precedence.',
    inputSchema: {
      type: 'object',
      properties: {
        searchText: {
          type: 'string',
          description:
            'Case-insensitive substring match against code, name and explanatory notes (Norwegian).',
        },
        exactCode: {
          type: 'string',
          description: 'Return exactly this code, e.g. "41.000".',
        },
        parentCode: {
          type: 'string',
          description: 'Return every descendant of this code, e.g. "01.1" or the section "A".',
        },
        level: {
          type: 'string',
          enum: ['1', '2', '3', '4', '5'],
          description:
            'Return every code at this level: 1 = section (A-V), 2 = division, 3 = group, 4 = class, 5 = national subclass.',
        },
        includeHierarchy: {
          type: 'boolean',
          description: 'Include the full ancestor path for each result (default true).',
          default: true,
        },
        includeNotes: {
          type: 'boolean',
          description:
            'Include the long explanatory notes. Off by default because they are verbose; single-result lookups always include them.',
          default: false,
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default 50, max 500).',
          default: 50,
          minimum: 1,
          maximum: 500,
        },
      },
    },
  },
  {
    name: 'get_nace_classification_info',
    description:
      'Metadata about the bundled SN2025/NACE classification — its name, validity dates, level definitions and item count. Use it to check which classification version this server resolves codes against.',
    inputSchema: { type: 'object', properties: {} },
  },
];

/** Tool names as a set, for quick membership checks. */
export const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));
