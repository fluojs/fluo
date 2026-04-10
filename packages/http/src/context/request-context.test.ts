import { describe, expect, it } from 'vitest';

import { Container } from '@fluojs/di';

import {
  assertRequestContext,
  createContextKey,
  createRequestContext,
  getContextValue,
  getCurrentRequestContext,
  runWithRequestContext,
  setContextValue,
} from './request-context.js';
import type { RequestContext } from '../types.js';

function createMockContext(): RequestContext {
  const root = new Container();

  return {
    container: root.createRequestScope(),
    metadata: {},
    request: {
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/health',
      query: {},
      raw: {},
      url: '/health',
    },
    requestId: 'req_123',
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

describe('request context store', () => {
  it('keeps context available across awaited async work', async () => {
    const context = createRequestContext(createMockContext());

    const result = await runWithRequestContext(context, async () => {
      await Promise.resolve();

      return assertRequestContext().requestId;
    });

    expect(result).toBe('req_123');
  });

  it('returns undefined outside request scope', () => {
    expect(getCurrentRequestContext()).toBeUndefined();
  });

  it('exposes a request-scoped container inside ALS context', async () => {
    let created = 0;

    class RequestStore {
      readonly id = ++created;
    }

    const root = new Container().register({
      provide: RequestStore,
      scope: 'request',
      useClass: RequestStore,
    });

    const contextA = createRequestContext({
      ...createMockContext(),
      container: root.createRequestScope(),
    });
    const contextB = createRequestContext({
      ...createMockContext(),
      container: root.createRequestScope(),
    });

    const requestA = await runWithRequestContext(contextA, async () => {
      const ctx = assertRequestContext();
      const first = await ctx.container.resolve(RequestStore);
      const second = await ctx.container.resolve(RequestStore);

      expect(first).toBe(second);

      return first;
    });

    const requestB = await runWithRequestContext(contextB, async () => {
      const ctx = assertRequestContext();

      return ctx.container.resolve(RequestStore);
    });

    expect(requestA).not.toBe(requestB);
  });

  describe('typed context keys', () => {
    it('stores and retrieves typed values via ContextKey', async () => {
      const TENANT_KEY = createContextKey<string>('tenantId');
      const TRACE_KEY = createContextKey<string>('traceId');
      const context = createRequestContext(createMockContext());

      setContextValue(context, TENANT_KEY, 'acme');
      setContextValue(context, TRACE_KEY, 'trace-123');

      expect(getContextValue(context, TENANT_KEY)).toBe('acme');
      expect(getContextValue(context, TRACE_KEY)).toBe('trace-123');
    });

    it('returns undefined for unset context keys', () => {
      const KEY = createContextKey<number>('counter');
      const context = createRequestContext(createMockContext());

      expect(getContextValue(context, KEY)).toBeUndefined();
    });

    it('isolates context keys between requests via ALS', async () => {
      const LOCALE_KEY = createContextKey<string>('locale');
      const contextA = createRequestContext(createMockContext());
      const contextB = createRequestContext(createMockContext());

      setContextValue(contextA, LOCALE_KEY, 'en-US');
      setContextValue(contextB, LOCALE_KEY, 'ko-KR');

      const resultA = await runWithRequestContext(contextA, async () => {
        const ctx = assertRequestContext();
        return getContextValue(ctx, LOCALE_KEY);
      });

      const resultB = await runWithRequestContext(contextB, async () => {
        const ctx = assertRequestContext();
        return getContextValue(ctx, LOCALE_KEY);
      });

      expect(resultA).toBe('en-US');
      expect(resultB).toBe('ko-KR');
    });
  });
});
