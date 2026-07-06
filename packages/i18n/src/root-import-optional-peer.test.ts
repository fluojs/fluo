import { describe, expect, it, vi } from 'vitest';

describe('@fluojs/i18n root optional peer boundary', () => {
  it('keeps the root import isolated from optional peer dependencies', async () => {
    vi.resetModules();
    vi.doMock('@fluojs/http', () => {
      throw Object.assign(new Error("Cannot find package '@fluojs/http'"), { code: 'ERR_MODULE_NOT_FOUND' });
    });
    vi.doMock('@fluojs/validation', () => {
      throw Object.assign(new Error("Cannot find package '@fluojs/validation'"), { code: 'ERR_MODULE_NOT_FOUND' });
    });
    vi.doMock('intl-messageformat', () => {
      throw Object.assign(new Error("Cannot find package 'intl-messageformat'"), { code: 'ERR_MODULE_NOT_FOUND' });
    });

    try {
      const root = await import('./index.js');

      expect(Object.keys(root).sort()).toEqual(['I18nError', 'I18nModule', 'I18nService', 'createI18n']);
    } finally {
      vi.doUnmock('@fluojs/http');
      vi.doUnmock('@fluojs/validation');
      vi.doUnmock('intl-messageformat');
      vi.resetModules();
    }
  });
});
