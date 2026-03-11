import { describe, expect, it } from 'vitest';

import { Container } from '@konekti-internal/di';

import { assertRequestContext, createRequestContext, getCurrentRequestContext, runWithRequestContext } from './request-context';
import type { RequestContext } from './types';

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
});
