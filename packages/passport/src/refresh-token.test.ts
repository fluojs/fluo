import { describe, expect, it, vi } from 'vitest';

import { AuthenticationExpiredError, AuthenticationFailedError, AuthenticationRequiredError } from './errors.js';
import { RefreshTokenStrategy, type RefreshTokenService } from './refresh-token.js';
import type { AuthStrategyResult } from './types.js';
import type { GuardContext, RequestContext } from '@konekti/http';

function createMockRefreshTokenService(overrides: Partial<RefreshTokenService> = {}): RefreshTokenService {
  return {
    issueRefreshToken: vi.fn().mockResolvedValue('mock-refresh-token'),
    rotateRefreshToken: vi.fn().mockResolvedValue({
      accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJpYXQiOjE1MTYyMzkwMjJ9.SflKxwRJSMeKKF2QT4fwpMfTLZfFJcKz6U6Jbc6GFcU',
      refreshToken: 'new-refresh-token',
    }),
    revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
    revokeAllForSubject: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
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
      const strategy = new RefreshTokenStrategy(service);
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
      const strategy = new RefreshTokenStrategy(service);
      const context = createGuardContext(undefined, { authorization: 'Bearer header-token' });

      const result = await strategy.authenticate(context);

      expect(result).toMatchObject({
        subject: 'user-1',
      });
      expect(service.rotateRefreshToken).toHaveBeenCalledWith('header-token');
    });

    it('authenticates with refresh token from custom header', async () => {
      const service = createMockRefreshTokenService();
      const strategy = new RefreshTokenStrategy(service);
      const context = createGuardContext(undefined, { 'x-refresh-token': 'custom-token' });

      const result = await strategy.authenticate(context);

      expect(result).toMatchObject({
        subject: 'user-1',
      });
      expect(service.rotateRefreshToken).toHaveBeenCalledWith('custom-token');
    });

    it('handles array authorization header by using first element', async () => {
      const service = createMockRefreshTokenService();
      const strategy = new RefreshTokenStrategy(service);
      const context = createGuardContext(undefined, { authorization: ['Bearer array-token', 'Bearer second-token'] });

      const result = await strategy.authenticate(context);

      expect(result).toMatchObject({
        subject: 'user-1',
      });
      expect(service.rotateRefreshToken).toHaveBeenCalledWith('array-token');
    });

    it('handles array x-refresh-token header by using first element', async () => {
      const service = createMockRefreshTokenService();
      const strategy = new RefreshTokenStrategy(service);
      const context = createGuardContext(undefined, { 'x-refresh-token': ['custom-array-token'] });

      const result = await strategy.authenticate(context);

      expect(result).toMatchObject({
        subject: 'user-1',
      });
      expect(service.rotateRefreshToken).toHaveBeenCalledWith('custom-array-token');
    });

    it('throws AuthenticationRequiredError when no token is provided', async () => {
      const service = createMockRefreshTokenService();
      const strategy = new RefreshTokenStrategy(service);
      const context = createGuardContext();

      await expect(strategy.authenticate(context)).rejects.toThrow(AuthenticationRequiredError);
    });

    it('throws AuthenticationExpiredError for expired tokens', async () => {
      const service = createMockRefreshTokenService({
        rotateRefreshToken: vi.fn().mockRejectedValue(new Error('Refresh token has expired.')),
      });
      const strategy = new RefreshTokenStrategy(service);
      const context = createGuardContext({ refreshToken: 'expired-token' });

      await expect(strategy.authenticate(context)).rejects.toThrow(AuthenticationExpiredError);
    });

    it('throws AuthenticationFailedError for reused tokens', async () => {
      const service = createMockRefreshTokenService({
        rotateRefreshToken: vi.fn().mockRejectedValue(new Error('Refresh token reuse detected.')),
      });
      const strategy = new RefreshTokenStrategy(service);
      const context = createGuardContext({ refreshToken: 'reused-token' });

      await expect(strategy.authenticate(context)).rejects.toThrow(AuthenticationFailedError);
    });

    it('throws AuthenticationFailedError for invalid tokens', async () => {
      const service = createMockRefreshTokenService({
        rotateRefreshToken: vi.fn().mockRejectedValue(new Error('Invalid token')),
      });
      const strategy = new RefreshTokenStrategy(service);
      const context = createGuardContext({ refreshToken: 'invalid-token' });

      await expect(strategy.authenticate(context)).rejects.toThrow(AuthenticationFailedError);
    });
  });

  describe('concurrent refresh attempts', () => {
    it('handles concurrent rotation attempts', async () => {
      const service = createMockRefreshTokenService();
      const strategy = new RefreshTokenStrategy(service);

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
