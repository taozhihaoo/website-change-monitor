import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/utils/hash.js';
import { computeDiff } from '../../src/services/diff-service.js';

describe('sha256Hex', () => {
  it('is deterministic', () => {
    expect(sha256Hex('content')).toBe(sha256Hex('content'));
  });

  it('produces a 64-character hex digest', () => {
    expect(sha256Hex('content')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different content', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
  });

  it('matches the known SHA-256 test vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('computeDiff', () => {
  it('detects additions', () => {
    const diff = computeDiff('line1\nline2', 'line1\nline2\nline3');
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(0);
    expect(diff.changes).toEqual([{ type: 'added', value: 'line3', count: 1 }]);
  });

  it('detects removals', () => {
    const diff = computeDiff('price $99\nstock yes', 'price $89\nstock yes');
    expect(diff.removed).toBe(1);
    expect(diff.added).toBe(1);
    const removed = diff.changes.find((change) => change.type === 'removed');
    expect(removed?.value).toContain('$99');
    const added = diff.changes.find((change) => change.type === 'added');
    expect(added?.value).toContain('$89');
  });

  it('returns empty changes for identical content', () => {
    const diff = computeDiff('same', 'same');
    expect(diff).toEqual({ added: 0, removed: 0, changes: [] });
  });

  it('is suitable for UI rendering (block-level entries)', () => {
    const diff = computeDiff('a\nb\nc', 'a\nx\nc');
    expect(diff.changes.length).toBeGreaterThanOrEqual(2);
    for (const change of diff.changes) {
      expect(['added', 'removed']).toContain(change.type);
      expect(typeof change.value).toBe('string');
      expect(change.count).toBeGreaterThan(0);
    }
  });
});
