import { describe, expect, it } from 'vitest';

import type { RequestContext } from '@fluojs/http';

import {
  createAcceptLanguageLocaleResolver,
  getHttpLocale,
  parseAcceptLanguage,
  resolveHttpLocale,
  setHttpLocale,
  type HttpLocaleResolver,
} from './http.js';

function createMockContext(headers: RequestContext['request']['headers'] = {}): RequestContext {
  return {
    container: {
      async dispose() {},
      async resolve() {
        throw new Error('No providers are registered in this test request context.');
      },
    },
    metadata: {},
    request: {
      body: undefined,
      cookies: {},
      headers,
      method: 'GET',
      params: {},
      path: '/localized',
      query: {},
      raw: {},
      url: '/localized',
    },
    requestId: 'req_locale',
    response: {
      committed: false,
      headers: {},
      redirect() {},
      send() {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      setStatus(code) {
        this.statusCode = code;
      },
      statusCode: 200,
    },
  };
}

describe('@fluojs/i18n/http locale context adapter', () => {
  it('stores locale metadata per request context without leaking across requests', () => {
    const contextA = createMockContext();
    const contextB = createMockContext();

    setHttpLocale(contextA, 'en', { source: 'test-a' });
    setHttpLocale(contextB, 'ko', { source: 'test-b' });

    expect(getHttpLocale(contextA)).toEqual({ locale: 'en', source: 'test-a' });
    expect(getHttpLocale(contextB)).toEqual({ locale: 'ko', source: 'test-b' });
  });

  it('parses Accept-Language by q-value and ignores invalid entries', () => {
    expect(parseAcceptLanguage('fr-CA;q=0.7, ko-KR, invalid tag;q=1, en;q=0.8, ja;q=0, *;q=0.5')).toEqual([
      { locale: 'ko-KR', quality: 1 },
      { locale: 'en', quality: 0.8 },
      { locale: 'fr-CA', quality: 0.7 },
      { locale: '*', quality: 0.5 },
    ]);
  });

  it('runs explicit resolver chains in order', () => {
    const context = createMockContext({ 'accept-language': 'ko;q=1' });
    const first: HttpLocaleResolver = () => 'fr';
    const second = createAcceptLanguageLocaleResolver();

    const locale = resolveHttpLocale(context, {
      defaultLocale: 'en',
      resolvers: [first, second],
      supportedLocales: ['en', 'fr', 'ko'],
    });

    expect(locale).toEqual({ locale: 'fr' });
    expect(getHttpLocale(context)).toEqual({ locale: 'fr' });
  });

  it('skips invalid and unsupported resolver locales', () => {
    const context = createMockContext({ 'Accept-Language': 'fr;q=1, ko;q=0.9' });
    const invalid: HttpLocaleResolver = () => 'invalid locale';
    const unsupported: HttpLocaleResolver = () => ({ locale: 'fr', source: 'unsupported' });
    const acceptLanguage = createAcceptLanguageLocaleResolver();

    const locale = resolveHttpLocale(context, {
      defaultLocale: 'en',
      resolvers: [invalid, unsupported, acceptLanguage],
      supportedLocales: ['en', 'ko'],
    });

    expect(locale).toEqual({ locale: 'ko', source: 'accept-language' });
  });

  it('falls back to the configured default locale when no resolver matches', () => {
    const context = createMockContext({ 'accept-language': 'fr;q=1, *;q=0.8' });

    const locale = resolveHttpLocale(context, {
      defaultLocale: 'en',
      resolvers: [createAcceptLanguageLocaleResolver()],
      supportedLocales: ['en', 'ko'],
    });

    expect(locale).toEqual({ locale: 'en', source: 'default' });
    expect(getHttpLocale(context)).toEqual({ locale: 'en', source: 'default' });
  });
});
