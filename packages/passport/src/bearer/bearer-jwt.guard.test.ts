import { describe, expect, it, vi } from 'vitest';

import { getModuleMetadata } from '@fluojs/core/internal';
import { Controller, Get, createDispatcher, createHandlerMapping } from '@fluojs/http';
import type { FrameworkRequest, FrameworkResponse, Principal } from '@fluojs/http';
import { Container, type Provider } from '@fluojs/di';
import { DefaultJwtVerifier, JwtConfigurationError, JwtInvalidTokenError } from '@fluojs/jwt';

import { RequireScopes, UseAuth } from '../decorators.js';
import { PassportModule } from '../module.js';
import {
  BEARER_JWT_STRATEGY_NAME,
  BearerJwtStrategy,
  createBearerJwtStrategyRegistration,
} from './bearer-jwt.js';

const VERIFIED_PRINCIPAL: Principal = {
  claims: { sub: 'user-1' },
  scopes: ['profile:read'],
  subject: 'user-1',
};

function createMockVerifier(overrides: Partial<DefaultJwtVerifier> = {}): DefaultJwtVerifier {
  return {
    verifyAccessToken: vi.fn().mockResolvedValue(VERIFIED_PRINCIPAL),
    ...overrides,
  } as unknown as DefaultJwtVerifier;
}

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

function createGuardedDispatcher(verifier: DefaultJwtVerifier) {
  @Controller('/profile')
  class ProtectedController {
    @Get('/')
    @UseAuth(BEARER_JWT_STRATEGY_NAME)
    @RequireScopes('profile:read')
    getProfile(_input: unknown, ctx: { principal?: Principal }) {
      return { subject: ctx.principal?.subject };
    }
  }

  const root = new Container().register(
    ProtectedController,
    BearerJwtStrategy,
    { provide: DefaultJwtVerifier, useValue: verifier },
    ...createPassportModuleProviders(
      { defaultStrategy: BEARER_JWT_STRATEGY_NAME },
      [createBearerJwtStrategyRegistration()],
    ),
  );

  return createDispatcher({
    handlerMapping: createHandlerMapping([{ controllerToken: ProtectedController }]),
    rootContainer: root,
  });
}

describe('BearerJwtStrategy AuthGuard integration', () => {
  it('maps a missing bearer credential to the canonical 401 response', async () => {
    const dispatcher = createGuardedDispatcher(createMockVerifier());
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/profile', { 'x-request-id': 'req-bearer-401' }), response);

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        details: undefined,
        message: 'Authentication required.',
        meta: undefined,
        requestId: 'req-bearer-401',
        status: 401,
      },
    });
  });

  it('maps an invalid bearer credential to the canonical 401 response', async () => {
    const dispatcher = createGuardedDispatcher(
      createMockVerifier({ verifyAccessToken: vi.fn().mockRejectedValue(new JwtInvalidTokenError()) }),
    );
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/profile', { authorization: 'Bearer invalid-token' }), response);

    expect(response.statusCode).toBe(401);
  });

  it('maps an HTAB-separated bearer credential to the canonical 401 response without verification', async () => {
    const verifier = createMockVerifier();
    const dispatcher = createGuardedDispatcher(verifier);
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/profile', { authorization: 'Bearer\tinvalid-token' }), response);

    expect(response.statusCode).toBe(401);
    expect(verifier.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('does not map a JWT configuration error to 401', async () => {
    const dispatcher = createGuardedDispatcher(
      createMockVerifier({
        verifyAccessToken: vi.fn().mockRejectedValue(new JwtConfigurationError('JWT verification is not configured.')),
      }),
    );
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/profile', { authorization: 'Bearer configured-token' }), response);

    expect(response.statusCode).toBe(500);
  });

  it('does not map a verifier infrastructure error to 401', async () => {
    const dispatcher = createGuardedDispatcher(
      createMockVerifier({
        verifyAccessToken: vi.fn().mockRejectedValue(new Error('JWKS provider is unavailable.')),
      }),
    );
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/profile', { authorization: 'Bearer provider-token' }), response);

    expect(response.statusCode).toBe(500);
  });

  it('assigns the authenticated principal and allows scope-matching requests', async () => {
    const dispatcher = createGuardedDispatcher(createMockVerifier());
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/profile', { authorization: 'Bearer valid-token' }), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ subject: 'user-1' });
  });

  it.each([
    ['Authorization', { Authorization: ['Bearer first-token', 'Bearer second-token'] }],
    ['aUtHoRiZaTiOn', { aUtHoRiZaTiOn: ['Bearer first-token', 'Bearer second-token'] }],
  ])('reads the first Bearer credential from a %s request header', async (_headerName, headers) => {
    const verifier = createMockVerifier();
    const dispatcher = createGuardedDispatcher(verifier);
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/profile', headers), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ subject: 'user-1' });
    expect(verifier.verifyAccessToken).toHaveBeenCalledWith('first-token');
  });

  it('does not fall back from an empty uppercase Authorization array entry', async () => {
    const verifier = createMockVerifier();
    const dispatcher = createGuardedDispatcher(verifier);
    const response = createResponse();

    await dispatcher.dispatch(
      createRequest('/profile', { Authorization: ['', 'Bearer second-token'] }),
      response,
    );

    expect(response.statusCode).toBe(401);
    expect(response.headers['WWW-Authenticate']).toBe('Bearer');
    expect(verifier.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects scope mismatches with 403 after authentication succeeds', async () => {
    const dispatcher = createGuardedDispatcher(
      createMockVerifier({
        verifyAccessToken: vi.fn().mockResolvedValue({
          claims: { sub: 'user-1' },
          scopes: [],
          subject: 'user-1',
        }),
      }),
    );
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/profile', { authorization: 'Bearer valid-token' }), response);

    expect(response.statusCode).toBe(403);
  });
});
