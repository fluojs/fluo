import { getModuleMetadata } from '@fluojs/core/internal';
import { Container, type Provider } from '@fluojs/di';
import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  type FrameworkRequest,
  type FrameworkResponse,
  Get,
  type GuardContext,
} from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import { RequireScopes, UseAuth } from '../decorators.js';
import { PassportModule } from '../module.js';
import type { AuthStrategy, AuthStrategyResult } from '../types.js';
import { createPassportJsStrategyBridge } from './passport-js.js';

function createPassportModuleProviders(
  options: Parameters<typeof PassportModule.forRoot>[0],
  strategies: Parameters<typeof PassportModule.forRoot>[1],
): Provider[] {
  const metadata = getModuleMetadata(PassportModule.forRoot(options, strategies)) as {
    providers?: Provider[];
  };

  if (!Array.isArray(metadata.providers)) {
    throw new Error('Expected PassportModule.forRoot(...) to expose runtime providers.');
  }

  return metadata.providers;
}

function createRequest(path: string, headers: FrameworkRequest['headers'] = {}): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers,
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body: unknown) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

describe('Passport.js bridge guard terminal semantics', () => {
  it.each([
    { claims: null, label: 'null' },
    { claims: [], label: 'array' },
    { claims: 'scalar', label: 'scalar' },
  ])('rejects custom mapper principals with $label claims through the canonical auth path', async ({
    claims,
    label,
  }) => {
    // Given
    class PassportLikeInvalidClaimsStrategy {
      success?: (user: unknown, info?: unknown) => void;

      authenticate() {
        this.success?.({ id: 'google-user-1' });
      }
    }

    const mappedPrincipal = { claims: {}, subject: 'mapped-user' };
    Object.defineProperty(mappedPrincipal, 'claims', { value: claims });
    const bridge = createPassportJsStrategyBridge('google-invalid-claims', PassportLikeInvalidClaimsStrategy, {
      mapPrincipal: () => mappedPrincipal,
    });

    @Controller('/oauth')
    class ProtectedController {
      @Get('/profile')
      @UseAuth('google-invalid-claims')
      getProfile() {
        return { ok: true };
      }
    }

    const root = new Container().register(
      ProtectedController,
      PassportLikeInvalidClaimsStrategy,
      ...bridge.providers,
      ...createPassportModuleProviders({ defaultStrategy: 'google-invalid-claims' }, [bridge.strategy]),
    );
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ProtectedController }]),
      rootContainer: root,
    });
    const response = createResponse();

    // When
    await dispatcher.dispatch(
      createRequest('/oauth/profile', { 'x-request-id': `req-invalid-${label}-claims` }),
      response,
    );

    // Then
    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        details: undefined,
        message: 'Authentication required.',
        meta: undefined,
        requestId: `req-invalid-${label}-claims`,
        status: 401,
      },
    });
  });

  it('skips principal assignment, failing scopes, and the handler for a committed handled result', async () => {
    // Given
    let handlerCalled = false;
    let handledRequestContext: GuardContext['requestContext'] | undefined;
    let scopeReads = 0;
    const principal = new Proxy(
      {
        claims: { source: 'handled' },
        scopes: [],
        subject: 'handled-user',
      },
      {
        get(target, property, receiver) {
          if (property === 'scopes') {
            scopeReads += 1;
          }

          return Reflect.get(target, property, receiver);
        },
      },
    );

    class CommittedHandledStrategy implements AuthStrategy {
      async authenticate(context: GuardContext): Promise<AuthStrategyResult> {
        handledRequestContext = context.requestContext;
        context.requestContext.response.setStatus(202);
        context.requestContext.response.send({ outcome: 'strategy' });

        return { handled: true, principal };
      }
    }

    @Controller('/protected')
    class ProtectedController {
      @Get('/')
      @UseAuth('handled')
      @RequireScopes('profile:read')
      getResource() {
        handlerCalled = true;
        return { ok: true };
      }
    }

    const root = new Container().register(
      ProtectedController,
      CommittedHandledStrategy,
      ...createPassportModuleProviders({ defaultStrategy: 'handled' }, [
        { name: 'handled', token: CommittedHandledStrategy },
      ]),
    );
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ProtectedController }]),
      rootContainer: root,
    });
    const response = createResponse();

    // When
    await dispatcher.dispatch(createRequest('/protected'), response);

    // Then
    expect(scopeReads).toBe(0);
    expect(handledRequestContext?.principal).toBeUndefined();
    expect(handlerCalled).toBe(false);
    expect(response.statusCode).toBe(202);
    expect(response.body).toEqual({ outcome: 'strategy' });
  });
});
