import { describe, expect, it, vi } from 'vitest';

import type { DefaultJwtVerifier } from '@konekti/jwt';
import { JwtExpiredTokenError, JwtInvalidTokenError } from '@konekti/jwt';

import { AuthenticationExpiredError, AuthenticationFailedError, AuthenticationRequiredError } from './errors.js';
import { RefreshTokenStrategy, type RefreshTokenService } from './refresh-token.js';
import type { AuthStrategyResult } from './types.js';
import type { GuardContext, RequestContext } from '@konekti/http';

function createMockRefreshTokenService(overrides: Partial<RefreshTokenService> = {}): RefreshTokenService {
  return {
    issueRefreshToken: vi.fn().mockResolvedValue('mock-refresh-token'),
    rotateRefreshToken: vi.fn().mockResolvedValue({
      accessToken: 'mock-access-token',
      refreshToken: 'new-refresh-token',
    }),
    revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
    revokeAllForSubject: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockVerifier(subject = 'user-1'): DefaultJwtVerifier {
  return {
    verifyAccessToken: vi.fn().mockResolvedValue({ claims: { sub: subject } }),
    verifyRefreshToken: vi.fn().mockResolvedValue({ claims: { sub: subject } }),
  } as unknown as DefaultJwtVerifier;
}

function createGuardContext(body?: Record<string, unknown>, headers?: Record<string, string | string[]>): GuardContext {
  return {
    handler: {
      controllerToken: class {},
      methodName: 'test',
      metadata: {} as never,
      route: {} as never,
    },
    requestContext: {
      request: {
        body,
        headers: headers || {},
      } as RequestContext['request'],
      principal: undefined,
      container: {
        resolve: vi.fn(),
        dispose: vi.fn(),
      } as unknown as RequestContext['container'],
    } as RequestContext,
  };
}

describe('RefreshTokenStrategy', () => {
  describe('authenticate', () => {
    it('authenticates with refresh token from request body', async () => {
      const service = createMockRefreshTokenService();
      const strategy = new RefreshTokenStrategy(service, createMockVerifier());
      const context = createGuardContext({ refreshToken: 'valid-token' });

      const result = await strategy.authenticate(context);

      expect(result).toMatchObject({
        subject: 'user-1',
        claims: {
          accessToken: expect.any(String),
          refreshToken: 'new-refresh-token',
        },
      });
      expect(service.rotateRefreshToken).toHaveBeenCalledWith('valid-token');
    });

    it('authenticates with refresh token from authorization header', async () => {
      const service = createMockRefreshTokenService();
      const strategy = new RefreshTokenStrategy(service, createMockVerifier());
      const context = createGuardContext(undefined, { authorization: 'Bearer header-token' });

      const result = await strategy.authenticate(context);

      expect(result).toMatchObject({
        subject: 'user-1',
      });
      expect(service.rotateRefreshToken).toHaveBeenCalledWith('header-token');
    });

    it('accepts lowercase bearer scheme in authorization header', async () => {
      const service = createMockRefreshTokenService();
      const strategy = new RefreshTokenStrategy(service, createMockVerifier());
      const context = createGuardContext(undefined, { authorization: 'bearer lowercase-token' });

      const result = await strategy.authenticate(context);

      expect(result).toMatchObject({
        subject: 'user-1',
      });
      expect(service.rotateRefreshToken).toHaveBeenCalledWith('lowercase-token');
    });

    it('authenticates with refresh token from custom header', async () => {
      const service = createMockRefreshTokenService();
      const strategy = new RefreshTokenStrategy(service, createMockVerifier());
      const context = createGuardContext(undefined, { 'x-refresh-token': 'custom-token' });

      const result = await strategy.authenticate(context);

      expect(result).toMatchObject({
        subject: 'user-1',
      });
      expect(service.rotateRefreshToken).toHaveBeenCalledWith('custom-token');
    });

    it('handles array authorization header by using first element', async () => {
      const service = createMockRefreshTokenService();
      const strategy = new RefreshTokenStrategy(service, createMockVerifier());
      const context = createGuardContext(undefined, { authorization: ['Bearer array-token', 'Bearer second-token'] });

      const result = await strategy.authenticate(context);

      expect(result).toMatchObject({
        subject: 'user-1',
      });
      expect(service.rotateRefreshToken).toHaveBeenCalledWith('array-token');
    });

    it('handles array x-refresh-token header by using first element', async () => {
      const service = createMockRefreshTokenService();
      const strategy = new RefreshTokenStrategy(service, createMockVerifier());
      const context = createGuardContext(undefined, { 'x-refresh-token': ['custom-array-token'] });

      const result = await strategy.authenticate(context);

      expect(result).toMatchObject({
        subject: 'user-1',
      });
      expect(service.rotateRefreshToken).toHaveBeenCalledWith('custom-array-token');
    });

    it('throws AuthenticationRequiredError when no token is provided', async () => {
      const service = createMockRefreshTokenService();
      const strategy = new RefreshTokenStrategy(service, createMockVerifier());
      const context = createGuardContext();

      await expect(strategy.authenticate(context)).rejects.toThrow(AuthenticationRequiredError);
    });

    it('throws AuthenticationExpiredError for expired tokens', async () => {
      const originalError = new JwtExpiredTokenError('Refresh token has expired.');
      const service = createMockRefreshTokenService({
        rotateRefreshToken: vi.fn().mockRejectedValue(originalError),
      });
      const strategy = new RefreshTokenStrategy(service, createMockVerifier());
      const context = createGuardContext({ refreshToken: 'expired-token' });

      try {
        await strategy.authenticate(context);
        expect.unreachable('Expected authenticate() to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationExpiredError);
        expect((error as Error).cause).toBe(originalError);
      }
    });

    it('throws AuthenticationFailedError for reused tokens', async () => {
      const originalError = new JwtInvalidTokenError('Refresh token reuse detected.');
      const service = createMockRefreshTokenService({
        rotateRefreshToken: vi.fn().mockRejectedValue(originalError),
      });
      const strategy = new RefreshTokenStrategy(service, createMockVerifier());
      const context = createGuardContext({ refreshToken: 'reused-token' });

      try {
        await strategy.authenticate(context);
        expect.unreachable('Expected authenticate() to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationFailedError);
        expect((error as Error).cause).toBe(originalError);
      }
    });

    it('throws AuthenticationFailedError for invalid tokens', async () => {
      const service = createMockRefreshTokenService({
        rotateRefreshToken: vi.fn().mockRejectedValue(new JwtInvalidTokenError('Invalid token')),
      });
      const strategy = new RefreshTokenStrategy(service, createMockVerifier());
      const context = createGuardContext({ refreshToken: 'invalid-token' });

      await expect(strategy.authenticate(context)).rejects.toThrow(AuthenticationFailedError);
    });

    it('rethrows refresh token infrastructure failures without converting them to auth failures', async () => {
      const originalError = new Error('refresh store unavailable');
      const service = createMockRefreshTokenService({
        rotateRefreshToken: vi.fn().mockRejectedValue(originalError),
      });
      const strategy = new RefreshTokenStrategy(service, createMockVerifier());
      const context = createGuardContext({ refreshToken: 'valid-token' });

      await expect(strategy.authenticate(context)).rejects.toBe(originalError);
    });

    it('rethrows access token verification failures without converting them to auth failures', async () => {
      const originalError = new JwtInvalidTokenError('Invalid access token');
      const service = createMockRefreshTokenService();
      const verifier = createMockVerifier();
      vi.mocked(verifier.verifyAccessToken).mockRejectedValue(originalError);
      const strategy = new RefreshTokenStrategy(service, verifier);
      const context = createGuardContext({ refreshToken: 'valid-token' });

      await expect(strategy.authenticate(context)).rejects.toBe(originalError);
    });

    it('treats missing subject claims in rotated access tokens as internal contract failures', async () => {
      const service = createMockRefreshTokenService();
      const verifier = createMockVerifier('');
      const strategy = new RefreshTokenStrategy(service, verifier);
      const context = createGuardContext({ refreshToken: 'valid-token' });

      await expect(strategy.authenticate(context)).rejects.toThrow(
        'Refresh token service returned an access token without a valid subject claim.',
      );
    });
  });

  describe('concurrent refresh attempts', () => {
    it('handles concurrent rotation attempts', async () => {
      const service = createMockRefreshTokenService();
      const strategy = new RefreshTokenStrategy(service, createMockVerifier());

      const [first, second] = await Promise.allSettled([
        strategy.authenticate(createGuardContext({ refreshToken: 'token-1' })),
        strategy.authenticate(createGuardContext({ refreshToken: 'token-1' })),
      ]);

      const fulfilled = [first, second].filter(
        (result): result is PromiseFulfilledResult<AuthStrategyResult> => result.status === 'fulfilled',
      );
      const rejected = [first, second].filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(2);
      expect(rejected).toHaveLength(0);
    });
  });
});

describe('RefreshTokenService contract', () => {
  it('issues refresh tokens for subjects', async () => {
    const service = createMockRefreshTokenService();
    const token = await service.issueRefreshToken('user-1');

    expect(token).toBe('mock-refresh-token');
    expect(service.issueRefreshToken).toHaveBeenCalledWith('user-1');
  });

  it('rotates refresh tokens and returns new tokens', async () => {
    const service = createMockRefreshTokenService();
    const result = await service.rotateRefreshToken('old-token');

    expect(result).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: 'new-refresh-token',
    });
    expect(service.rotateRefreshToken).toHaveBeenCalledWith('old-token');
  });

  it('revokes specific refresh tokens', async () => {
    const service = createMockRefreshTokenService();
    await service.revokeRefreshToken('token-id');

    expect(service.revokeRefreshToken).toHaveBeenCalledWith('token-id');
  });

  it('revokes all tokens for a subject (logout)', async () => {
    const service = createMockRefreshTokenService();
    await service.revokeAllForSubject('user-1');

    expect(service.revokeAllForSubject).toHaveBeenCalledWith('user-1');
  });
});
