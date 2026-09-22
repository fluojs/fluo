import { ConfigService } from '@fluojs/config';
import { getModuleMetadata } from '@fluojs/core';
import { I18nService } from '@fluojs/i18n';
import { FluoFactory } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { CompositionRootModule } from './app';
import { WELCOME_LOCALE } from './contract';

/**
 * Cross-package composition evidence: one application where @fluojs/core
 * metadata is compiled by @fluojs/runtime, ConfigModule provides a validated
 * snapshot consumed by a DI factory provider, and the controller resolves the
 * request locale through @fluojs/i18n's HTTP adapter.
 */

describe('foundation package composition', () => {
  it('serves greetings whose default locale comes from the validated config snapshot', async () => {
    const app = await Test.createApp({ rootModule: CompositionRootModule });
    try {
      // No Accept-Language header: the resolver falls back to the configured
      // default locale ('ko'), which was produced by the config factory provider.
      const fallback = await app.request('GET', '/welcome').send();
      expect(fallback.status).toBe(200);
      expect(fallback.body).toBe('안녕하세요 Fluo!');

      const english = await app.request('GET', '/welcome').header('Accept-Language', 'en').send();
      expect(english.status).toBe(200);
      expect(english.body).toBe('Welcome Fluo!');
    } finally {
      await app.close();
    }
  });

  it('exposes the same graph to a standalone context with typed token access', async () => {
    const context = await FluoFactory.createApplicationContext(CompositionRootModule);
    try {
      const config = await context.get(ConfigService);
      expect(config.getOrThrow('APP.LOCALE')).toBe('ko');

      // publicToken carries its service type at Application.get; the context
      // facade is typed through the broad Token contract, so annotate here.
      const locale: string = await context.get(WELCOME_LOCALE);
      expect(locale).toBe('ko');

      const i18n = await context.get(I18nService);
      // Without interpolation values the {{ name }} placeholder stays verbatim.
      expect(i18n.translate('welcome', { locale })).toBe('안녕하세요 {{ name }}!');
    } finally {
      await context.close();
    }
  });

  it('declares the composition module through defineModule metadata', () => {
    const root = getModuleMetadata(CompositionRootModule);
    expect(root?.imports).toHaveLength(1);

    const featureModule = root?.imports?.[0];
    if (typeof featureModule !== 'function') {
      throw new TypeError('composition feature module missing from root imports');
    }

    const feature = getModuleMetadata(featureModule);
    expect(feature?.providers).toEqual([
      expect.objectContaining({ provide: WELCOME_LOCALE, useFactory: expect.any(Function) }),
    ]);
  });
});
