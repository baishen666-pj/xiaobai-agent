import { describe, it, expect } from 'vitest';
import { normalizeContent, extractText } from '../../src/types/content-types.js';

describe('normalizeContent', () => {
  it('converts string to ContentPart array', () => {
    const result = normalizeContent('hello');
    expect(result).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('returns ContentPart array as-is', () => {
    const parts = [{ type: 'text' as const, text: 'hello' }, { type: 'text' as const, text: ' world' }];
    expect(normalizeContent(parts)).toBe(parts);
  });

  it('handles empty string', () => {
    expect(normalizeContent('')).toEqual([{ type: 'text', text: '' }]);
  });
});

describe('extractText', () => {
  it('returns string directly', () => {
    expect(extractText('hello world')).toBe('hello world');
  });

  it('extracts text from ContentPart array', () => {
    const parts = [
      { type: 'text' as const, text: 'hello ' },
      { type: 'image' as const, data: 'base64data', mimeType: 'image/png', source: 'base64' as const },
      { type: 'text' as const, text: 'world' },
    ];
    expect(extractText(parts)).toBe('hello world');
  });

  it('returns empty string for non-text parts only', () => {
    const parts = [
      { type: 'image' as const, data: 'data', mimeType: 'image/png', source: 'base64' as const },
    ];
    expect(extractText(parts)).toBe('');
  });

  it('handles empty array', () => {
    expect(extractText([])).toBe('');
  });
});
