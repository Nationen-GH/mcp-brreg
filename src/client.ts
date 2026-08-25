import {
  BrregAPIError,
  BrregRateLimitError,
  BrregNotFoundError,
  BrregValidationError,
  BrregErrorResponse,
} from './types.js';

const PACKAGE_VERSION = '1.2.0';

export interface BrregClientOptions {
  baseURL?: string;
  timeoutMs?: number;
  /** Number of retries after the first attempt. 0 disables retrying. */
  maxRetries?: number;
  /** TTL for cached GET responses. 0 disables the cache. */
  cacheTtlMs?: number;
  /** Maximum number of cached responses before the oldest are evicted. */
  cacheMaxEntries?: number;
  userAgent?: string;
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

const DEFAULTS = {
  baseURL: 'https://data.brreg.no',
  timeoutMs: 30_000,
  maxRetries: 3,
  cacheTtlMs: 5 * 60_000,
  cacheMaxEntries: 500,
} as const;

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Thin HTTP client for the Brreg open data API.
 *
 * Uses the platform `fetch` (Node >= 18 / Bun) so the server ships without an
 * HTTP dependency. Adds bounded retries with exponential backoff for the
 * transient failures the public API is prone to (429 and 5xx), plus a small
 * in-memory response cache — the reference endpoints (organisation forms,
 * municipalities, role types) are effectively static but are re-fetched on
 * every tool call otherwise.
 */
export class BrregAPIClient {
  private readonly baseURL: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly cacheTtlMs: number;
  private readonly cacheMaxEntries: number;
  private readonly userAgent: string;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: BrregClientOptions = {}) {
    this.baseURL = (options.baseURL ?? process.env.BRREG_BASE_URL ?? DEFAULTS.baseURL).replace(
      /\/+$/,
      ''
    );
    this.timeoutMs = options.timeoutMs ?? intFromEnv('BRREG_TIMEOUT_MS', DEFAULTS.timeoutMs);
    this.maxRetries = options.maxRetries ?? intFromEnv('BRREG_MAX_RETRIES', DEFAULTS.maxRetries);
    this.cacheTtlMs = options.cacheTtlMs ?? intFromEnv('BRREG_CACHE_TTL_MS', DEFAULTS.cacheTtlMs);
    this.cacheMaxEntries =
      options.cacheMaxEntries ?? intFromEnv('BRREG_CACHE_MAX_ENTRIES', DEFAULTS.cacheMaxEntries);
    this.userAgent = options.userAgent ?? `mcp-brreg/${PACKAGE_VERSION}`;
  }

  /**
   * GET a JSON resource.
   *
   * @param endpoint Path below the API root, e.g. `/enhetsregisteret/api/enheter`.
   * @param params   Query parameters; arrays are joined with commas as Brreg expects.
   * @param cacheable Whether the response may be served from / stored in the cache.
   */
  async get<T>(
    endpoint: string,
    params?: Record<string, unknown> | URLSearchParams,
    cacheable = false
  ): Promise<T> {
    const url = this.buildURL(endpoint, params);
    const useCache = cacheable && this.cacheTtlMs > 0;

    if (useCache) {
      const hit = this.readCache(url);
      if (hit !== undefined) return hit as T;
    }

    const value = await this.fetchWithRetry<T>(url);

    if (useCache) this.writeCache(url, value);
    return value;
  }

  private buildURL(endpoint: string, params?: Record<string, unknown> | URLSearchParams): string {
    const search =
      params instanceof URLSearchParams ? params : BrregAPIClient.buildParams(params ?? {});
    const query = search.toString();
    return `${this.baseURL}${endpoint}${query ? `?${query}` : ''}`;
  }

  private async fetchWithRetry<T>(url: string): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.fetchOnce<T>(url);
      } catch (error) {
        lastError = error;
        if (attempt === this.maxRetries || !isRetryable(error)) throw error;
        await sleep(this.backoffMs(attempt, error));
      }
    }

    throw lastError;
  }

  private async fetchOnce<T>(url: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          Accept: 'application/json',
          'User-Agent': this.userAgent,
        },
      });
    } catch (error) {
      const err = error as Error;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new BrregAPIError(`Request timed out after ${this.timeoutMs}ms`, 408, 'TIMEOUT');
      }
      throw new BrregAPIError(`Network error: ${err.message}`, undefined, 'NETWORK_ERROR');
    }

    if (!response.ok) throw await this.toError(response);

    try {
      return (await response.json()) as T;
    } catch {
      throw new BrregAPIError('Received a malformed JSON response from Brreg', response.status);
    }
  }

  private async toError(response: Response): Promise<BrregAPIError> {
    let body: BrregErrorResponse | null = null;
    try {
      body = (await response.json()) as BrregErrorResponse | null;
    } catch {
      // Non-JSON error bodies (HTML from a proxy, an empty 5xx) are expected;
      // fall back to the status text below.
    }

    const message = describeError(body, response);
    const timestamp = body?.tidsstempel === undefined ? undefined : String(body.tidsstempel);

    switch (response.status) {
      case 400:
        return new BrregValidationError(message);
      case 404:
        return new BrregNotFoundError(message);
      case 429:
        return new BrregRateLimitError(
          message,
          parseRetryAfter(response.headers.get('retry-after'))
        );
      default:
        return new BrregAPIError(
          response.status >= 500 ? `Server error: ${message}` : message,
          response.status,
          body?.feilkode,
          timestamp
        );
    }
  }

  /** Exponential backoff with full jitter, capped at 10s and honouring Retry-After. */
  private backoffMs(attempt: number, error: unknown): number {
    if (error instanceof BrregRateLimitError && error.retryAfterSeconds !== undefined) {
      return Math.min(error.retryAfterSeconds * 1000, 30_000);
    }
    const ceiling = Math.min(500 * 2 ** attempt, 10_000);
    return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
  }

  private readCache(key: string): unknown | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    // Refresh insertion order so the LRU eviction below keeps hot entries.
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  private writeCache(key: string, value: unknown): void {
    if (this.cache.size >= this.cacheMaxEntries) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, { expiresAt: Date.now() + this.cacheTtlMs, value });
  }

  /** Drops every cached response. Exposed for tests and long-lived processes. */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Build query parameters, skipping empty values and joining arrays with
   * commas — the format Brreg's multi-value filters expect.
   */
  static buildParams(params: Record<string, unknown>): URLSearchParams {
    const searchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;

      if (Array.isArray(value)) {
        const items = value.filter((v) => v !== undefined && v !== null && v !== '');
        if (items.length > 0) searchParams.append(key, items.join(','));
      } else {
        searchParams.append(key, String(value));
      }
    }

    return searchParams;
  }

  /** Instance alias kept for convenience at call sites. */
  buildParams(params: Record<string, unknown>): URLSearchParams {
    return BrregAPIClient.buildParams(params);
  }

  /** Norwegian organisation numbers are exactly 9 digits. */
  static validateOrganizationNumber(orgNr: unknown): boolean {
    return typeof orgNr === 'string' && /^\d{9}$/.test(orgNr);
  }

  /** Norwegian municipality numbers are exactly 4 digits. */
  static validateMunicipalityNumber(municipalityNr: unknown): boolean {
    return typeof municipalityNr === 'string' && /^\d{4}$/.test(municipalityNr);
  }
}

/**
 * Build a message that tells the caller how to fix the request.
 *
 * Brreg's 400s put the actionable part in `valideringsfeil` — the top-level
 * `feilmelding` is always the generic "Feilaktig foresporsel".
 */
function describeError(body: BrregErrorResponse | null, response: Response): string {
  const base =
    body?.feilmelding || body?.message || body?.error || response.statusText || 'Unknown error';

  const details = (body?.valideringsfeil ?? [])
    .map((detail) => {
      const params = detail.parametere?.length ? ` (${detail.parametere.join(', ')})` : '';
      const value = detail.feilaktigVerdi ? `: ${detail.feilaktigVerdi}` : '';
      return `${detail.feilmelding ?? 'invalid parameter'}${params}${value}`;
    })
    .filter(Boolean);

  return details.length > 0 ? `${base} - ${details.join('; ')}` : base;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof BrregRateLimitError) return true;
  if (!(error instanceof BrregAPIError)) return false;
  if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') return true;
  return error.status !== undefined && error.status >= 500;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;

  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
