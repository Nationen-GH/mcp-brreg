/**
 * Response shaping for MCP tool results.
 *
 * Brreg responses are HAL documents: every nested object carries a `_links`
 * block of self-referential URLs. On a 20-hit company search that boilerplate is
 * ~40% of the payload (and ~85% on the municipality list), and none of it is
 * useful to a model. Stripping it — and emitting minified rather than
 * pretty-printed JSON — is the cheapest large win available to this server.
 */

import { addSourceLinks, type UnitKind } from './links.js';

/** Keys removed from every response when compact mode is on. */
const NOISE_KEYS = new Set(['_links', 'links']);

/** Guard against pathological nesting in an unexpected payload. */
const MAX_DEPTH = 32;

export function stripHalNoise<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item) => stripHalNoise(item, depth + 1)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (NOISE_KEYS.has(key)) continue;
    out[key] = stripHalNoise(item, depth + 1);
  }
  return out as T;
}

/**
 * Lift `_embedded.<collection>` to the top level.
 *
 * `{_embedded: {enheter: [...]}, page: {...}}` becomes `{enheter: [...], page: {...}}`,
 * which is both smaller and easier for a model to read.
 */
export function flattenEmbedded(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;

  const record = value as Record<string, unknown>;
  const embedded = record._embedded;
  if (embedded === null || typeof embedded !== 'object' || Array.isArray(embedded)) return value;

  const { _embedded, ...rest } = record;
  return { ...(embedded as Record<string, unknown>), ...rest };
}

export interface FormatOptions {
  /** Strip HAL noise and minify. Defaults to true. */
  compact?: boolean;
  /** Extra fields merged into the emitted object, e.g. pagination hints. */
  meta?: Record<string, unknown>;
  /**
   * Add a `webUrl` (the public virksomhet.brreg.no page) to every unit of
   * this kind. Applied in compact mode only — the raw document stays raw.
   */
  sourceLinks?: UnitKind;
}

/**
 * MCP tool result envelope.
 *
 * The index signature is required for assignability to the SDK's `ServerResult`
 * union, which models the open-ended `result` object of a JSON-RPC response.
 */
export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Serialise a payload into an MCP text result. */
export function toolResult(payload: unknown, options: FormatOptions = {}): ToolResult {
  const compact = options.compact !== false;

  let body: unknown = payload;
  if (compact) {
    body = stripHalNoise(flattenEmbedded(payload));
    if (options.sourceLinks) body = addSourceLinks(body, options.sourceLinks);
  }

  if (options.meta && body !== null && typeof body === 'object' && !Array.isArray(body)) {
    body = { ...(body as Record<string, unknown>), ...options.meta };
  }

  return {
    content: [
      {
        type: 'text',
        text: compact ? JSON.stringify(body) : JSON.stringify(body, null, 2),
      },
    ],
  };
}

/** Serialise an error message into an MCP tool result flagged as an error. */
export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Human-readable pagination hint derived from Spring's `page` block.
 *
 * Brreg pages are zero-based, which models reliably get wrong; restating the
 * current index and how to advance keeps follow-up calls correct.
 */
export function paginationHint(payload: unknown): Record<string, unknown> | undefined {
  if (payload === null || typeof payload !== 'object') return undefined;

  const page = (payload as Record<string, unknown>).page as Record<string, unknown> | undefined;
  if (!page || typeof page.number !== 'number' || typeof page.totalPages !== 'number') {
    return undefined;
  }

  const current = page.number;
  const total = page.totalPages;
  const hasMore = current + 1 < total;

  return {
    _hint: hasMore
      ? `Showing page ${current} of ${total} (pages are zero-based). Pass page=${current + 1} for the next page.`
      : `Showing page ${current} of ${total} (pages are zero-based). This is the last page.`,
  };
}
