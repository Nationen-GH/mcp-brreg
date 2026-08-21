import { describe, expect, test } from 'bun:test';
import { NACEUtils } from '../src/nace-utils.js';

describe('NACEUtils', () => {
  test('loads the bundled classification without depending on cwd', () => {
    const info = NACEUtils.getClassificationInfo();
    expect(info.itemCount).toBeGreaterThan(1000);
    expect(info.levels.length).toBe(5);
    // The whole point of the module-relative lookup: no `classificationItems`
    // key should survive into the metadata payload.
    expect(info).not.toHaveProperty('classificationItems');
  });

  test('exposes the 22 top-level sections', () => {
    const sections = NACEUtils.getTopLevelNACECodes();
    expect(sections.length).toBe(22);
    expect(sections.map((s) => s.code)).toContain('A');
    expect(sections.every((s) => s.level === '1')).toBe(true);
  });

  test('builds an ancestor path for a deep code', () => {
    const entry = NACEUtils.getNACEByCode('01.110');
    expect(entry).not.toBeNull();
    expect(entry!.fullCodePath).toBe('A / 01 / 01.1 / 01.11 / 01.110');
  });

  test('every code resolves to a path rooted at its section', () => {
    for (const item of NACEUtils.getAllNACECodes()) {
      expect(item.fullCodePath.split(' / ')[0]).toMatch(/^[A-Z]$/);
      expect(item.fullCodePath.endsWith(item.code)).toBe(true);
    }
  });

  test('getHierarchicalCodes returns true descendants only', () => {
    const descendants = NACEUtils.getHierarchicalCodes('01.1');
    const codes = descendants.map((d) => d.code);

    expect(codes).toContain('01.11');
    expect(codes).toContain('01.110');
    expect(codes).not.toContain('01.1'); // excludes the parent itself
    expect(codes).not.toContain('01.2'); // excludes siblings

    // Descendant-by-ancestry, never by string prefix.
    for (const item of descendants) {
      expect(item.fullCodePath.startsWith('A / 01 / 01.1 / ')).toBe(true);
    }
  });

  test('getAllChildCodes includes the parent and passes unknown codes through', () => {
    const children = NACEUtils.getAllChildCodes('01.1');
    expect(children[0]).toBe('01.1');
    expect(children.length).toBeGreaterThan(1);
    expect(new Set(children).size).toBe(children.length);

    // A code from a newer classification must still reach the API unchanged.
    expect(NACEUtils.getAllChildCodes('99.999')).toEqual(['99.999']);
  });

  test('getDirectChildren returns only immediate children', () => {
    const direct = NACEUtils.getDirectChildren('01.1').map((c) => c.code);
    expect(direct).toContain('01.11');
    expect(direct).not.toContain('01.110'); // a grandchild
  });

  test('getParentCode walks one level up and stops at a section', () => {
    expect(NACEUtils.getParentCode('01.110')?.code).toBe('01.11');
    expect(NACEUtils.getParentCode('A')).toBeNull();
  });

  test('search matches code, name and notes case-insensitively', () => {
    const hits = NACEUtils.searchNACECodes('JORDBRUK');
    expect(hits.length).toBeGreaterThan(0);

    const byCode = NACEUtils.searchNACECodes('01.110');
    expect(byCode.some((h) => h.code === '01.110')).toBe(true);

    expect(NACEUtils.searchNACECodes('   ')).toEqual([]);
  });

  test('getNACECodesByLevel partitions the classification exactly once', () => {
    const total = NACEUtils.getAllNACECodes().length;
    const summed = ['1', '2', '3', '4', '5']
      .map((level) => NACEUtils.getNACECodesByLevel(level).length)
      .reduce((a, b) => a + b, 0);
    expect(summed).toBe(total);
    expect(NACEUtils.getNACECodesByLevel('9')).toEqual([]);
  });

  test('expandIndustryCodes de-duplicates overlapping inputs', () => {
    const { codes, truncated } = NACEUtils.expandIndustryCodes(['01.1', '01.11']);
    expect(truncated).toBe(false);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('01.11');
  });

  test('expandIndustryCodes stops at the limit and reports truncation', () => {
    const { codes, truncated } = NACEUtils.expandIndustryCodes(['C'], 10);
    expect(codes.length).toBe(10);
    expect(truncated).toBe(true);
  });
});
