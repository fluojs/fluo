import { Test, type TestApp } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';
import { RedisThrottlerStore, type RedisThrottlerClient } from '@fluojs/throttler';

import { SecurityAppModule } from './security-guide-app';

/**
 * Cross-package composition fixture for the security guides
 * (apps/docs/content/docs/packages/{jwt,passport,throttler}.mdx).
 *
 * Exercises the credential lifecycle end to end through the real pipeline:
 * login mints an access/refresh pair (JWT + RefreshTokenService), the refresh
 * strategy rotates it and detects replay, the bearer strategy admits the
 * minted access token, and the throttler bounds the credential routes with
 * per-client buckets. The Redis store test covers the structural client
 * contract, not a live Redis server.
 */

interface LoginPair {
  accessToken: string;
  refreshToken: string;
  subject: string;
}

function headerValue(headers: Record<string, string | string[]>, name: string): string | undefined {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = match?.[1];
  return Array.isArray(value) ? value[0] : value;
}

async function login(app: TestApp, apiKey: string) {
  const response = await app.request('POST', '/auth/login').header('x-api-key', apiKey).send();
  expect(response.status).toBe(201);

  return response.body as LoginPair;
}

describe('package-guides security composition', () => {
  it('mints a token pair on login and admits the access token on the scoped route', async () => {
    const app = await Test.createApp({ rootModule: SecurityAppModule });

    try {
      const pair = await login(app, 'client-a');

      expect(pair.subject).toBe('session-user');

      const profile = await app.request('GET', '/profile').header('Authorization', `Bearer ${pair.accessToken}`).send();
      expect(profile.status).toBe(200);
      expect(profile.body).toEqual({ user: 'session-user' });
    } finally {
      await app.close();
    }
  });

  it('rotates the refresh token and detects replay of the consumed token', async () => {
    const app = await Test.createApp({ rootModule: SecurityAppModule });

    try {
      const first = await login(app, 'client-a');

      const rotated = await app
        .request('POST', '/auth/refresh')
        .header('x-api-key', 'client-a')
        .body({ refreshToken: first.refreshToken })
        .send();
      expect(rotated.status).toBe(201);

      const pair = rotated.body as LoginPair;
      expect(pair.subject).toBe('session-user');
      expect(pair.refreshToken).not.toBe(first.refreshToken);
      expect(pair.accessToken).not.toBe(first.accessToken);

      // Replaying the consumed token revokes the whole family.
      const replay = await app
        .request('POST', '/auth/refresh')
        .header('x-api-key', 'client-a')
        .body({ refreshToken: first.refreshToken })
        .send();
      expect(replay.status).toBe(401);

      // The rotated successor was revoked with the compromised family.
      const successor = await app
        .request('POST', '/auth/refresh')
        .header('x-api-key', 'client-a')
        .body({ refreshToken: pair.refreshToken })
        .send();
      expect(successor.status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('rejects an unknown refresh token as a credential failure', async () => {
    const app = await Test.createApp({ rootModule: SecurityAppModule });

    try {
      const response = await app
        .request('POST', '/auth/refresh')
        .header('x-api-key', 'client-a')
        .body({ refreshToken: 'not-a-real-refresh-token' })
        .send();

      expect(response.status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 429 with Retry-After once the login budget is spent, per client', async () => {
    const app = await Test.createApp({ rootModule: SecurityAppModule });

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const allowed = await app.request('POST', '/auth/login').header('x-api-key', 'client-a').send();
        expect(allowed.status).toBe(201);
      }

      const rejected = await app.request('POST', '/auth/login').header('x-api-key', 'client-a').send();
      expect(rejected.status).toBe(429);
      const retryAfter = headerValue(rejected.headers, 'Retry-After');
      expect(retryAfter).toBeDefined();
      expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);

      // Bucket isolation: a different client key still has its own budget.
      const otherClient = await app.request('POST', '/auth/login').header('x-api-key', 'client-b').send();
      expect(otherClient.status).toBe(201);

      // Skipped routes are unaffected by exhausted buckets.
      const skipped = await app.request('GET', '/meta/providers').header('x-api-key', 'client-a').send();
      expect(skipped.status).toBe(200);
      expect(skipped.body).toEqual({ providers: ['password'] });
    } finally {
      await app.close();
    }
  });

  it('throws instead of collapsing clients when the key generator has no identity', async () => {
    const app = await Test.createApp({ rootModule: SecurityAppModule });

    try {
      const response = await app.request('POST', '/auth/login').send();

      expect(response.status).toBe(500);
    } finally {
      await app.close();
    }
  });

  it('parses the Redis consume script result through the structural client contract', async () => {
    const evalCalls: Array<{ script: string; numberOfKeys: number; args: string[] }> = [];
    const client = {
      eval: async (script: string, numberOfKeys: number, ...args: string[]) => {
        evalCalls.push({ script, numberOfKeys, args });
        return [2, 1_710_000_060_000, 60_000];
      },
    } satisfies RedisThrottlerClient;

    const store = new RedisThrottlerStore(client);
    const entry = await store.consume('throttler:guide-bucket', { now: 1_710_000_000_000, ttlSeconds: 60 });

    expect(entry).toEqual({ count: 2, resetAt: 1_710_000_060_000, retryAfterMs: 60_000 });
    expect(evalCalls).toHaveLength(1);
    expect(evalCalls[0]?.numberOfKeys).toBe(1);
    expect(evalCalls[0]?.args).toEqual(['throttler:guide-bucket', '60000']);
    expect(evalCalls[0]?.script).toContain("redis.call('TIME')");
    expect(evalCalls[0]?.script).toContain("'PX', ttlMsLeft");
  });
});
