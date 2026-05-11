import { describe, expect, it } from 'vitest';

import { I18nError, I18nModule, createI18n } from './index.js';
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

describe('@fluojs/i18n root public surface', () => {
  it('keeps the root value exports intentionally small', async () => {
    const root = await import('./index.js');

    expect(Object.keys(root).sort()).toEqual(['I18nError', 'I18nModule', 'I18nService', 'createI18n']);
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
});
