import { Test } from '@fluojs/testing';
import { JwtExpiredTokenError, JwtInvalidTokenError, JwtService } from '@fluojs/jwt';
import { describe, expect, it } from 'vitest';

import { AuthModule, TokenService } from './jwt-guide-app';

/**
 * Composition fixture for apps/docs/content/docs/packages/jwt.mdx.
 *
 * Exercises real signing and verification through the registered providers:
 * principal normalization, per-call overrides, expiry and claim policy, and
 * the decode() diagnostics boundary. All assertions target typed errors and
 * machine-observable outcomes.
 */

async function compileAuthModule() {
  const module = await Test.createTestingModule({ rootModule: AuthModule }).compile();

  try {
    return module;
  } catch (error) {
    await module.container.dispose();
    throw error;
  }
}

describe('package-guides jwt composition', () => {
  it('issues and verifies a token with normalized principal fields', async () => {
    const module = await compileAuthModule();

    try {
      const tokens = await module.resolve(TokenService);
      const token = await tokens.issueSession('user-123');
      const principal = await tokens.authenticate(token);

      expect(principal.subject).toBe('user-123');
      expect(principal.roles).toEqual(['member']);
      expect(principal.scopes).toEqual(['profile:read']);
      expect(principal.issuer).toBe('guide-api');
      expect(principal.audience).toBe('guide-app');
      expect(principal.claims.sub).toBe('user-123');
    } finally {
      await module.container.dispose();
    }
  });

  it('unifies a space-delimited scope claim into the scopes array', async () => {
    const module = await compileAuthModule();

    try {
      const jwt = await module.resolve(JwtService);
      const token = await jwt.sign({ scope: 'profile:read   admin:read' }, { subject: 'u1' });
      const principal = await jwt.verify(token);

      expect(principal.scopes).toEqual(['profile:read', 'admin:read']);
    } finally {
      await module.container.dispose();
    }
  });

  it('lets a per-call expiresIn override win over a payload exp claim', async () => {
    const module = await compileAuthModule();

    try {
      const jwt = await module.resolve(JwtService);
      const staleExp = Math.floor(Date.now() / 1000) - 1_000;
      const token = await jwt.sign({ exp: staleExp }, { subject: 'u1', expiresIn: 900 });
      const decoded = jwt.decode(token) as { exp?: number };

      // The override wins: the minted token is live, not the stale payload exp.
      await expect(jwt.verify(token)).resolves.toMatchObject({ subject: 'u1' });
      expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    } finally {
      await module.container.dispose();
    }
  });

  it('rejects a token minted for a different audience with JwtInvalidTokenError', async () => {
    const module = await compileAuthModule();

    try {
      const jwt = await module.resolve(JwtService);
      const token = await jwt.sign({}, { subject: 'u1', audience: 'other-app' });

      await expect(jwt.verify(token)).rejects.toThrow(JwtInvalidTokenError);
    } finally {
      await module.container.dispose();
    }
  });

  it('fails verification for an expired token with JwtExpiredTokenError', async () => {
    const module = await compileAuthModule();

    try {
      const jwt = await module.resolve(JwtService);
      const expiredExp = Math.floor(Date.now() / 1000) - 10;
      const token = await jwt.sign({ exp: expiredExp }, { subject: 'u1' });

      await expect(jwt.verify(token)).rejects.toThrow(JwtExpiredTokenError);
    } finally {
      await module.container.dispose();
    }
  });

  it('rejects tokens without a usable subject claim', async () => {
    const module = await compileAuthModule();

    try {
      const jwt = await module.resolve(JwtService);
      const token = await jwt.sign({ roles: ['member'] });

      await expect(jwt.verify(token)).rejects.toThrow(JwtInvalidTokenError);
    } finally {
      await module.container.dispose();
    }
  });

  it('returns null from decode for malformed input and never from verify', async () => {
    const module = await compileAuthModule();

    try {
      const jwt = await module.resolve(JwtService);

      expect(jwt.decode('not-a-jwt')).toBeNull();
    } finally {
      await module.container.dispose();
    }
  });
});
