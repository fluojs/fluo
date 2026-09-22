import { fileURLToPath } from 'node:url';
import { Inject, Module } from '@fluojs/core';
import { Controller, Get, type RequestContext } from '@fluojs/http';
import { I18nError, I18nModule, I18nService } from '@fluojs/i18n';
import {
  createAcceptLanguageLocalePolicyResolver,
  resolveHttpLocale,
} from '@fluojs/i18n/http';
import { FileSystemI18nLoader } from '@fluojs/i18n/loaders/fs';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

/**
 * @fluojs/i18n guide evidence: the deterministic lookup chain, namespace
 * prefixing, locale validation, filesystem loader contracts, and HTTP
 * Accept-Language binding through a real test application.
 */

const localesDir = fileURLToPath(new URL('./locales', import.meta.url));

describe('@fluojs/i18n guide examples', () => {
  it('resolves translations through the documented fallback chain', () => {
    const missingLocales: string[][] = [];
    const i18n = I18nService.create({
      defaultLocale: 'en',
      supportedLocales: ['en', 'ko'],
      fallbackLocales: { ko: ['en'] },
      catalogs: {
        en: { common: { welcome: 'Welcome {{ name }}!', onlyEnglish: 'EN only' } },
        ko: { common: { welcome: '안녕하세요 {{ name }}!' } },
      },
      missingMessage: (context) => {
        missingLocales.push([...context.attemptedLocales]);
        return undefined;
      },
    });

    expect(i18n.translate('common.welcome', { locale: 'ko', values: { name: 'Mina' } })).toBe(
      '안녕하세요 Mina!',
    );
    // Fallback to en for the message ko does not define.
    expect(i18n.translate('common.onlyEnglish', { locale: 'ko' })).toBe('EN only');
    expect(i18n.translate('common.welcome', { locale: 'en', values: { name: 'Mina' } })).toBe(
      'Welcome Mina!',
    );

    // Namespace prefixing matches the fully qualified key.
    expect(i18n.translate('welcome', { namespace: 'common', locale: 'en', values: { name: 'Mina' } })).toBe(
      'Welcome Mina!',
    );

    // defaultValue is consulted before the missing-message hook.
    expect(i18n.translate('common.absent', { locale: 'ko', defaultValue: 'fallback text' })).toBe(
      'fallback text',
    );
    expect(missingLocales).toEqual([]);
  });

  it('throws I18N_MISSING_MESSAGE with the attempted chain and rejects unsupported locales', () => {
    let attempted: readonly string[] = [];
    const i18n = I18nService.create({
      defaultLocale: 'en',
      supportedLocales: ['en', 'ko'],
      fallbackLocales: { ko: ['en'] },
      catalogs: { en: {}, ko: {} },
      missingMessage: (context) => {
        attempted = context.attemptedLocales;
        return undefined;
      },
    });

    try {
      i18n.translate('common.absent', { locale: 'ko' });
      throw new Error('expected I18nError');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(I18nError);
      expect((error as I18nError).code).toBe('I18N_MISSING_MESSAGE');
      expect(attempted).toEqual(['ko', 'en']);
    }

    expect(() => i18n.translate('common.welcome', { locale: 'fr' })).toThrowError(I18nError);
    try {
      i18n.translate('common.welcome', { locale: 'fr' });
    } catch (error: unknown) {
      expect((error as I18nError).code).toBe('I18N_INVALID_OPTIONS');
    }
  });

  it('loads immutable catalogs from the Node filesystem loader with loader error codes', async () => {
    const loader = FileSystemI18nLoader.create({ rootDir: localesDir });

    const english = await loader.load('en', 'common');
    expect(english).toEqual({ welcome: 'Welcome {{ name }}!', onlyEnglish: 'EN only' });

    try {
      await loader.load('en', 'missing');
      throw new Error('expected I18N_MISSING_CATALOG');
    } catch (error: unknown) {
      expect((error as I18nError).code).toBe('I18N_MISSING_CATALOG');
    }

    try {
      await loader.load('en', '../escape');
      throw new Error('expected I18N_INVALID_LOADER_OPTIONS');
    } catch (error: unknown) {
      expect((error as I18nError).code).toBe('I18N_INVALID_LOADER_OPTIONS');
    }
  });

  it('binds the request locale through the HTTP adapter in a real test app', async () => {
    const acceptLanguage = createAcceptLanguageLocalePolicyResolver();

    @Controller('/i18n')
    @Inject(I18nService)
    class LocaleController {
      constructor(private readonly i18n: I18nService) {}

      @Get()
      welcome(_input: undefined, ctx: RequestContext): string {
        const resolved = resolveHttpLocale(ctx, {
          defaultLocale: 'en',
          supportedLocales: ['en', 'ko'],
          resolvers: [acceptLanguage],
        });

        return this.i18n.translate('common.welcome', {
          locale: resolved.locale,
          values: { name: 'Fluo' },
        });
      }
    }

    @Module({
      imports: [
        I18nModule.forRoot({
          defaultLocale: 'en',
          supportedLocales: ['en', 'ko'],
          catalogs: {
            en: { common: { welcome: 'Welcome {{ name }}!' } },
            ko: { common: { welcome: '안녕하세요 {{ name }}!' } },
          },
        }),
      ],
      controllers: [LocaleController],
    })
    class I18nRootModule {}

    const app = await Test.createApp({ rootModule: I18nRootModule });
    try {
      const korean = await app.request('GET', '/i18n').header('Accept-Language', 'ko').send();
      expect(korean.status).toBe(200);
      expect(korean.body).toBe('안녕하세요 Fluo!');

      const english = await app.request('GET', '/i18n').header('Accept-Language', 'en-GB').send();
      expect(english.status).toBe(200);
      // Regional ranges normalize to the supported locale.
      expect(english.body).toBe('Welcome Fluo!');
    } finally {
      await app.close();
    }
  });

  it('keeps module options and catalogs immutable after registration', () => {
    const catalogs = { en: { common: { title: 'Original' } } };
    const i18n = I18nService.create({
      defaultLocale: 'en',
      catalogs,
    });

    (catalogs.en.common as Record<string, string>).title = 'Mutated';
    expect(i18n.translate('common.title', { locale: 'en' })).toBe('Original');
  });
});
