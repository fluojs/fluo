import { describe, expect, it } from 'vitest';

import { Controller, Get, createDispatcher, createHandlerMapping } from '@konekti/http';
import type { FrameworkRequest, FrameworkResponse, GuardContext } from '@konekti/http';
import { Container } from '@konekti-internal/di';

import { RequireScopes, UseAuth } from './decorators';
import { AuthenticationRequiredError } from './errors';
import { createPassportProviders } from './module';
import { createPassportJsStrategyBridge } from './passport-js';
import type { AuthStrategy } from './types';

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
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
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
    },
    statusCode: 200,
  };
}

describe('AuthGuard', () => {
  it('can run a non-jwt strategy through the generic passport core', async () => {
    class MockStrategy implements AuthStrategy {
      async authenticate() {
        return {
          claims: { source: 'mock' },
          scopes: ['mock:read'],
          subject: 'mock-user',
        };
      }
    }

    @Controller('/profile')
    class ProtectedController {
      @Get('/')
      @UseAuth('mock')
      @RequireScopes('mock:read')
      getProfile(_input: unknown, ctx: { principal?: { subject: string } }) {
        return { subject: ctx.principal?.subject };
      }
    }

    const root = new Container().register(
      ProtectedController,
      MockStrategy,
      ...createPassportProviders({ defaultStrategy: 'mock' }, [{ name: 'mock', token: MockStrategy }]),
    );
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ProtectedController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/profile'), response);

    expect(response.body).toEqual({ subject: 'mock-user' });
  });

  it('maps authentication-required failures to a canonical 401 response', async () => {
    class MissingCredentialsStrategy implements AuthStrategy {
      async authenticate(_context: GuardContext): Promise<never> {
        throw new AuthenticationRequiredError();
      }
    }

    @Controller('/profile')
    class ProtectedController {
      @Get('/')
      @UseAuth('mock')
      getProfile() {
        return { ok: true };
      }
    }

    const root = new Container().register(
      ProtectedController,
      MissingCredentialsStrategy,
      ...createPassportProviders({ defaultStrategy: 'mock' }, [{ name: 'mock', token: MissingCredentialsStrategy }]),
    );
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ProtectedController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/profile'), response);

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        details: undefined,
        message: 'Authentication required.',
        meta: undefined,
        requestId: undefined,
        status: 401,
      },
    });
  });

  it('maps scope failures to a canonical 403 response', async () => {
    class ReadOnlyStrategy implements AuthStrategy {
      async authenticate() {
        return {
          claims: { scopes: ['profile:read'] },
          scopes: ['profile:read'],
          subject: 'mock-user',
        };
      }
    }

    @Controller('/profile')
    class ProtectedController {
      @Get('/')
      @UseAuth('mock')
      @RequireScopes('profile:write')
      getProfile() {
        return { ok: true };
      }
    }

    const root = new Container().register(
      ProtectedController,
      ReadOnlyStrategy,
      ...createPassportProviders({ defaultStrategy: 'mock' }, [{ name: 'mock', token: ReadOnlyStrategy }]),
    );
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ProtectedController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/profile'), response);

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({
      error: {
        code: 'FORBIDDEN',
        details: undefined,
        message: 'Access denied.',
        meta: undefined,
        requestId: undefined,
        status: 403,
      },
    });
  });

  it('adapts a Passport.js-style strategy success callback to principal population', async () => {
    class PassportLikeGoogleStrategy {
      success?: (user: unknown, info?: unknown) => void;

      authenticate() {
        this.success?.({
          email: 'google@example.com',
          id: 'google-user-1',
          scopes: ['profile:read'],
        });
      }
    }

    const googleBridge = createPassportJsStrategyBridge('google', PassportLikeGoogleStrategy);

    @Controller('/oauth')
    class ProtectedController {
      @Get('/profile')
      @UseAuth('google')
      getProfile(_input: unknown, ctx: { principal?: { subject: string } }) {
        return { subject: ctx.principal?.subject };
      }
    }

    const root = new Container().register(
      ProtectedController,
      PassportLikeGoogleStrategy,
      ...googleBridge.providers,
      ...createPassportProviders({ defaultStrategy: 'google' }, [googleBridge.strategy]),
    );
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ProtectedController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/oauth/profile'), response);

    expect(response.body).toEqual({ subject: 'google-user-1' });
  });

  it('supports Passport.js redirect flow without executing the protected handler', async () => {
    let handlerCalled = false;

    class PassportLikeGoogleStrategy {
      redirect?: (url: string, status?: number) => void;

      authenticate() {
        this.redirect?.('https://accounts.google.com/o/oauth2/v2/auth', 302);
      }
    }

    const googleBridge = createPassportJsStrategyBridge('google', PassportLikeGoogleStrategy);

    @Controller('/oauth')
    class LoginController {
      @Get('/google')
      @UseAuth('google')
      login() {
        handlerCalled = true;
        return { ok: true };
      }
    }

    const root = new Container().register(
      LoginController,
      PassportLikeGoogleStrategy,
      ...googleBridge.providers,
      ...createPassportProviders({ defaultStrategy: 'google' }, [googleBridge.strategy]),
    );
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: LoginController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/oauth/google'), response);

    expect(handlerCalled).toBe(false);
    expect(response.statusCode).toBe(302);
    expect(response.headers.Location).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  });
});
