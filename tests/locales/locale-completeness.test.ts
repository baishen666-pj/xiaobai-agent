import { describe, it, expect } from 'vitest';
import { en } from '../../src/locales/en.js';
import { zhCN } from '../../src/locales/zh-CN.js';

describe('Locale Completeness', () => {
  it('zh-CN has all keys from en', () => {
    const enKeys = Object.keys(en);
    const zhKeys = Object.keys(zhCN);
    const missing = enKeys.filter(k => !(k in zhCN));
    expect(missing).toEqual([]);
  });

  it('no keys have empty values in zh-CN', () => {
    for (const [key, value] of Object.entries(zhCN)) {
      expect(value.length, `Key "${key}" has empty value`).toBeGreaterThan(0);
    }
  });

  it('en has no empty values', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.length, `Key "${key}" has empty value`).toBeGreaterThan(0);
    }
  });

  it('zh-CN has no extra keys not in en', () => {
    const enKeys = new Set(Object.keys(en));
    const extra = Object.keys(zhCN).filter(k => !enKeys.has(k));
    expect(extra).toEqual([]);
  });
});
