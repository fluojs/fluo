import type { GuardContext, HandlerDescriptor, RequestContext } from '@fluojs/http';
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

function createGuardContext(controllerToken: Function, requestContext: RequestContext): GuardContext {
  return {
    handler: {
      controllerToken: controllerToken as HandlerDescriptor['controllerToken'],
      metadata: {
        controllerPath: '',
        effectivePath: '/shared',
        effectiveVersion: '1',
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
});
