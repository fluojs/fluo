import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { I18nError, createI18n } from './index.js';
import { IcuI18nService, createIcuI18n } from './icu.js';
import type { I18nIcuValues } from './icu.js';

function expectI18nCode(action: () => unknown, code: I18nError['code']): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(I18nError);
    expect((error as I18nError).code).toBe(code);
    return;
  }

  throw new Error(`Expected action to fail with ${code}.`);
}

function readPackageExports(): unknown {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
}

function hasIcuSubpathExport(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, 'exports')) {
    return false;
  }

  const packageJson = value as { readonly exports?: unknown };
  const exportsField = packageJson.exports;

  return typeof exportsField === 'object' && exportsField !== null && Object.hasOwn(exportsField, './icu');
}

describe('@fluojs/i18n/icu MessageFormat subpath', () => {
  it('keeps ICU exports on the dedicated subpath without expanding root runtime exports', async () => {
    const root = await import('./index.js');
    const icu = await import('./icu.js');

    expect(Object.keys(root).sort()).toEqual(['I18nError', 'I18nModule', 'I18nService', 'createI18n']);
    expect(Object.keys(icu).sort()).toEqual(['IcuI18nService', 'createIcuI18n']);
    expect(hasIcuSubpathExport(readPackageExports())).toBe(true);
  });

  it('formats ICU plural messages and preserves core simple interpolation before formatting', () => {
    const service = createIcuI18n({
      catalogs: {
        en: {
          inbox: 'Hello {{ name }}. {count, plural, =0 {No messages} one {One message} other {# messages}}.',
        },
      },
      defaultLocale: 'en',
      supportedLocales: ['en'],
    });

    expect(service.translate('inbox', { locale: 'en', values: { count: 0, name: 'Mina' } })).toBe('Hello Mina. No messages.');
    expect(service.translate('inbox', { locale: 'en', values: { count: 1, name: 'Mina' } })).toBe('Hello Mina. One message.');
    expect(service.translate('inbox', { locale: 'en', values: { count: 5, name: 'Mina' } })).toBe('Hello Mina. 5 messages.');
  });

  it('formats select messages with nested plural branches and nested placeholders', () => {
    const service = createIcuI18n({
      catalogs: {
        en: {
          invite:
            '{gender, select, female {{host} invited {count, plural, one {one guest} other {# guests}}} male {{host} invited {count, plural, one {one guest} other {# guests}}} other {{host} invited {count, plural, one {one guest} other {# guests}}}}',
        },
      },
      defaultLocale: 'en',
      supportedLocales: ['en'],
    });

    expect(service.translate('invite', { locale: 'en', values: { count: 2, gender: 'female', host: 'Sara' } })).toBe(
      'Sara invited 2 guests',
    );
    expect(service.translate('invite', { locale: 'en', values: { count: 1, gender: 'other', host: 'Alex' } })).toBe(
      'Alex invited one guest',
    );
  });

  it('uses core fallback and default-value behavior before ICU formatting', () => {
    const service = createIcuI18n({
      catalogs: {
        en: {
          cart: '{count, plural, one {One item} other {# items}} in {place}',
        },
        ko: {},
      },
      defaultLocale: 'en',
      fallbackLocales: { ko: ['en'] },
      supportedLocales: ['en', 'ko'],
    });

    expect(service.translate('cart', { locale: 'ko', values: { count: 3, place: 'cart' } })).toBe('3 items in cart');
    expect(
      service.translate('missing', {
        defaultValue: '{count, plural, one {One fallback item} other {# fallback items}}',
        locale: 'ko',
        values: { count: 2 },
      }),
    ).toBe('2 fallback items');
  });

  it('formats fallback catalog messages with the locale that supplied the message', () => {
    const service = createIcuI18n({
      catalogs: {
        en: {
          ordinal: '{count, selectordinal, one {#st result} other {#th results}}',
        },
        ko: {},
      },
      defaultLocale: 'en',
      fallbackLocales: { ko: ['en'] },
      supportedLocales: ['en', 'ko'],
    });

    expect(service.translate('ordinal', { locale: 'ko', values: { count: 1 } })).toBe('1st result');
  });

  it('wraps invalid ICU patterns and missing ICU values with stable i18n errors', () => {
    const service = createIcuI18n({
      catalogs: {
        en: {
          invalid: '{count, plural, one {One item}}',
          missingValue: '{count, plural, one {One item} other {# items}}',
        },
      },
      defaultLocale: 'en',
      supportedLocales: ['en'],
    });

    expectI18nCode(() => service.translate('invalid', { locale: 'en', values: { count: 1 } }), 'I18N_INVALID_MESSAGE_FORMAT');
    expectI18nCode(() => service.translate('missingValue', { locale: 'en' }), 'I18N_INVALID_MESSAGE_FORMAT');
  });

  it('rejects non-string rich formatting results with the stable invalid format code', () => {
    const service = createIcuI18n({
      catalogs: {
        en: {
          rich: 'Click <link>here</link>',
        },
      },
      defaultLocale: 'en',
      supportedLocales: ['en'],
    });
    const richValues = {
      link: (chunks: readonly string[]) => ({ chunks }),
    } as unknown as I18nIcuValues;

    expectI18nCode(() => service.translate('rich', { locale: 'en', values: richValues }), 'I18N_INVALID_MESSAGE_FORMAT');
  });

  it('can wrap an existing core service without changing core translation behavior', () => {
    const core = createI18n({
      catalogs: {
        en: {
          simple: 'Hello {{ name }}',
        },
      },
      defaultLocale: 'en',
      supportedLocales: ['en'],
    });
    const icu = new IcuI18nService(core);

    expect(core.translate('simple', { locale: 'en', values: { name: 'fluo' } })).toBe('Hello fluo');
    expect(icu.getCoreService()).toBe(core);
    expect(icu.translate('simple', { locale: 'en', values: { name: 'fluo' } })).toBe('Hello fluo');
  });
});
