import { Test } from '@fluojs/testing';
import { JwtService } from '@fluojs/jwt';
import { describe, expect, it } from 'vitest';

import { AuthModule } from './passport-guide-app';

/**
 * Composition fixture for apps/docs/content/docs/packages/passport.mdx.
 *
 * Drives the real guard pipeline through Test.createApp: bearer preset
 * authentication and scope enforcement, canonical 401/403 envelopes,
 * WWW-Authenticate challenges, optional-auth routes, and a custom
 * AuthStrategy registered under its own name.
 */

function headerValue(headers: Record<string, string | string[]>, name: string): string | undefined {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = match?.[1];
  return Array.isArray(value) ? value[0] : value;
}

async function mintAccessToken(scopes: string[], subject = 'u1'): Promise<string> {
  const module = await Test.createTestingModule({ rootModule: AuthModule }).compile();

  try {
    const jwt = await module.resolve(JwtService);
    return await jwt.sign({ scopes }, { subject });
  } finally {
    await module.container.dispose();
  }
}

describe('package-guides passport composition', () => {
  it('rejects an anonymous caller with 401 and a bare bearer challenge', async () => {
    const app = await Test.createApp({ rootModule: AuthModule });

    try {
      const response = await app.request('GET', '/profile').send();

      expect(response.status).toBe(401);
      expect(headerValue(response.headers, 'WWW-Authenticate')).toBe('Bearer');
    } finally {
      await app.close();
    }
  });

  it('admits a valid bearer token and writes the principal to the context', async () => {
    const app = await Test.createApp({ rootModule: AuthModule });
    const token = await mintAccessToken(['profile:read']);

    try {
      const response = await app.request('GET', '/profile').header('Authorization', `Bearer ${token}`).send();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ user: 'u1', scopes: ['profile:read'] });
    } finally {
      await app.close();
    }
  });

  it('returns 403 when the principal lacks a required scope', async () => {
    const app = await Test.createApp({ rootModule: AuthModule });
    const token = await mintAccessToken(['other:scope']);

    try {
      const response = await app.request('GET', '/profile').header('Authorization', `Bearer ${token}`).send();

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ error: { code: 'FORBIDDEN', status: 403 } });
    } finally {
      await app.close();
    }
  });

  it('maps an expired token to 401 with an invalid_token challenge', async () => {
    const module = await Test.createTestingModule({ rootModule: AuthModule }).compile();

    let expiredToken: string;
    try {
      const jwt = await module.resolve(JwtService);
      expiredToken = await jwt.sign(
        { scopes: ['profile:read'], exp: Math.floor(Date.now() / 1000) - 10 },
        { subject: 'u1' },
      );
    } finally {
      await module.container.dispose();
    }

    const app = await Test.createApp({ rootModule: AuthModule });

    try {
      const response = await app.request('GET', '/profile').header('Authorization', `Bearer ${expiredToken}`).send();

      expect(response.status).toBe(401);
      expect(headerValue(response.headers, 'WWW-Authenticate')).toBe('Bearer error="invalid_token"');
    } finally {
      await app.close();
    }
  });

  it('rejects a malformed authorization header as a credential failure', async () => {
    const app = await Test.createApp({ rootModule: AuthModule });

    try {
      const response = await app.request('GET', '/profile').header('Authorization', 'Basic dXNlcjpwYXNz').send();

      expect(response.status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('keeps optional-auth bearer routes 401 for anonymous callers and 200 for token callers', async () => {
    const app = await Test.createApp({ rootModule: AuthModule });
    const token = await mintAccessToken([]);

    try {
      // The bearer preset raises AuthenticationRequiredError for missing
      // credentials instead of reporting them, so @UseOptionalAuth cannot
      // bypass the 401 — that pass-through requires a strategy such as the
      // cookie preset that resolves to { authenticated: false }.
      const anonymous = await app.request('GET', '/session').send();
      expect(anonymous.status).toBe(401);

      const authenticated = await app.request('GET', '/session').header('Authorization', `Bearer ${token}`).send();
      expect(authenticated.status).toBe(200);
      expect(authenticated.body).toEqual({ subject: 'u1' });
    } finally {
      await app.close();
    }
  });

  it('authenticates the custom api-key strategy through the same guard', async () => {
    const app = await Test.createApp({ rootModule: AuthModule });

    try {
      const denied = await app.request('GET', '/service').send();
      expect(denied.status).toBe(401);

      const admitted = await app.request('GET', '/service').header('x-api-key', 'guide-service-key').send();
      expect(admitted.status).toBe(200);
      expect(admitted.body).toEqual({ caller: 'service-1' });
    } finally {
      await app.close();
    }
  });

  it('surfaces an unregistered strategy name as a server error, not a 401', async () => {
    const app = await Test.createApp({ rootModule: AuthModule });

    try {
      const response = await app.request('GET', '/unregistered').send();

      // AuthStrategyResolutionError is a wiring defect and must not be
      // classified as an authentication failure.
      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({ error: { code: 'INTERNAL_SERVER_ERROR', status: 500 } });
    } finally {
      await app.close();
    }
  });
});
