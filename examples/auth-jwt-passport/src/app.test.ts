import { describe, expect, it } from 'vitest';

import { createTestApp, createTestingModule } from '@fluojs/testing';
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

describe('AppModule e2e', () => {
  it('serves health, ready, and auth routes through createTestApp request helpers', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    await expect(app.request('GET', '/health').send()).resolves.toMatchObject({
      status: 200,
    });

    await expect(app.request('GET', '/ready').send()).resolves.toMatchObject({
      status: 200,
    });

    await expect(app.request('GET', '/profile/').send()).resolves.toMatchObject({
      status: 401,
    });

    const issueResult = await app
      .request('POST', '/auth/token')
      .body({ username: 'grace' })
      .send();
    expect(issueResult.status).toBe(201);

    const profileResult = await app
      .request('GET', '/profile/')
      .header('authorization', `Bearer ${(issueResult.body as { accessToken: string }).accessToken}`)
      .send();

    expect(profileResult.status).toBe(200);
    expect(profileResult.body).toMatchObject({
      user: expect.objectContaining({ subject: 'grace' }),
    });

    await app.close();
  });
});
