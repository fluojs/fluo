import { describe, expect, it } from 'vitest';

import { createTestApp, createTestingModule } from '@fluojs/testing';
import { KonektiFactory } from '@fluojs/runtime';
import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';

import { AppModule } from './app';
import { AuthService } from './auth/auth.service';
import { BearerJwtStrategy } from './auth/bearer.strategy';

function createRequest(
  method: FrameworkRequest['method'],
  path: string,
  body?: unknown,
  headers: FrameworkRequest['headers'] = {},
): FrameworkRequest {
  return {
    body,
    cookies: {},
    headers,
    method,
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

describe('AuthService', () => {
  it('issues bearer tokens for a subject', async () => {
    const module = await createTestingModule({ rootModule: AppModule }).compile();
    const service = await module.resolve(AuthService);

    await expect(service.issueToken('ada')).resolves.toMatchObject({
      accessToken: expect.any(String),
    });

  });
});

describe('BearerJwtStrategy', () => {
  it('requires a Bearer authorization header', async () => {
    const module = await createTestingModule({ rootModule: AppModule }).compile();
    const strategy = await module.resolve(BearerJwtStrategy);

    await expect(strategy.authenticate({
      handler: {} as never,
      requestContext: {
        container: module.container.createRequestScope(),
        metadata: {},
        request: createRequest('GET', '/profile/'),
        response: createResponse(),
      },
    })).rejects.toThrow('Authorization header is required.');

  });
});

describe('AppModule integration', () => {
  it('dispatches /health and /ready', async () => {
    const app = await KonektiFactory.create(AppModule, {});
    const healthRes = createResponse();
    const readyRes = createResponse();

    await app.dispatch(createRequest('GET', '/health'), healthRes);
    await app.dispatch(createRequest('GET', '/ready'), readyRes);

    expect(healthRes.body).toEqual({ status: 'ok' });
    expect(readyRes.body).toEqual({ status: 'ready' });

    await app.close();
  });

  it('issues a token and serves a protected profile route', async () => {
    const app = await KonektiFactory.create(AppModule, {});

    const loginRes = createResponse();
    await app.dispatch(createRequest('POST', '/auth/token', { username: 'ada' }), loginRes);
    const { accessToken } = loginRes.body as { accessToken: string };

    const profileRes = createResponse();
    await app.dispatch(createRequest('GET', '/profile/', undefined, {
      authorization: `Bearer ${accessToken}`,
    }), profileRes);

    expect(profileRes.body).toMatchObject({
      user: expect.objectContaining({
        scopes: ['profile:read'],
        subject: 'ada',
      }),
    });

    await app.close();
  });
});

describe('AppModule e2e', () => {
  it('returns 401 without a token and 201 with a valid token', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    await expect(app.dispatch({ method: 'GET', path: '/profile/' })).resolves.toMatchObject({
      status: 401,
    });

    const issueResult = await app.dispatch({
      method: 'POST',
      path: '/auth/token',
      body: { username: 'grace' },
    });
    expect(issueResult.status).toBe(201);

    const profileResult = await app.dispatch({
      headers: { authorization: `Bearer ${(issueResult.body as { accessToken: string }).accessToken}` },
      method: 'GET',
      path: '/profile/',
    });

    expect(profileResult.status).toBe(200);
    expect(profileResult.body).toMatchObject({
      user: expect.objectContaining({ subject: 'grace' }),
    });

    await app.close();
  });
});
