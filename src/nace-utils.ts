import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ClassificationVersionResource,
  NACECodeEnhanced,
  ClassificationItemResource,
} from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Candidate locations for the classification dump, in priority order.
 *
 * Resolving relative to this module (rather than `process.cwd()`) matters:
 * MCP clients spawn stdio servers from an arbitrary working directory, so a
 * cwd-relative path only works when the server happens to be launched from the
 * repository root.
 */
function candidatePaths(): string[] {
  const paths: string[] = [];
  if (process.env.BRREG_NACE_DATA) paths.push(resolve(process.env.BRREG_NACE_DATA));
  paths.push(
    join(HERE, '..', 'data', 'nace-codes-full.json'), // running from src/ or dist/
    join(HERE, '..', '..', 'data', 'nace-codes-full.json'), // running from dist/src/
    join(process.cwd(), 'data', 'nace-codes-full.json')
  );
  return paths;
}

/** Separator used to join ancestor codes into `fullCodePath`. */
const PATH_SEP = ' / ';

/**
 * Lookup helpers over the SN2025/NACE classification shipped in
 * `data/nace-codes-full.json`.
 *
 * Everything is derived once, lazily, into hash indexes — the previous
 * implementation rescanned the ~1800-item array linearly on every lookup, and
 * `search_companies` triggers several lookups per call.
 */
export class NACEUtils {
  private static naceData: ClassificationVersionResource | null = null;
  private static byCode: Map<string, NACECodeEnhanced> | null = null;
  private static childrenByParent: Map<string, string[]> | null = null;
  private static byLevel: Map<string, NACECodeEnhanced[]> | null = null;

  private static loadNACEData(): ClassificationVersionResource {
    if (this.naceData) return this.naceData;

    const attempted = candidatePaths();
    for (const path of attempted) {
      try {
        const raw = readFileSync(path, 'utf-8');
        const parsed = JSON.parse(raw) as ClassificationVersionResource;
        if (!Array.isArray(parsed.classificationItems)) {
          throw new Error('missing classificationItems array');
        }
        this.naceData = parsed;
        return parsed;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Keep looking when the file simply is not there; surface anything else.
        if (code === 'ENOENT' || code === 'EISDIR') continue;
        throw new Error(`Failed to parse NACE classification data at ${path}: ${String(error)}`);
      }
    }

    throw new Error(
      `Failed to load NACE classification data. Looked in:\n  ${attempted.join('\n  ')}\n` +
        'Set BRREG_NACE_DATA to point at nace-codes-full.json.'
    );
  }

  private static index(): Map<string, NACECodeEnhanced> {
    if (!this.byCode) this.build(this.loadNACEData().classificationItems);
    return this.byCode!;
  }

  private static children(): Map<string, string[]> {
    if (!this.childrenByParent) this.build(this.loadNACEData().classificationItems);
    return this.childrenByParent!;
  }

  private static build(items: ClassificationItemResource[]): void {
    const byCode = new Map<string, NACECodeEnhanced>();
    const childrenByParent = new Map<string, string[]>();
    const byLevel = new Map<string, NACECodeEnhanced[]>();

    for (const item of items) {
      byCode.set(item.code, {
        code: item.code,
        name: item.name,
        shortName: item.shortName,
        parentCode: item.parentCode,
        level: item.level,
        notes: item.notes,
        fullCodePath: item.code, // replaced below
      });
    }

    for (const entry of byCode.values()) {
      entry.fullCodePath = this.resolvePath(entry.code, byCode);

      if (entry.parentCode && entry.parentCode !== entry.code) {
        const siblings = childrenByParent.get(entry.parentCode);
        if (siblings) siblings.push(entry.code);
        else childrenByParent.set(entry.parentCode, [entry.code]);
      }

      const level = byLevel.get(entry.level);
      if (level) level.push(entry);
      else byLevel.set(entry.level, [entry]);
    }

    this.byCode = byCode;
    this.childrenByParent = childrenByParent;
    this.byLevel = byLevel;
  }

  /**
   * Walk up the parent chain to build the display path. The `seen` set guards
   * against a cycle in the source data, which would otherwise recurse until the
   * stack overflows.
   */
  private static resolvePath(code: string, byCode: Map<string, NACECodeEnhanced>): string {
    const segments: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = code;

    while (current) {
      if (seen.has(current)) break;
      seen.add(current);

      const item = byCode.get(current);
      if (!item) break;

      segments.unshift(item.code);
      current = item.parentCode && item.parentCode !== item.code ? item.parentCode : undefined;
    }

    return segments.join(PATH_SEP);
  }

  /** All descendants of `parentCode`, breadth-first, excluding the code itself. */
  static getHierarchicalCodes(parentCode: string): NACECodeEnhanced[] {
    const byCode = this.index();
    if (!byCode.has(parentCode)) return [];

    const children = this.children();
    const out: NACECodeEnhanced[] = [];
    const queue = [...(children.get(parentCode) ?? [])];
    const seen = new Set<string>([parentCode]);

    while (queue.length > 0) {
      const code = queue.shift()!;
      if (seen.has(code)) continue;
      seen.add(code);

      const entry = byCode.get(code);
      if (entry) out.push(entry);
      queue.push(...(children.get(code) ?? []));
    }

    return out;
  }

  /**
   * `parentCode` plus every descendant code.
   *
   * Unknown codes are returned unchanged so a caller filtering on a code that
   * postdates our bundled classification still queries Brreg for it.
   */
  static getAllChildCodes(parentCode: string): string[] {
    if (!this.index().has(parentCode)) return [parentCode];
    return [parentCode, ...this.getHierarchicalCodes(parentCode).map((item) => item.code)];
  }

  /** Case-insensitive substring search across code, names and notes. */
  static searchNACECodes(searchText: string): NACECodeEnhanced[] {
    const needle = searchText.trim().toLowerCase();
    if (!needle) return [];

    return [...this.index().values()].filter(
      (item) =>
        item.code.toLowerCase().includes(needle) ||
        item.name.toLowerCase().includes(needle) ||
        item.shortName.toLowerCase().includes(needle) ||
        item.notes.toLowerCase().includes(needle)
    );
  }

  static getNACEByCode(code: string): NACECodeEnhanced | null {
    return this.index().get(code) ?? null;
  }

  static getAllNACECodes(): NACECodeEnhanced[] {
    return [...this.index().values()];
  }

  /** Items at a level, "1" (section) through "5" (national subclass). */
  static getNACECodesByLevel(level: string): NACECodeEnhanced[] {
    if (!this.byLevel) this.build(this.loadNACEData().classificationItems);
    return this.byLevel!.get(String(level)) ?? [];
  }

  static getTopLevelNACECodes(): NACECodeEnhanced[] {
    return this.getNACECodesByLevel('1');
  }

  /** Classification metadata (name, validity, levels) without the 1800 items. */
  static getClassificationInfo(): Omit<ClassificationVersionResource, 'classificationItems'> & {
    itemCount: number;
  } {
    const { classificationItems, ...rest } = this.loadNACEData();
    return { ...rest, itemCount: classificationItems.length };
  }

  /**
   * Expand filter codes to include their descendants, de-duplicated.
   *
   * @param limit Safety valve — expanding a whole section yields ~600 codes,
   *   which makes for a very long query string. Expansion stops at `limit`.
   */
  static expandIndustryCodes(
    industryCodes: string[],
    limit = 500
  ): { codes: string[]; truncated: boolean } {
    const expanded = new Set<string>();
    let truncated = false;

    for (const code of industryCodes) {
      for (const child of this.getAllChildCodes(code)) {
        if (expanded.size >= limit) {
          truncated = true;
          break;
        }
        expanded.add(child);
      }
      if (truncated) break;
    }

    return { codes: [...expanded], truncated };
  }

  static getDirectChildren(parentCode: string): NACECodeEnhanced[] {
    const byCode = this.index();
    return (this.children().get(parentCode) ?? [])
      .map((code) => byCode.get(code))
      .filter((item): item is NACECodeEnhanced => item !== undefined);
  }

  static getParentCode(code: string): NACECodeEnhanced | null {
    const item = this.getNACEByCode(code);
    if (!item?.parentCode || item.parentCode === code) return null;
    return this.getNACEByCode(item.parentCode);
  }

  /** Test hook: drop the memoised indexes so the next call re-reads from disk. */
  static reset(): void {
    this.naceData = null;
    this.byCode = null;
    this.childrenByParent = null;
    this.byLevel = null;
  }
}
