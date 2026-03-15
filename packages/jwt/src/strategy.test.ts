import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  AuthenticationExpiredError,
  AuthenticationFailedError,
  AuthenticationRequiredError,
} from '@konekti/passport';

import { DefaultJwtVerifier } from './verifier.js';
import { JwtStrategy } from './strategy.js';

type GuardContext = Parameters<JwtStrategy['authenticate']>[0];

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signToken(payload: Record<string, unknown>, secret: string): string {
  const headerSegment = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadSegment = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${headerSegment}.${payloadSegment}.${signature}`;
}

function createContext(authorization?: string): GuardContext {
  return {
    handler: {
      controllerToken: class TestController {},
      metadata: {
        controllerPath: '/profile',
        effectivePath: '/profile',
        moduleMiddleware: [],
        pathParams: [],
      },
      methodName: 'getProfile',
      route: {
        method: 'GET',
        path: '/profile',
      },
    },
    requestContext: {
      container: {} as GuardContext['requestContext']['container'],
      metadata: {},
      request: {
        body: undefined,
        cookies: {},
        headers: authorization ? { authorization } : {},
        method: 'GET',
        params: {},
        path: '/profile',
        query: {},
        raw: {},
        url: '/profile',
      },
      response: {
        committed: false,
        headers: {},
        redirect() {},
        send() {},
        setHeader() {},
        setStatus() {},
        statusCode: 200,
      },
    },
  };
}

describe('JwtStrategy', () => {
  it('authenticates a valid bearer token through the generic passport contract', async () => {
    const strategy = new JwtStrategy(
      new DefaultJwtVerifier({
        algorithms: ['HS256'],
        audience: 'starter-app',
        issuer: 'starter-app',
        secret: 'starter-secret',
      }),
    );
    const token = signToken(
      {
        aud: 'starter-app',
        exp: Math.floor(Date.now() / 1000) + 60,
        iss: 'starter-app',
        scope: 'profile:read',
        sub: 'starter-user',
      },
      'starter-secret',
    );

    await expect(strategy.authenticate(createContext(`Bearer ${token}`))).resolves.toEqual(
      expect.objectContaining({
        scopes: ['profile:read'],
        subject: 'starter-user',
      }),
    );
  });

  it('maps a missing token to AuthenticationRequiredError', async () => {
    const strategy = new JwtStrategy(new DefaultJwtVerifier({ algorithms: ['HS256'], secret: 'starter-secret' }));

    await expect(strategy.authenticate(createContext())).rejects.toBeInstanceOf(AuthenticationRequiredError);
  });

  it('maps expired and invalid JWTs to passport auth errors', async () => {
    const strategy = new JwtStrategy(
      new DefaultJwtVerifier({
        algorithms: ['HS256'],
        audience: 'starter-app',
        issuer: 'starter-app',
        secret: 'starter-secret',
      }),
    );
    const expiredToken = signToken(
      {
        aud: 'starter-app',
        exp: Math.floor(Date.now() / 1000) - 60,
        iss: 'starter-app',
        sub: 'starter-user',
      },
      'starter-secret',
    );
    const invalidToken = signToken(
      {
        aud: 'starter-app',
        exp: Math.floor(Date.now() / 1000) + 60,
        iss: 'starter-app',
        sub: 'starter-user',
      },
      'wrong-secret',
    );

    await expect(strategy.authenticate(createContext(`Bearer ${expiredToken}`))).rejects.toBeInstanceOf(
      AuthenticationExpiredError,
    );
    await expect(strategy.authenticate(createContext(`Bearer ${invalidToken}`))).rejects.toBeInstanceOf(
      AuthenticationFailedError,
    );
  });
});
