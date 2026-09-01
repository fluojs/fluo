import { describe, expect, it } from 'vitest';

import { createFastifyAdapter } from '@fluojs/platform-fastify';
import { FluoFactory } from '@fluojs/runtime';
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
    let testError: unknown;
    let testFailed = false;
    let disposeError: unknown;
    let disposeFailed = false;

    try {
      const service = await module.resolve(AuthService);

      await expect(service.issueToken('ada')).resolves.toMatchObject({
        accessToken: expect.any(String),
      });
    } catch (error: unknown) {
      testError = error;
      testFailed = true;
    } finally {
      try {
        await module.container.dispose();
      } catch (error: unknown) {
        disposeFailed = true;
        disposeError = error;
      }
    }

    if (testFailed) {
      if (disposeFailed) {
        throw new AggregateError(
          [testError, disposeError],
          'Test and testing module disposal both failed.',
        );
      }

      throw testError;
    }

    if (disposeFailed) {
      throw disposeError;
    }
  });
});

describe('BearerJwtStrategy', () => {
  it('requires a Bearer authorization header', async () => {
    const module = await createTestingModule({ rootModule: AppModule }).compile();
    let testError: unknown;
    let testFailed = false;
    let disposeError: unknown;
    let disposeFailed = false;

    try {
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
    } catch (error: unknown) {
      testError = error;
      testFailed = true;
    } finally {
      try {
        await module.container.dispose();
      } catch (error: unknown) {
        disposeFailed = true;
        disposeError = error;
      }
    }

    if (testFailed) {
      if (disposeFailed) {
        throw new AggregateError(
          [testError, disposeError],
          'Test and testing module disposal both failed.',
        );
      }

      throw testError;
    }

    if (disposeFailed) {
      throw disposeError;
    }
  });
});

describe('AppModule e2e', () => {
  it('boots the runnable Fastify application', async () => {
    const adapter = createFastifyAdapter({ port: 0 });
    const app = await FluoFactory.create(AppModule, { adapter });

    try {
      await app.listen();

      const server = adapter.getServer?.();
      if (!server || typeof (server as { address?: unknown }).address !== 'function') {
        throw new Error('Failed to resolve the runnable Fastify server.');
      }

      const address = (server as { address(): { port: number } | string | null }).address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to resolve the runnable Fastify port.');
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      expect(response.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('serves health, ready, and auth routes through createTestApp request helpers', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    try {
      await expect(app.request('GET', '/health').send()).resolves.toMatchObject({
        status: 200,
      });

      await expect(app.request('GET', '/ready').send()).resolves.toMatchObject({
        status: 200,
      });

      await expect(app.request('GET', '/profile/').send()).resolves.toMatchObject({
        headers: {
          'WWW-Authenticate': 'Bearer',
        },
        status: 401,
      });

      await expect(
        app
          .request('GET', '/profile/')
          .header('authorization', 'Bearer invalid-token')
          .send(),
      ).resolves.toMatchObject({
        headers: {
          'WWW-Authenticate': 'Bearer',
        },
        status: 401,
      });

      await expect(
        app
          .request('GET', '/profile/')
          .header(
            'authorization',
            'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJmbHVvLWF1dGgtZXhhbXBsZS1jbGllbnRzIiwiZXhwIjowLCJpc3MiOiJmbHVvLWF1dGgtZXhhbXBsZSIsInN1YiI6ImV4cGlyZWQifQ.sY5V1fydHfhYke1_1_TTcmYit8Nl5CfhknF2H3wTZUk',
          )
          .send(),
      ).resolves.toMatchObject({
        headers: {
          'WWW-Authenticate': 'Bearer',
        },
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
    } finally {
      await app.close();
    }
  });
});
