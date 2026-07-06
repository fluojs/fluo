import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { Inject, Module, getModuleMetadata } from '@fluojs/core';
import { createTestingModule } from '@fluojs/testing';

import { I18nError, I18nModule, createI18n } from './index.js';
import { I18nService } from './service.js';
import type {
  I18nErrorCode,
  I18nLocale,
  I18nMessageCatalogs,
  I18nModuleOptions,
  I18nTranslateOptions,
  I18nTranslationKey,
} from './index.js';

function expectI18nCode(action: () => unknown, code: I18nErrorCode): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(I18nError);
    expect((error as I18nError).code).toBe(code);
    return;
  }

  throw new Error(`Expected action to fail with ${code}.`);
}

function readPackageJson(): {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly engines?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
} {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
}

describe('@fluojs/i18n root public surface', () => {
  it('keeps the root value exports intentionally small', async () => {
    const root = await import('./index.js');

    expect(Object.keys(root).sort()).toEqual(['I18nError', 'I18nModule', 'I18nService', 'createI18n']);
  });

  it('keeps root package metadata free of optional peer and Node engine requirements', () => {
    const packageJson = readPackageJson();

    expect(packageJson.engines?.node).toBeUndefined();
    expect(packageJson.dependencies).toEqual({ '@fluojs/core': 'workspace:^' });
    expect(packageJson.peerDependencies).toEqual({
      '@fluojs/http': 'workspace:^',
      '@fluojs/validation': 'workspace:^',
      'intl-messageformat': '^11.2.4',
    });
    expect(packageJson.peerDependenciesMeta).toEqual({
      '@fluojs/http': { optional: true },
      '@fluojs/validation': { optional: true },
      'intl-messageformat': { optional: true },
    });
  });

  it('exposes the module, service, factory, and stable error surface', () => {
    const options: I18nModuleOptions = {
      catalogs: {
        en: { app: { title: 'Fluo' } },
      },
      defaultLocale: 'en' satisfies I18nLocale,
      supportedLocales: ['en', 'ko'],
    };
    const key: I18nTranslationKey = 'app.title';
    const code: I18nErrorCode = 'I18N_ERROR';
    const service = createI18n(options);
    const snapshot = service.snapshotOptions();

    expect(key).toBe('app.title');
    expect(snapshot).toEqual(options);
    expect(snapshot.supportedLocales).not.toBe(options.supportedLocales);
    expect(I18nModule.forRoot(options)).toBeInstanceOf(Function);
    expect(new I18nError('reserved i18n failure', code).code).toBe('I18N_ERROR');
  });

  it('resolves I18nModule.forRoot providers through a compiled testing module graph', async () => {
    @Module({
      imports: [
        I18nModule.forRoot({
          catalogs: {
            en: { app: { title: 'Hello {{ name }}' } },
            ko: { app: { title: '안녕하세요 {{ name }}' } },
          },
          defaultLocale: 'en',
          fallbackLocales: { ko: ['en'] },
          supportedLocales: ['en', 'ko'],
        }),
      ],
    })
    class AppModule {}

    const testingModule = await createTestingModule({ rootModule: AppModule }).compile();
    const service = await testingModule.resolve<I18nService>(I18nService);

    expect(service.translate('app.title', { locale: 'ko', values: { name: 'fluo' } })).toBe('안녕하세요 fluo');
    expect(service.resolveLocales('ko')).toEqual(['ko', 'en']);
    expect(testingModule.get(I18nService)).toBe(service);
  });

  it('exposes I18nModule providers globally by default and honors global false opt-out', async () => {
    @Inject(I18nService)
    class SiblingConsumer {
      constructor(readonly i18n: I18nService) {}

      title(): string {
        return this.i18n.translate('app.title', { locale: 'en' });
      }
    }

    @Module({ providers: [SiblingConsumer] })
    class SiblingModule {}

    @Module({
      imports: [I18nModule.forRoot({ catalogs: { en: { app: { title: 'Global i18n' } } }, defaultLocale: 'en' }), SiblingModule],
    })
    class DefaultGlobalAppModule {}

    const testingModule = await createTestingModule({ rootModule: DefaultGlobalAppModule }).compile();

    try {
      expect(getModuleMetadata(I18nModule.forRoot())).toMatchObject({ global: true });
      expect(getModuleMetadata(I18nModule.forRoot({ global: false }))).toMatchObject({ global: false });
      expect((await testingModule.resolve(SiblingConsumer)).title()).toBe('Global i18n');
    } finally {
      await testingModule.container.dispose();
    }

    @Module({
      imports: [I18nModule.forRoot({ catalogs: { en: { app: { title: 'Local i18n' } } }, defaultLocale: 'en', global: false }), SiblingModule],
    })
    class LocalAppModule {}

    await expect(createTestingModule({ rootModule: LocalAppModule }).compile()).rejects.toThrow(/not visible through a global module|I18nService/);
  });

  it('resolves nested keys and namespace-prefixed keys with explicit locales', () => {
    const service = createI18n({
      catalogs: {
        en: {
          app: {
            title: 'Hello {{ name }}',
          },
          common: {
            action: {
              save: 'Save',
            },
          },
        },
      },
      defaultLocale: 'en',
    });

    expect(service.translate('app.title', { locale: 'en', values: { name: 'fluo' } })).toBe('Hello fluo');
    expect(service.translate('action.save', { locale: 'en', namespace: 'common' })).toBe('Save');
  });

  it('uses deterministic fallback order before default values and missing-message hooks', () => {
    const service = createI18n({
      catalogs: {
        en: { greeting: 'Hello {{ name }}' },
        fr: { greeting: 'Bonjour {{ name }}' },
        ko: { other: '다른 문장' },
      },
      defaultLocale: 'en',
      fallbackLocales: {
        ko: ['fr', 'en'],
      },
      missingMessage: ({ attemptedLocales, key }) => `${key}:${attemptedLocales.join('>')}`,
      supportedLocales: ['en', 'fr', 'ko'],
    });

    expect(service.resolveLocales('ko')).toEqual(['ko', 'fr', 'en']);
    expect(service.translate('greeting', { locale: 'ko', values: { name: 'Jinho' } })).toBe('Bonjour Jinho');
    expect(service.translate('missing', { defaultValue: 'Default {{ name }}', locale: 'ko', values: { name: 'Jinho' } })).toBe(
      'Default Jinho',
    );
    expect(service.translate('missing', { locale: 'ko' })).toBe('missing:ko>fr>en');
  });

  it('uses global fallback arrays before default values and missing-message hooks', () => {
    const service = createI18n({
      catalogs: {
        en: { greeting: 'Hello from fallback' },
        ko: { other: '다른 문장' },
      },
      defaultLocale: 'ko',
      fallbackLocales: ['en'],
      missingMessage: ({ key }) => `missing:${key}`,
      supportedLocales: ['en', 'ko'],
    });

    expect(service.resolveLocales('ko')).toEqual(['ko', 'en']);
    expect(service.translate('greeting', { defaultValue: 'Default', locale: 'ko' })).toBe('Hello from fallback');
    expect(service.translate('unknown', { defaultValue: 'Default', locale: 'ko' })).toBe('Default');
    expect(service.translate('stillMissing', { locale: 'ko' })).toBe('missing:stillMissing');
  });

  it('locks interpolation edge cases for primitive, nullish, and absent values', () => {
    const service = createI18n({
      catalogs: {
        en: {
          message: 'zero={{ zero }} false={{ enabled }} null={{ empty }} undefined={{ missing }} absent={{ absent }}',
        },
      },
      defaultLocale: 'en',
      supportedLocales: ['en'],
    });

    expect(
      service.translate('message', {
        locale: 'en',
        values: { empty: null, enabled: false, missing: undefined, zero: 0 },
      }),
    ).toBe('zero=0 false=false null= undefined= absent={{ absent }}');
  });

  it('snapshots caller-owned catalog, fallback, and supported-locale inputs', () => {
    const catalogs = {
      en: { greeting: 'Hello' },
      ko: { greeting: '안녕하세요' },
    } satisfies I18nMessageCatalogs;
    const supportedLocales = ['en', 'ko'];
    const fallbackLocales = ['en'];
    const service = createI18n({ catalogs, defaultLocale: 'en', fallbackLocales, supportedLocales });

    catalogs.en.greeting = 'Changed';
    supportedLocales.push('fr');
    fallbackLocales[0] = 'ko';

    expect(service.translate('greeting', { locale: 'en' })).toBe('Hello');
    expect(service.resolveLocales('ko')).toEqual(['ko', 'en']);
    expect(service.snapshotOptions().supportedLocales).toEqual(['en', 'ko']);
  });

  it('fails with stable errors for invalid catalogs, locale config, and translation options', () => {
    const invalidCatalogs = {
      en: {
        count: 1,
      },
    } as unknown as I18nMessageCatalogs;

    expectI18nCode(() => createI18n({ catalogs: invalidCatalogs, defaultLocale: 'en' }), 'I18N_INVALID_CATALOG');
    expectI18nCode(() => createI18n({ defaultLocale: 'en', supportedLocales: ['ko'] }), 'I18N_INVALID_LOCALE_CONFIG');
    expectI18nCode(
      () => createI18n({ defaultLocale: 'en', fallbackLocales: { ko: ['fr'] }, supportedLocales: ['en', 'ko'] }),
      'I18N_INVALID_LOCALE_CONFIG',
    );
    expectI18nCode(
      () => createI18n({ catalogs: { fr: { greeting: 'Bonjour' } }, defaultLocale: 'en', supportedLocales: ['en'] }),
      'I18N_INVALID_LOCALE_CONFIG',
    );
    expectI18nCode(() => createI18n({ catalogs: { en: { greeting: 'Hello' } } }), 'I18N_INVALID_OPTIONS');
    expectI18nCode(() => createI18n(null as unknown as I18nModuleOptions), 'I18N_INVALID_OPTIONS');
    expectI18nCode(
      () => createI18n({ defaultLocale: 'en', missingMessage: 'missing' } as unknown as I18nModuleOptions),
      'I18N_INVALID_OPTIONS',
    );

    const service = createI18n({
      catalogs: { en: { greeting: 'Hello' } },
      defaultLocale: 'en',
      supportedLocales: ['en'],
    });

    expectI18nCode(() => service.translate('', { locale: 'en' }), 'I18N_INVALID_OPTIONS');
    expectI18nCode(() => service.translate('greeting', { locale: 'ko' }), 'I18N_INVALID_OPTIONS');
    expectI18nCode(
      () => service.translate('greeting', { locale: 'en', values: [] } as unknown as I18nTranslateOptions),
      'I18N_INVALID_OPTIONS',
    );
    expectI18nCode(
      () => service.translate('greeting', { locale: 'en', values: new Date() } as unknown as I18nTranslateOptions),
      'I18N_INVALID_OPTIONS',
    );
    expectI18nCode(
      () => service.translate('greeting', { defaultValue: 1, locale: 'en' } as unknown as I18nTranslateOptions),
      'I18N_INVALID_OPTIONS',
    );
    expectI18nCode(() => service.translate('missing', { locale: 'en' }), 'I18N_MISSING_MESSAGE');
  });

  it('formats date/time, numbers, currency, percent, lists, and relative time through standard Intl APIs', () => {
    const service = createI18n({
      defaultLocale: 'en-US',
      formats: {
        dateTime: {
          short: { dateStyle: 'medium', timeZone: 'UTC' },
        },
        list: {
          conjunction: { style: 'long', type: 'conjunction' },
        },
        number: {
          precise: { maximumFractionDigits: 2, minimumFractionDigits: 2 },
        },
        relativeTime: {
          narrow: { numeric: 'auto', style: 'narrow' },
        },
      },
      supportedLocales: ['en-US', 'de-DE', 'ko-KR'],
    });

    const date = new Date('2026-05-11T00:00:00.000Z');

    expect(service.formatDateTime(date, { format: 'short', locale: 'en-US' })).toBe(
      new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date),
    );
    expect(service.formatNumber(1234.5, { format: 'precise', locale: 'de-DE' })).toBe(
      new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(1234.5),
    );
    expect(service.formatCurrency(12.5, { currency: 'EUR', locale: 'de-DE' })).toBe(
      new Intl.NumberFormat('de-DE', { currency: 'EUR', style: 'currency' }).format(12.5),
    );
    expect(service.formatPercent(0.125, { locale: 'en-US', options: { maximumFractionDigits: 1 } })).toBe(
      new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, style: 'percent' }).format(0.125),
    );
    expect(service.formatList(['red', 'green', 'blue'], { format: 'conjunction', locale: 'en-US' })).toBe(
      new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format(['red', 'green', 'blue']),
    );
    expect(service.formatRelativeTime(-1, 'day', { format: 'narrow', locale: 'en-US' })).toBe(
      new Intl.RelativeTimeFormat('en-US', { numeric: 'auto', style: 'narrow' }).format(-1, 'day'),
    );
  });

  it('normalizes named format options into immutable service-owned snapshots', () => {
    const formats = {
      number: {
        score: { maximumFractionDigits: 1 },
      },
    } satisfies NonNullable<I18nModuleOptions['formats']>;
    const service = createI18n({ defaultLocale: 'en', formats, supportedLocales: ['en'] });

    formats.number.score.maximumFractionDigits = 4;

    expect(service.formatNumber(1.25, { format: 'score', locale: 'en' })).toBe('1.3');
    expect(service.formatNumber(1.25, { format: 'score', locale: 'en', options: { maximumFractionDigits: 2 } })).toBe('1.25');
    expect(service.snapshotOptions().formats?.number?.score).toEqual({ maximumFractionDigits: 1 });
  });

  it('fails with stable errors for missing and invalid named Intl formats', () => {
    expectI18nCode(
      () => createI18n({ defaultLocale: 'en', formats: { number: { '': { maximumFractionDigits: 1 } } } }),
      'I18N_INVALID_OPTIONS',
    );
    expectI18nCode(
      () => createI18n({ defaultLocale: 'en', formats: { dateTime: { short: [] as unknown as Intl.DateTimeFormatOptions } } }),
      'I18N_INVALID_OPTIONS',
    );

    const service = createI18n({ defaultLocale: 'en', formats: { number: { whole: { maximumFractionDigits: 0 } } } });

    expectI18nCode(() => service.formatNumber(1, { format: 'missing', locale: 'en' }), 'I18N_INVALID_OPTIONS');
    expectI18nCode(
      () =>
        service.formatDateTime(new Date('2026-05-11T00:00:00.000Z'), {
          locale: 'en',
          options: [] as unknown as Intl.DateTimeFormatOptions,
        }),
      'I18N_INVALID_OPTIONS',
    );
    expectI18nCode(() => service.formatCurrency(1, { currency: '', locale: 'en' }), 'I18N_INVALID_OPTIONS');
    expectI18nCode(() => service.formatList([1] as unknown as string[], { locale: 'en' }), 'I18N_INVALID_OPTIONS');
  });

  it('wraps invalid inline Intl option values with stable i18n errors', () => {
    const service = createI18n({ defaultLocale: 'en', supportedLocales: ['en'] });

    expectI18nCode(
      () =>
        service.formatDateTime(new Date('2026-05-11T00:00:00.000Z'), {
          locale: 'en',
          options: { dateStyle: 'invalid' as unknown as Intl.DateTimeFormatOptions['dateStyle'] },
        }),
      'I18N_INVALID_OPTIONS',
    );
    expectI18nCode(
      () =>
        service.formatNumber(1, {
          locale: 'en',
          options: { style: 'invalid' as unknown as Intl.NumberFormatOptions['style'] },
        }),
      'I18N_INVALID_OPTIONS',
    );
    expectI18nCode(() => service.formatCurrency(1, { currency: 'INVALID', locale: 'en' }), 'I18N_INVALID_OPTIONS');
    expectI18nCode(
      () => service.formatPercent(0.1, { locale: 'en', options: { maximumFractionDigits: -1 } }),
      'I18N_INVALID_OPTIONS',
    );
    expectI18nCode(
      () =>
        service.formatList(['red', 'green'], {
          locale: 'en',
          options: { type: 'invalid' as unknown as Intl.ListFormatOptions['type'] },
        }),
      'I18N_INVALID_OPTIONS',
    );
    expectI18nCode(
      () =>
        service.formatRelativeTime(-1, 'day', {
          locale: 'en',
          options: { numeric: 'sometimes' as unknown as Intl.RelativeTimeFormatOptions['numeric'] },
        }),
      'I18N_INVALID_OPTIONS',
    );
  });

  it('wraps invalid named Intl option values with stable i18n errors at use time', () => {
    const service = createI18n({
      defaultLocale: 'en',
      formats: {
        dateTime: {
          invalid: { timeZone: 'Not/A_Zone' },
        },
        list: {
          invalid: { style: 'invalid' as unknown as Intl.ListFormatOptions['style'] },
        },
        number: {
          invalid: { maximumSignificantDigits: 0 },
        },
        relativeTime: {
          invalid: { style: 'invalid' as unknown as Intl.RelativeTimeFormatOptions['style'] },
        },
      },
      supportedLocales: ['en'],
    });

    expectI18nCode(
      () => service.formatDateTime(new Date('2026-05-11T00:00:00.000Z'), { format: 'invalid', locale: 'en' }),
      'I18N_INVALID_OPTIONS',
    );
    expectI18nCode(() => service.formatNumber(1, { format: 'invalid', locale: 'en' }), 'I18N_INVALID_OPTIONS');
    expectI18nCode(
      () => service.formatCurrency(1, { currency: 'USD', format: 'invalid', locale: 'en' }),
      'I18N_INVALID_OPTIONS',
    );
    expectI18nCode(() => service.formatPercent(0.1, { format: 'invalid', locale: 'en' }), 'I18N_INVALID_OPTIONS');
    expectI18nCode(() => service.formatList(['red', 'green'], { format: 'invalid', locale: 'en' }), 'I18N_INVALID_OPTIONS');
    expectI18nCode(() => service.formatRelativeTime(-1, 'day', { format: 'invalid', locale: 'en' }), 'I18N_INVALID_OPTIONS');
  });
});
