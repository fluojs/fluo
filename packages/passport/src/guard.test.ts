import { describe, expect, it } from 'vitest';

import { Controller, Get, UnauthorizedException, createDispatcher, createHandlerMapping } from '@konekti/http';
import type { FrameworkRequest, FrameworkResponse, GuardContext } from '@konekti/http';
import { Container } from '@konekti/di';

import { RequireScopes, UseAuth } from './decorators.js';
import { AuthenticationExpiredError, AuthenticationFailedError, AuthenticationRequiredError } from './errors.js';
import { createPassportProviders } from './module.js';
import { createPassportJsStrategyBridge } from './passport-js.js';
import type { AuthStrategy } from './types.js';

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
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
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

    await dispatcher.dispatch(createRequest('/profile', { 'x-request-id': 'req-auth-401' }), response);

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

    await dispatcher.dispatch(createRequest('/profile', { 'x-request-id': 'req-auth-401' }), response);

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        details: undefined,
        message: 'Authentication required.',
        meta: undefined,
        requestId: 'req-auth-401',
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

    await dispatcher.dispatch(createRequest('/profile', { 'x-request-id': 'req-auth-403' }), response);

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({
      error: {
        code: 'FORBIDDEN',
        details: undefined,
        message: 'Access denied.',
        meta: undefined,
        requestId: 'req-auth-403',
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

  it('maps authentication-failed errors to a canonical 401 response', async () => {
    class FailingStrategy implements AuthStrategy {
      async authenticate(_context: GuardContext): Promise<never> {
        throw new AuthenticationFailedError();
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
      FailingStrategy,
      ...createPassportProviders({ defaultStrategy: 'mock' }, [{ name: 'mock', token: FailingStrategy }]),
    );
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ProtectedController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/profile', { 'x-request-id': 'req-failed' }), response);

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        details: undefined,
        message: 'Authentication required.',
        meta: undefined,
        requestId: 'req-failed',
        status: 401,
      },
    });
  });

  it('maps authentication-expired errors to a canonical 401 response', async () => {
    class ExpiredStrategy implements AuthStrategy {
      async authenticate(_context: GuardContext): Promise<never> {
        throw new AuthenticationExpiredError();
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
      ExpiredStrategy,
      ...createPassportProviders({ defaultStrategy: 'mock' }, [{ name: 'mock', token: ExpiredStrategy }]),
    );
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ProtectedController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/profile', { 'x-request-id': 'req-expired' }), response);

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        details: undefined,
        message: 'Authentication required.',
        meta: undefined,
        requestId: 'req-expired',
        status: 401,
      },
    });
  });

  it('preserves the original auth error as the cause of UnauthorizedException', async () => {
    const originalError = new AuthenticationRequiredError();

    class FailingStrategy implements AuthStrategy {
      async authenticate(_context: GuardContext): Promise<never> {
        throw originalError;
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
      FailingStrategy,
      ...createPassportProviders({ defaultStrategy: 'mock' }, [{ name: 'mock', token: FailingStrategy }]),
    );
    const guardContext = {
      handler: {
        controllerToken: ProtectedController,
        methodName: 'getProfile',
      },
      requestContext: {
        container: root,
        principal: undefined,
        request: createRequest('/profile'),
        requestId: 'req-cause-direct',
        response: createResponse(),
      },
    } as unknown as GuardContext;

    const { AuthGuard } = await import('./guard.js');
    const guard = new AuthGuard(
      await root.resolve((await import('./types.js')).AUTH_STRATEGY_REGISTRY),
      await root.resolve((await import('./types.js')).PASSPORT_OPTIONS),
    );

    try {
      await guard.canActivate(guardContext);
      expect.unreachable('Expected canActivate to throw');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(UnauthorizedException);
      expect((thrown as Error).cause).toBe(originalError);
    }
  });
});
