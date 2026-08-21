/**
 * Shared types for the Brønnøysundregistrene MCP server.
 *
 * Only types that are actually consumed live here — the Brreg payloads are
 * passed through to the client verbatim (minus HAL noise, see compact.ts), so
 * we deliberately do not try to mirror the whole API surface as interfaces.
 */

/** One entry of the `valideringsfeil` array Brreg returns on a 400. */
export interface BrregValidationDetail {
  feilmelding?: string;
  /** Names of the query parameters the message refers to. */
  parametere?: string[];
  /** The rejected value, already stringified by the API. */
  feilaktigVerdi?: string;
}

/**
 * Error body returned by the Brreg API on 4xx/5xx.
 *
 * A 400 carries a `valideringsfeil` array naming the offending parameter and
 * value ("Naeringskode 4 er ugyldig"), which is exactly what a caller needs to
 * fix the call — the previous implementation discarded it.
 */
export interface BrregErrorResponse {
  feilmelding?: string;
  feilkode?: string;
  tidsstempel?: number | string;
  valideringsfeil?: BrregValidationDetail[];
  sti?: string;
  antallFeil?: number;
  /** Spring's default error shape, used by some endpoints. */
  message?: string;
  error?: string;
}

/** Spring `page` metadata attached to every paged Brreg response. */
export interface PageMetadata {
  size: number;
  totalElements: number;
  totalPages: number;
  /** Zero-based page index. */
  number: number;
}

export class BrregAPIError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public timestamp?: string
  ) {
    super(message);
    this.name = 'BrregAPIError';
  }
}

export class BrregRateLimitError extends BrregAPIError {
  constructor(
    message: string = 'Rate limit exceeded',
    /** Seconds to wait before retrying, parsed from the Retry-After header. */
    public retryAfterSeconds?: number
  ) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
    this.name = 'BrregRateLimitError';
  }
}

export class BrregNotFoundError extends BrregAPIError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'BrregNotFoundError';
  }
}

export class BrregValidationError extends BrregAPIError {
  constructor(message: string = 'Validation error') {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'BrregValidationError';
  }
}

// ---------------------------------------------------------------------------
// NACE / SN classification (data/nace-codes-full.json, from SSB Klass)
// ---------------------------------------------------------------------------

export interface ClassificationItemResource {
  code: string;
  /** Empty string for top-level items (the 22 sections A–V). */
  parentCode: string;
  /** Level as a numeric string, "1" (section) through "5" (national subclass). */
  level: string;
  name: string;
  shortName: string;
  notes: string;
}

export interface LevelResource {
  levelNumber: number;
  levelName: string;
}

/** The subset of the SSB Klass version resource that we actually read. */
export interface ClassificationVersionResource {
  name: string;
  id: number;
  validFrom: string;
  validTo?: string;
  lastModified: string;
  levels: LevelResource[];
  classificationItems: ClassificationItemResource[];
}

/** A classification item enriched with its resolved ancestor path. */
export interface NACECodeEnhanced {
  code: string;
  name: string;
  shortName: string;
  parentCode: string;
  level: string;
  notes: string;
  /** Ancestor chain joined with " / ", e.g. "A / 01 / 01.1 / 01.11". */
  fullCodePath: string;
}
