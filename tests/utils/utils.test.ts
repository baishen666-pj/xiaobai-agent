import { describe, it, expect } from 'vitest';
import { truncate, hashContent, formatBytes } from '../../src/utils/index.js';

describe('Utils', () => {
  describe('truncate', () => {
    it('returns short string unchanged', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('truncates long strings with ellipsis', () => {
      expect(truncate('hello world this is long', 14)).toBe('hello world...');
    });

    it('handles exact length', () => {
      expect(truncate('12345', 5)).toBe('12345');
    });

    it('handles length of 3 (just ellipsis)', () => {
      expect(truncate('abc', 3)).toBe('abc');
    });
  });

  describe('hashContent', () => {
    it('returns a 16-char hex string', () => {
      const hash = hashContent('test content');
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('produces consistent hashes', () => {
      expect(hashContent('same input')).toBe(hashContent('same input'));
    });

    it('produces different hashes for different input', () => {
      expect(hashContent('input a')).not.toBe(hashContent('input b'));
    });
  });

  describe('formatBytes', () => {
    it('formats 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('formats bytes', () => {
      expect(formatBytes(512)).toBe('512.0 B');
    });

    it('formats kilobytes', () => {
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('formats megabytes', () => {
      expect(formatBytes(1048576)).toBe('1.0 MB');
    });

    it('formats gigabytes', () => {
      expect(formatBytes(1073741824)).toBe('1.0 GB');
    });
  });
});
