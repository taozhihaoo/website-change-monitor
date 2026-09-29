import { describe, expect, it } from 'vitest';
import { normalizeContent } from '../../src/utils/normalize.js';
import { sha256Hex } from '../../src/utils/hash.js';

describe('normalizeContent', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeContent('  hello world  ')).toBe('hello world');
  });

  it('normalizes CRLF and CR line endings to LF', () => {
    expect(normalizeContent('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('collapses repeated whitespace inside lines', () => {
    expect(normalizeContent('a    b\t\tc   d')).toBe('a b c d');
  });

  it('drops empty lines produced by layout changes', () => {
    expect(normalizeContent('price\n\n\n$99\n\n')).toBe('price\n$99');
  });

  it('produces identical hashes for semantically identical content', () => {
    const rawA = '<div>\r\n   Product Price:\t\t$99   \r\n\r\n   In stock\r\n</div>';
    const rawB = '<div>\nProduct Price: $99\n\nIn stock\n</div>';
    expect(sha256Hex(normalizeContent(rawA))).toBe(sha256Hex(normalizeContent(rawB)));
  });

  it('keeps genuinely different content different', () => {
    expect(normalizeContent('$99')).not.toBe(normalizeContent('$89'));
  });

  it('returns an empty string for whitespace-only content', () => {
    expect(normalizeContent('   \n\t\r\n  ')).toBe('');
  });
});
