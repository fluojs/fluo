import { describe, expect, it } from 'vitest';

import { I18nError, I18nModule, createI18n } from './index.js';
import type { I18nErrorCode, I18nLocale, I18nModuleOptions, I18nTranslationKey } from './index.js';

describe('@fluojs/i18n root public surface', () => {
  it('keeps the root value exports intentionally small', async () => {
    const root = await import('./index.js');

    expect(Object.keys(root).sort()).toEqual(['I18nError', 'I18nModule', 'I18nService', 'createI18n']);
  });

  it('exposes the initial module, service, factory, and error placeholders', () => {
    const options: I18nModuleOptions = {
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
});
