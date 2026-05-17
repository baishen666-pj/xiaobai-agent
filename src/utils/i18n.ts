type LocaleMessages = Record<string, string>;

class I18n {
  private locales = new Map<string, LocaleMessages>();
  private currentLocale = 'en';

  registerLocale(locale: string, messages: LocaleMessages): void {
    this.locales.set(locale, messages);
  }

  setLocale(locale: string): void {
    if (this.locales.has(locale)) {
      this.currentLocale = locale;
    }
  }

  getLocale(): string {
    return this.currentLocale;
  }

  t(key: string, params?: Record<string, string | number>): string {
    const messages = this.locales.get(this.currentLocale);
    let value = messages?.[key];

    if (!value) {
      const fallback = this.locales.get('en');
      value = fallback?.[key];
    }

    if (!value) return key;

    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replace(new RegExp(`\\$\\{${k}\\}`, 'g'), String(v));
      }
    }

    return value;
  }

  detectSystemLocale(): string {
    const env = process.env.LC_ALL ?? process.env.LANG ?? process.env.LC_MESSAGES ?? '';
    const match = env.match(/^([a-z]{2}(?:-[A-Z]{2})?)/);
    if (match) {
      const detected = match[1];
      if (this.locales.has(detected)) return detected;
      const lang = detected.split('-')[0];
      for (const locale of this.locales.keys()) {
        if (locale.startsWith(lang)) return locale;
      }
    }
    return 'en';
  }

  getAvailableLocales(): string[] {
    return Array.from(this.locales.keys());
  }
}

export const i18n = new I18n();
export const t = i18n.t.bind(i18n);
