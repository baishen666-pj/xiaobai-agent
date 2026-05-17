import { describe, it, expect, beforeEach } from 'vitest';
import { i18n, t } from '../../src/utils/i18n.js';
import { en } from '../../src/locales/en.js';
import { zhCN } from '../../src/locales/zh-CN.js';

beforeEach(() => {
  i18n.registerLocale('en', en);
  i18n.registerLocale('zh-CN', zhCN);
  i18n.setLocale('en');
});

describe('I18n', () => {
  it('returns English string by default', () => {
    expect(t('cli.plugins.not_enabled')).toBe('Plugins system not enabled.');
  });

  it('returns Chinese when locale is zh-CN', () => {
    i18n.setLocale('zh-CN');
    expect(t('cli.plugins.not_enabled')).toBe('插件系统未启用。');
  });

  it('interpolates parameters', () => {
    expect(t('cli.plugins.installed', { count: 5 })).toBe('Installed Plugins (5)');
  });

  it('interpolates parameters in Chinese', () => {
    i18n.setLocale('zh-CN');
    expect(t('cli.plugins.installed', { count: 3 })).toBe('已安装插件 (3)');
  });

  it('falls back to English for missing Chinese key', () => {
    i18n.registerLocale('en', { 'test.only.english': 'English only' });
    i18n.registerLocale('zh-CN', {});
    i18n.setLocale('zh-CN');
    expect(t('test.only.english')).toBe('English only');
  });

  it('returns key when not found in any locale', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('lists available locales', () => {
    const locales = i18n.getAvailableLocales();
    expect(locales).toContain('en');
    expect(locales).toContain('zh-CN');
  });

  it('switches locale back to English', () => {
    i18n.setLocale('zh-CN');
    expect(i18n.getLocale()).toBe('zh-CN');
    i18n.setLocale('en');
    expect(i18n.getLocale()).toBe('en');
  });

  it('does not switch to unknown locale', () => {
    i18n.setLocale('en');
    i18n.setLocale('fr');
    expect(i18n.getLocale()).toBe('en');
  });

  it('detects system locale from env', () => {
    process.env.LANG = 'zh_CN.UTF-8';
    const detected = i18n.detectSystemLocale();
    expect(detected).toBe('zh-CN');
    delete process.env.LANG;
  });

  it('defaults to en when no locale env', () => {
    delete process.env.LC_ALL;
    delete process.env.LANG;
    delete process.env.LC_MESSAGES;
    expect(i18n.detectSystemLocale()).toBe('en');
  });
});
