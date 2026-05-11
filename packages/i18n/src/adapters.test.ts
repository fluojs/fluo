import { describe, expect, it } from 'vitest';
import {
  bindLocale,
  createCookieLocaleResolver,
  createHeaderLocalePolicyResolver,
  createHeaderLocaleResolver,
  createQueryLocaleResolver,
  createStorageLocaleResolver,
  createWeakMapLocaleStore,
  getAdapterLocale,
  type LocaleAdapterResolver,
  resolveLocale,
  setAdapterLocale,
} from './adapters.js';
import { createAcceptLanguageLocaleResolver, type HttpLocaleResolver, resolveHttpLocale } from './http.js';

type HttpRequestContext = Parameters<typeof resolveHttpLocale>[0];

interface TransportContext {
  readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly query?: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly cookies?: Readonly<Record<string, string | undefined>>;
  readonly storage?: Readonly<Record<string, string | undefined>>;
}

function createMockHttpContext(headers: HttpRequestContext['request']['headers'] = {}): HttpRequestContext {
  const responseHeaders: Record<string, string | string[]> = {};

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
      headers: responseHeaders,
      redirect() {},
      send() {},
      setHeader(name: string, value: string | string[]) {
        responseHeaders[name] = value;
      },
      setStatus(code: number) {
        this.statusCode = code;
      },
      statusCode: 200,
    },
  };
}

describe('@fluojs/i18n/adapters locale adapter surface', () => {
  it('keeps the adapter exports isolated from the root package surface', async () => {
    const root = await import('./index.js');
    const adapters = await import('./adapters.js');

    expect(Object.keys(root).sort()).toEqual(['I18nError', 'I18nModule', 'I18nService', 'createI18n']);
    expect(Object.keys(adapters).sort()).toEqual([
      'bindLocale',
      'createCookieLocaleResolver',
      'createHeaderLocalePolicyResolver',
      'createHeaderLocaleResolver',
      'createQueryLocaleResolver',
      'createStorageLocaleResolver',
      'createWeakMapLocaleStore',
      'getAdapterLocale',
      'resolveLocale',
      'setAdapterLocale',
    ]);
  });

  it('resolves header, query, cookie, and storage adapters in explicit order', () => {
    const context: TransportContext = {
      cookies: { locale: 'ko' },
      headers: { 'accept-language': 'fr;q=1, ko;q=0.9' },
      query: { locale: 'en' },
      storage: { locale: 'ja' },
    };

    const locale = resolveLocale(context, {
      defaultLocale: 'en',
      resolvers: [
        createQueryLocaleResolver({ getQueryValue: (ctx) => ctx.query?.locale }),
        createCookieLocaleResolver({ getCookieValue: (ctx) => ctx.cookies?.locale }),
        createHeaderLocaleResolver({ getHeader: (ctx) => ctx.headers?.['accept-language'] }),
        createStorageLocaleResolver({ getStoredLocale: (ctx) => ctx.storage?.locale }),
      ],
      supportedLocales: ['en', 'ko', 'fr', 'ja'],
    });

    expect(locale).toEqual({ locale: 'en', source: 'query' });
  });

  it('supports Accept-Language style header fallback without HTTP imports in adapter callers', () => {
    const context: TransportContext = {
      headers: { metadata: ['invalid locale;q=1', 'fr;q=0.6, ko;q=0.9, *;q=0.8'] },
    };

    const locale = resolveLocale(context, {
      defaultLocale: 'en',
      resolvers: [createHeaderLocaleResolver({ getHeader: (ctx) => ctx.headers?.metadata, source: 'grpc-metadata' })],
      supportedLocales: ['en', 'ko'],
    });

    expect(locale).toEqual({ locale: 'ko', source: 'grpc-metadata' });
  });

  it('ignores empty, invalid, and unsupported adapter output before using storage fallback', () => {
    const context: TransportContext = {
      cookies: { locale: '' },
      query: { locale: ['invalid locale', 'ko'] },
      storage: { locale: 'ko' },
    };
    const invalidObject: LocaleAdapterResolver<TransportContext> = () => ({ locale: 'en', source: 123 });

    const locale = resolveLocale(context, {
      defaultLocale: 'en',
      resolvers: [
        createCookieLocaleResolver({ getCookieValue: (ctx) => ctx.cookies?.locale }),
        createQueryLocaleResolver({ getQueryValue: (ctx) => ctx.query?.locale }),
        invalidObject,
        createStorageLocaleResolver({ getStoredLocale: (ctx) => ctx.storage?.locale, source: 'socket-data' }),
      ],
      supportedLocales: ['en', 'ko'],
    });

    expect(locale).toEqual({ locale: 'ko', source: 'socket-data' });
  });

  it('uses the configured default locale when no non-HTTP resolver matches', () => {
    const context: TransportContext = {
      headers: { 'accept-language': 'fr;q=1, *;q=0.8' },
      query: { locale: 'invalid locale' },
    };

    const locale = resolveLocale(context, {
      defaultLocale: 'en',
      resolvers: [
        createQueryLocaleResolver({ getQueryValue: (ctx) => ctx.query?.locale }),
        createHeaderLocaleResolver({ getHeader: (ctx) => ctx.headers?.['accept-language'] }),
      ],
      supportedLocales: ['en', 'ko'],
    });

    expect(locale).toEqual({ locale: 'en', source: 'default' });
  });

  it('keeps adapter wildcard ranges fallback-only unless the policy resolver is selected', () => {
    const context: TransportContext = { headers: { 'accept-language': '*;q=1' } };

    expect(
      resolveLocale(context, {
        defaultLocale: 'en',
        resolvers: [createHeaderLocaleResolver({ getHeader: (ctx) => ctx.headers?.['accept-language'] })],
        supportedLocales: ['en', 'ko'],
      }),
    ).toEqual({ locale: 'en', source: 'default' });
    expect(
      resolveLocale(context, {
        defaultLocale: 'en',
        resolvers: [
          createHeaderLocalePolicyResolver({
            getHeader: (ctx) => ctx.headers?.['accept-language'],
            wildcardLocale: 'firstSupportedLocale',
          }),
        ],
        supportedLocales: ['ko', 'en'],
      }),
    ).toEqual({ locale: 'ko', source: 'accept-language' });
  });

  it('keeps explicit adapter locale preferences ahead of wildcard policy fallbacks', () => {
    const context: TransportContext = { headers: { 'accept-language': '*;q=1, en-US;q=0.5' } };

    const locale = resolveLocale(context, {
      defaultLocale: 'ko',
      resolvers: [
        createHeaderLocalePolicyResolver({
          getHeader: (ctx) => ctx.headers?.['accept-language'],
          wildcardLocale: 'defaultLocale',
        }),
      ],
      supportedLocales: ['en', 'ko'],
    });

    expect(locale).toEqual({ locale: 'en', source: 'accept-language' });
  });

  it('rejects invalid and unsupported default locales before storing metadata', () => {
    const context: TransportContext = { query: { locale: 'ko' } };
    const store = createWeakMapLocaleStore<TransportContext>();

    expect(() =>
      bindLocale(context, {
        defaultLocale: 'invalid locale',
        resolvers: [createQueryLocaleResolver({ getQueryValue: (ctx) => ctx.query?.locale })],
        store,
        supportedLocales: ['en', 'ko'],
      }),
    ).toThrow(TypeError);
    expect(() =>
      bindLocale(context, {
        defaultLocale: 'fr',
        resolvers: [createQueryLocaleResolver({ getQueryValue: (ctx) => ctx.query?.locale })],
        store,
        supportedLocales: ['en', 'ko'],
      }),
    ).toThrow(TypeError);
    expect(getAdapterLocale(store, context)).toBeUndefined();
  });

  it('stores metadata per non-HTTP context without leaking between contexts', () => {
    const store = createWeakMapLocaleStore<TransportContext>();
    const contextA: TransportContext = { query: { locale: 'ko' } };
    const contextB: TransportContext = { query: { locale: 'en' } };

    const resolvedA = bindLocale(contextA, {
      defaultLocale: 'en',
      resolvers: [createQueryLocaleResolver({ getQueryValue: (ctx) => ctx.query?.locale })],
      store,
      supportedLocales: ['en', 'ko'],
    });
    setAdapterLocale(store, contextB, 'en', { source: 'manual' });

    expect(resolvedA).toEqual({ locale: 'ko', source: 'query' });
    expect(getAdapterLocale(store, contextA)).toEqual({ locale: 'ko', source: 'query' });
    expect(getAdapterLocale(store, contextB)).toEqual({ locale: 'en', source: 'manual' });
  });

  it('preserves current HTTP helper behavior while sharing locale validation semantics', () => {
    const adapterContext: TransportContext = { headers: { 'accept-language': 'ko;q=1' } };
    const httpContext = createMockHttpContext({ 'accept-language': 'ko;q=1' });
    const adapterResolver = createHeaderLocaleResolver<TransportContext>({ getHeader: (ctx) => ctx.headers?.['accept-language'] });
    const httpResolver: HttpLocaleResolver = createAcceptLanguageLocaleResolver();

    expect(
      resolveLocale(adapterContext, {
        defaultLocale: 'en',
        resolvers: [adapterResolver],
        supportedLocales: ['en', 'ko'],
      }),
    ).toEqual({ locale: 'ko', source: 'accept-language' });
    expect(
      resolveHttpLocale(httpContext, {
        defaultLocale: 'en',
        resolvers: [httpResolver],
        supportedLocales: ['en', 'ko'],
      }),
    ).toEqual({ locale: 'ko', source: 'accept-language' });
  });
});
