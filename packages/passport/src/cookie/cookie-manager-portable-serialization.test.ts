import type { FrameworkResponse } from '@fluojs/http';
import { setCookie } from '@fluojs/http';
import { expect, expectTypeOf, it, vi } from 'vitest';

import type {
  CookieManager as PublicCookieManager,
  CookieManagerConfig as PublicCookieManagerConfig,
  SetCookieOptions as PublicSetCookieOptions,
} from '../index.js';
import * as passportPublicApi from '../index.js';
import { CookieManager } from './cookie-manager.js';

vi.mock('@fluojs/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@fluojs/http')>();

  return {
    ...actual,
    setCookie: vi.fn(actual.setCookie),
  };
});

function createResponse(): FrameworkResponse {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send() {
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

it('delegates legacy authentication cookie fields to the portable HTTP serializer', () => {
  // Given
  const manager = new CookieManager({
    cookieOptions: {
      domain: 'example.com',
      path: '/sessions',
      sameSite: 'lax',
    },
  });
  const response = createResponse();
  vi.mocked(setCookie).mockClear();

  // When
  manager.setAccessTokenCookie(response, 'token with spaces', 300);
  manager.clearRefreshTokenCookie(response);

  // Then
  expect(setCookie).toHaveBeenNthCalledWith(1, response, 'access_token', 'token with spaces', {
    domain: 'example.com',
    httpOnly: true,
    maxAgeSeconds: 300,
    path: '/sessions',
    sameSite: 'lax',
    secure: true,
  });
  expect(setCookie).toHaveBeenNthCalledWith(2, response, 'refresh_token', '', {
    domain: 'example.com',
    httpOnly: true,
    maxAgeSeconds: 0,
    path: '/sessions',
    sameSite: 'lax',
    secure: true,
  });
  expect(response.headers['Set-Cookie']).toEqual([
    'access_token=token%20with%20spaces; Max-Age=300; Path=/sessions; Domain=example.com; Secure; HttpOnly; SameSite=Lax',
    'refresh_token=; Max-Age=0; Path=/sessions; Domain=example.com; Secure; HttpOnly; SameSite=Lax',
  ]);
});

it('rejects invalid portable cookie attributes before mutating the response', () => {
  // Given
  const manager = new CookieManager({
    cookieOptions: {
      path: '/line\nbreak',
    },
  });
  const response = createResponse();

  // When
  const writeCookie = () => manager.setAccessTokenCookie(response, 'token');

  // Then
  expect(writeCookie).toThrow(TypeError);
  expect(response.headers).toEqual({});
});

it('keeps CookieManager declarations available from the package root', () => {
  // Given
  const manager = new CookieManager();

  // When
  const exportedManager = passportPublicApi.CookieManager;

  // Then
  expect(exportedManager).toBe(CookieManager);
  expectTypeOf<PublicCookieManager>().toHaveProperty('setAccessTokenCookie');
  expectTypeOf<PublicCookieManager>().toHaveProperty('clearAllCookies');
  expectTypeOf<PublicCookieManager['setRefreshTokenCookie']>()
    .parameter(2)
    .toEqualTypeOf<number | undefined>();
  expectTypeOf<PublicCookieManagerConfig['cookieOptions']>()
    .toEqualTypeOf<PublicSetCookieOptions | undefined>();
  expect(manager).toBeInstanceOf(exportedManager);
});
