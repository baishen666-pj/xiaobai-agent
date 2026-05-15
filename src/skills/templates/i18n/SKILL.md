---
name: i18n
description: Internationalization audit and string extraction with locale strategy and ICU message format
category: coding
version: 1.0.0
author: xiaobai
---

# Internationalization (i18n)

Audit code for hardcoded strings and plan internationalization.

## Audit Process

1. **Scan**: Find all hardcoded user-facing strings
2. **Classify**: Categorize strings (UI text, error messages, dates, numbers)
3. **Extract**: Replace with i18n function calls using message keys
4. **Organize**: Structure locale files by feature or page
5. **Verify**: Ensure extracted strings render correctly

## String Extraction Rules

### What to Extract
- UI labels, buttons, headings, tooltips
- Error and validation messages
- Date, time, number format patterns
- Page titles and meta descriptions
- Email and notification templates

### What NOT to Extract
- CSS class names, HTML attribute names
- API endpoint paths
- Log messages (developer-facing)
- Test descriptions
- Code comments

## Message Format (ICU)

```
// Simple
{ "welcome": "Welcome, {name}!" }

// Plural
{ "items": "{count, plural, one{# item} other{# items}}" }

// Select
{ "role": "{level, select, admin{Administrator} user{Standard User} guest{Guest}}" }

// Date/Time/Number — use locale-aware formatters
```

## Locale File Structure

```
locales/
├── en/
│   ├── common.json
│   ├── auth.json
│   └── dashboard.json
├── zh-CN/
│   ├── common.json
│   ├── auth.json
│   └── dashboard.json
└── ja/
    └── ...
```

## Checklist

- [ ] No hardcoded strings in JSX/templates
- [ ] All dates use locale-aware formatting
- [ ] All numbers use locale-aware formatting
- [ ] Text layout handles varying string lengths (RTL, CJK)
- [ ] Plural rules handled per locale
- [ ] Missing translations have fallback behavior
- [ ] Locale detection from browser/accept-language header

## Variables

- `{{target}}` — The codebase or files to audit
- `{{locales}}` — Target locales (e.g., en, zh-CN, ja, de)
- `{{framework}}` — i18n library to use (react-intl, i18next, vue-i18n, etc.)
