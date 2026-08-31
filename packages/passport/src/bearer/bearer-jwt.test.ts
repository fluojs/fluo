import { describe, expect, it, vi } from 'vitest';

import type { GuardContext, Principal, RequestContext } from '@fluojs/http';
import {
  JwtConfigurationError,
  JwtExpiredTokenError,
  JwtInvalidTokenError,
} from '@fluojs/jwt';
import type { DefaultJwtVerifier } from '@fluojs/jwt';

import {
  AuthenticationExpiredError,
  AuthenticationFailedError,
  AuthenticationRequiredError,
} from '../errors.js';
import {
  BEARER_JWT_STRATEGY_NAME,
  BearerJwtStrategy,
  createBearerJwtStrategyRegistration,
} from './bearer-jwt.js';

const VERIFIED_PRINCIPAL: Principal = {
  audience: 'fluo-auth-example-clients',
  claims: {
    aud: 'fluo-auth-example-clients',
    iss: 'fluo-auth-example',
    roles: ['admin'],
    scope: 'profile:read',
    sub: 'user-1',
  },
  issuer: 'fluo-auth-example',
  roles: ['admin'],
  scopes: ['profile:read'],
  subject: 'user-1',
};

const CONTROL_CHARACTERS = [
  ...Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)),
  String.fromCharCode(127),
];

function createMockVerifier(overrides: Partial<DefaultJwtVerifier> = {}): DefaultJwtVerifier {
  return {
    verifyAccessToken: vi.fn().mockResolvedValue(VERIFIED_PRINCIPAL),
    ...overrides,
  } as unknown as DefaultJwtVerifier;
}

function createGuardContext(authorization: string | string[] | undefined): GuardContext {
  return {
    handler: {
      controllerToken: class {},
      methodName: 'test',
      metadata: {} as never,
      route: {} as never,
    },
    requestContext: {
      request: {
        headers: { authorization },
      } as unknown as RequestContext['request'],
      principal: undefined,
      container: {
        resolve: vi.fn(),
        dispose: vi.fn(),
      } as unknown as RequestContext['container'],
    } as RequestContext,
  };
}

describe('BearerJwtStrategy credential extraction', () => {
  it('returns the normalized verifier principal unchanged for a valid Bearer credential', async () => {
    const verifier = createMockVerifier();
    const strategy = new BearerJwtStrategy(verifier);

    const result = await strategy.authenticate(createGuardContext('Bearer valid-token'));

    expect(result).toBe(VERIFIED_PRINCIPAL);
    expect(verifier.verifyAccessToken).toHaveBeenCalledWith('valid-token');
  });

  it('accepts the Bearer scheme case-insensitively', async () => {
    const verifier = createMockVerifier();
    const strategy = new BearerJwtStrategy(verifier);

    const result = await strategy.authenticate(createGuardContext('bEaReR valid-token'));

    expect(result).toBe(VERIFIED_PRINCIPAL);
    expect(verifier.verifyAccessToken).toHaveBeenCalledWith('valid-token');
  });

  it('reads the first entry of an array-valued authorization header', async () => {
    const verifier = createMockVerifier();
    const strategy = new BearerJwtStrategy(verifier);

    const result = await strategy.authenticate(createGuardContext(['Bearer first-token', 'Bearer second-token']));

    expect(result).toBe(VERIFIED_PRINCIPAL);
    expect(verifier.verifyAccessToken).toHaveBeenCalledWith('first-token');
  });

  it('throws AuthenticationRequiredError when the first array authorization header entry is empty', async () => {
    const verifier = createMockVerifier();
    const strategy = new BearerJwtStrategy(verifier);

    await expect(
      strategy.authenticate(createGuardContext(['', 'Bearer valid-token'])),
    ).rejects.toThrow(AuthenticationRequiredError);
    expect(verifier.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('throws AuthenticationRequiredError when the authorization header is absent', async () => {
    const strategy = new BearerJwtStrategy(createMockVerifier());

    await expect(strategy.authenticate(createGuardContext(undefined))).rejects.toThrow(
      AuthenticationRequiredError,
    );
  });

  it('throws AuthenticationRequiredError when an empty authorization header entry resolves to no credentials', async () => {
    const strategy = new BearerJwtStrategy(createMockVerifier());

    await expect(strategy.authenticate(createGuardContext(''))).rejects.toThrow(
      AuthenticationRequiredError,
    );
    await expect(strategy.authenticate(createGuardContext([]))).rejects.toThrow(
      AuthenticationRequiredError,
    );
  });

  it('throws AuthenticationFailedError for a wrong authorization scheme', async () => {
    const strategy = new BearerJwtStrategy(createMockVerifier());

    await expect(strategy.authenticate(createGuardContext('Basic dXNlcjpwYXNz'))).rejects.toThrow(
      AuthenticationFailedError,
    );
  });

  it('throws AuthenticationFailedError for a malformed Bearer header without credentials', async () => {
    const strategy = new BearerJwtStrategy(createMockVerifier());

    await expect(strategy.authenticate(createGuardContext('Bearer'))).rejects.toThrow(
      AuthenticationFailedError,
    );
    await expect(strategy.authenticate(createGuardContext('Bearer   '))).rejects.toThrow(
      AuthenticationFailedError,
    );
  });

  it('throws AuthenticationFailedError for a malformed Bearer header with extra segments', async () => {
    const strategy = new BearerJwtStrategy(createMockVerifier());

    await expect(strategy.authenticate(createGuardContext('Bearer  token'))).rejects.toThrow(
      AuthenticationFailedError,
    );
    await expect(strategy.authenticate(createGuardContext('Bearer token extra'))).rejects.toThrow(
      AuthenticationFailedError,
    );
  });

  it('rejects HTAB as a Bearer separator before verification', async () => {
    const verifier = createMockVerifier();
    const strategy = new BearerJwtStrategy(verifier);

    await expect(strategy.authenticate(createGuardContext('Bearer\tvalid-token'))).rejects.toThrow(
      AuthenticationFailedError,
    );
    expect(verifier.verifyAccessToken).not.toHaveBeenCalled();
  });

  it.each(CONTROL_CHARACTERS)(
    'rejects control character %j in every header segment before verification',
    async (controlCharacter) => {
      const verifier = createMockVerifier();
      const strategy = new BearerJwtStrategy(verifier);

      await expect(
        strategy.authenticate(createGuardContext(`${controlCharacter}Bearer valid-token`)),
      ).rejects.toThrow(AuthenticationFailedError);
      await expect(
        strategy.authenticate(createGuardContext(`Bearer${controlCharacter}valid-token`)),
      ).rejects.toThrow(AuthenticationFailedError);
      await expect(
        strategy.authenticate(createGuardContext(`Bearer valid-token${controlCharacter}`)),
      ).rejects.toThrow(AuthenticationFailedError);

      expect(verifier.verifyAccessToken).not.toHaveBeenCalled();
    },
  );

  it('maps expired tokens to AuthenticationExpiredError and preserves the verifier cause', async () => {
    const jwtError = new JwtExpiredTokenError();
    const verifier = createMockVerifier({ verifyAccessToken: vi.fn().mockRejectedValue(jwtError) });
    const strategy = new BearerJwtStrategy(verifier);

    const failure = await strategy
      .authenticate(createGuardContext('Bearer expired-token'))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AuthenticationExpiredError);
    expect((failure as Error).cause).toBe(jwtError);
  });

  it('maps invalid tokens to AuthenticationFailedError and preserves the verifier cause', async () => {
    const jwtError = new JwtInvalidTokenError();
    const verifier = createMockVerifier({ verifyAccessToken: vi.fn().mockRejectedValue(jwtError) });
    const strategy = new BearerJwtStrategy(verifier);

    const failure = await strategy
      .authenticate(createGuardContext('Bearer invalid-token'))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AuthenticationFailedError);
    expect((failure as Error).cause).toBe(jwtError);
  });

  it('propagates JWT configuration errors unchanged', async () => {
    const jwtError = new JwtConfigurationError('JWT verification is not configured.');
    const verifier = createMockVerifier({ verifyAccessToken: vi.fn().mockRejectedValue(jwtError) });
    const strategy = new BearerJwtStrategy(verifier);

    const failure = await strategy
      .authenticate(createGuardContext('Bearer configured-token'))
      .catch((error: unknown) => error);

    expect(failure).toBe(jwtError);
  });

  it('propagates verifier infrastructure errors unchanged', async () => {
    const verifierError = new Error('JWKS provider is unavailable.');
    const verifier = createMockVerifier({ verifyAccessToken: vi.fn().mockRejectedValue(verifierError) });
    const strategy = new BearerJwtStrategy(verifier);

    const failure = await strategy
      .authenticate(createGuardContext('Bearer provider-token'))
      .catch((error: unknown) => error);

    expect(failure).toBe(verifierError);
  });
});

describe('BearerJwtStrategy registration', () => {
  it('registers the preset under the stable strategy name', () => {
    expect(BEARER_JWT_STRATEGY_NAME).toBe('jwt');
    expect(createBearerJwtStrategyRegistration()).toEqual({
      name: BEARER_JWT_STRATEGY_NAME,
      token: BearerJwtStrategy,
    });
  });
});
