import { ConfigModule, type ConfigSchema, ConfigService } from '@fluojs/config';
import { Inject, Module } from '@fluojs/core';
import { Controller, Get, type RequestContext } from '@fluojs/http';
import { I18nModule, I18nService } from '@fluojs/i18n';
import { createAcceptLanguageLocalePolicyResolver, resolveHttpLocale } from '@fluojs/i18n/http';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { WELCOME_LOCALE } from './contract';

/**
 * Cross-package composition (@fluojs/core + config + di + runtime + i18n):
 * ConfigModule produces one validated snapshot, a factory provider reads it
 * through the DI container, and the controller resolves the request locale
 * through the i18n HTTP adapter before translating.
 */

const requirePath = (path: string): ConfigSchema => ({
  '~standard': {
    version: 1,
    vendor: 'docs-foundation-fixture',
    validate(value: unknown) {
      if (typeof value !== 'object' || value === null) {
        return { issues: [{ message: 'config must be an object' }] };
      }

      let current: unknown = value;
      for (const segment of path.split('.')) {
        if (typeof current !== 'object' || current === null || !(segment in current)) {
          return { issues: [{ message: `${path} must be present` }] };
        }
        current = (current as Record<string, unknown>)[segment];
      }

      if (typeof current !== 'string' || current.length === 0) {
        return { issues: [{ message: `${path} must be a non-empty string` }] };
      }

      return { value: value as Record<string, unknown> };
    },
  },
});

const acceptLanguage = createAcceptLanguageLocalePolicyResolver();

@Inject(I18nService, WELCOME_LOCALE)
@Controller('/welcome')
export class WelcomeController {
  constructor(
    private readonly i18n: I18nService,
    private readonly defaultLocale: string,
  ) {}

  @Get()
  welcome(_input: undefined, ctx: RequestContext): string {
    const resolved = resolveHttpLocale(ctx, {
      defaultLocale: this.defaultLocale,
      supportedLocales: ['en', 'ko'],
      resolvers: [acceptLanguage],
    });

    return this.i18n.translate('welcome', {
      locale: resolved.locale,
      values: { name: 'Fluo' },
    });
  }
}

function buildCompositionModule(): ModuleType {
  class CompositionFeatureModule {}

  return defineModule(CompositionFeatureModule, {
    imports: [
      ConfigModule.forRoot({
        envFilePaths: [],
        runtimeOverrides: { APP: { LOCALE: 'ko' } },
        schema: requirePath('APP.LOCALE'),
      }),
      I18nModule.forRoot({
        defaultLocale: 'en',
        supportedLocales: ['en', 'ko'],
        catalogs: {
          en: { welcome: 'Welcome {{ name }}!' },
          ko: { welcome: '안녕하세요 {{ name }}!' },
        },
      }),
    ],
    providers: [
      {
        provide: WELCOME_LOCALE,
        useFactory: (...deps: unknown[]) => {
          const config = deps[0];
          if (!(config instanceof ConfigService)) {
            throw new TypeError('WELCOME_LOCALE factory requires the injected ConfigService');
          }

          // instanceof narrowing erases the generic parameter; pin the
          // dictionary default so dot-path typing stays finite.
          const configService: ConfigService = config;
          return String(configService.getOrThrow('APP.LOCALE'));
        },
        inject: [ConfigService],
      },
    ],
    controllers: [WelcomeController],
  });
}

@Module({ imports: [buildCompositionModule()] })
export class CompositionRootModule {}
