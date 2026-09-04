import { Module } from '@fluojs/core';
import { Controller, Get, type Middleware, type RequestContext } from '@fluojs/http';
import { createTestApp } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import {
  getHttpLocale,
  resolveHttpLocale,
  type HttpLocaleResolver,
} from './http.js';

function createDeferred<T>() {
  let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  if (!resolvePromise) {
    throw new TypeError('Promise executor did not initialize its resolver synchronously.');
  }

  return { promise, resolve: resolvePromise };
}

describe('@fluojs/i18n HTTP request-locale composition', () => {
  it('isolates custom resolver locales across overlapping request hooks', async () => {
    // Given
    const firstRequestEntered = createDeferred<void>();
    const releaseFirstRequest = createDeferred<void>();
    const customLocaleResolver: HttpLocaleResolver = ({ context }) => {
      const locale = context.request.headers['x-locale'];

      return typeof locale === 'string' ? { locale, source: 'custom-header' } : undefined;
    };
    const localeHook: Middleware = {
      async handle({ requestContext }, next) {
        const locale = resolveHttpLocale(requestContext, {
          defaultLocale: 'en',
          resolvers: [customLocaleResolver],
          supportedLocales: ['en', 'ko'],
        });

        if (locale.locale === 'en') {
          firstRequestEntered.resolve();
          await releaseFirstRequest.promise;
        }

        await next();
      },
    };

    @Controller('/locale')
    class LocaleController {
      @Get('/')
      readLocale(_input: undefined, context: RequestContext) {
        return getHttpLocale(context);
      }
    }

    @Module({ controllers: [LocaleController] })
    class AppModule {}

    const app = await createTestApp({
      middleware: [localeHook],
      rootModule: AppModule,
    });

    try {
      // When
      const firstRequest = app.request('GET', '/locale').header('x-locale', 'en').send();
      await firstRequestEntered.promise;
      const secondResponse = await app.request('GET', '/locale').header('x-locale', 'ko').send();
      releaseFirstRequest.resolve();
      const firstResponse = await firstRequest;

      // Then
      expect(secondResponse).toMatchObject({
        body: { locale: 'ko', source: 'custom-header' },
        status: 200,
      });
      expect(firstResponse).toMatchObject({
        body: { locale: 'en', source: 'custom-header' },
        status: 200,
      });
    } finally {
      releaseFirstRequest.resolve();
      await app.close();
    }
  });
});
