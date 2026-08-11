import { defineControllerMetadata, defineRouteMetadata } from '@fluojs/core/internal';
import { createHandlerMapping, type GuardContext, type HandlerDescriptor, type RequestContext } from '@fluojs/http';
import { describe, expect, it, vi } from 'vitest';
import { ThrottlerGuard } from './guard.js';
import type { ThrottlerConsumeInput, ThrottlerStore } from './types.js';

function createRequestContext(remoteAddress: string): RequestContext {
  const headers: Record<string, string | string[]> = {};
  const response: RequestContext['response'] = {
    committed: false,
    headers,
    redirect() {},
    send: vi.fn(async () => {}),
    setHeader(name: string, value: string | string[]) {
      headers[name] = value;
    },
    setStatus() {},
    statusCode: 200,
  };

  return {
    container: {} as RequestContext['container'],
    metadata: {},
    request: {
      body: undefined,
      cookies: {},
      headers,
      method: 'GET',
      params: {},
      path: '/shared',
      query: {},
      raw: { socket: { remoteAddress } },
      url: '/shared',
    },
    response,
  };
}

function createGuardContext(
  controllerToken: Function,
  requestContext: RequestContext,
  moduleType?: HandlerDescriptor['metadata']['moduleType'],
): GuardContext {
  return {
    handler: {
      controllerToken: controllerToken as HandlerDescriptor['controllerToken'],
      metadata: {
        controllerPath: '',
        effectivePath: '/shared',
        effectiveVersion: '1',
        ...(moduleType ? { moduleType } : {}),
        moduleMiddleware: [],
        pathParams: [],
      },
      methodName: 'action',
      route: {
        method: 'GET',
        path: '/shared',
        version: '1',
      },
    },
    requestContext,
  };
}

function createEquivalentController(): HandlerDescriptor['controllerToken'] {
  class SharedController {
    action() {
      return 'shared';
    }
  }

  defineControllerMetadata(SharedController, { basePath: '' });
  defineRouteMetadata(SharedController.prototype, 'action', {
    method: 'GET',
    path: '/shared',
  });

  return SharedController;
}

function compileHandler(
  controllerToken: HandlerDescriptor['controllerToken'],
  withPrecedingSource: boolean,
): HandlerDescriptor {
  class PrecedingController {}

  const sources = withPrecedingSource
    ? [{ controllerToken: PrecedingController }, { controllerToken }]
    : [{ controllerToken }];
  const handler = createHandlerMapping(sources).descriptors[0];

  if (!handler) {
    throw new TypeError('Expected the test route compiler to produce one handler descriptor.');
  }

  return handler;
}

function createCompiledGuardContext(handler: HandlerDescriptor, requestContext: RequestContext): GuardContext {
  return { handler, requestContext };
}

describe('ThrottlerGuard route bucket keys', () => {
  it('keeps route buckets isolated for different controllers with the same handler signature', async () => {
    const counts = new Map<string, number>();
    const store: ThrottlerStore = {
      consume: vi.fn(async (key: string, input: ThrottlerConsumeInput) => {
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);

        return {
          count,
          resetAt: input.now + input.ttlSeconds * 1000,
        };
      }),
    };

    class PublicController {
      action() {}
    }

    class AdminController {
      action() {}
    }

    const guard = new ThrottlerGuard({ limit: 1, store, ttl: 60 });
    const publicContext = createGuardContext(PublicController, createRequestContext('2001:db8::1'));
    const adminContext = createGuardContext(AdminController, createRequestContext('2001:db8::1'));

    await expect(guard.canActivate(publicContext)).resolves.toBe(true);
    await expect(guard.canActivate(adminContext)).resolves.toBe(true);

    const publicKey = vi.mocked(store.consume).mock.calls[0]?.[0];
    const adminKey = vi.mocked(store.consume).mock.calls[1]?.[0];

    expect(publicKey).toContain('controller%3APublicController');
    expect(adminKey).toContain('controller%3AAdminController');
    expect(publicKey).not.toBe(adminKey);
  });

  it('keeps route buckets isolated for identical-source handlers with distinct compiled identities', async () => {
    // Given
    const counts = new Map<string, number>();
    const store: ThrottlerStore = {
      consume: vi.fn(async (key: string, input: ThrottlerConsumeInput) => {
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);

        return {
          count,
          resetAt: input.now + input.ttlSeconds * 1000,
        };
      }),
    };
    const firstHandler = compileHandler(createEquivalentController(), true);
    const secondHandler = compileHandler(createEquivalentController(), false);
    const guard = new ThrottlerGuard({ limit: 1, store, ttl: 60 });
    const firstContext = createCompiledGuardContext(firstHandler, createRequestContext('2001:db8::2'));
    const secondContext = createCompiledGuardContext(secondHandler, createRequestContext('2001:db8::2'));
    await guard.canActivate(firstContext);

    // When
    const secondResult = guard.canActivate(secondContext);

    // Then
    await expect(secondResult).resolves.toBe(true);
    expect(vi.mocked(store.consume).mock.calls[0]?.[0]).not.toBe(vi.mocked(store.consume).mock.calls[1]?.[0]);
  });

  it('keeps equivalent compiled handler keys deterministic across guard instances', async () => {
    // Given
    const counts = new Map<string, number>();
    const store: ThrottlerStore = {
      consume: vi.fn(async (key: string, input: ThrottlerConsumeInput) => {
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);

        return {
          count,
          resetAt: input.now + input.ttlSeconds * 1000,
        };
      }),
    };
    const firstHandler = compileHandler(createEquivalentController(), true);
    const secondHandler = compileHandler(createEquivalentController(), true);
    const firstGuard = new ThrottlerGuard({ limit: 1, store, ttl: 60 });
    const secondGuard = new ThrottlerGuard({ limit: 1, store, ttl: 60 });
    const firstContext = createCompiledGuardContext(firstHandler, createRequestContext('2001:db8::3'));
    const secondContext = createCompiledGuardContext(secondHandler, createRequestContext('2001:db8::3'));
    await firstGuard.canActivate(firstContext);

    // When
    const repeatedRequest = secondGuard.canActivate(secondContext);

    // Then
    await expect(repeatedRequest).rejects.toMatchObject({ status: 429 });
    expect(vi.mocked(store.consume).mock.calls[0]?.[0]).toBe(vi.mocked(store.consume).mock.calls[1]?.[0]);
  });
});
