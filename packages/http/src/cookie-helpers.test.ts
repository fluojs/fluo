import { describe, expect, it, vi } from 'vitest';

import { clearCookie, setCookie } from './index.js';
import type { FrameworkResponse } from './types.js';

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
      const existingName = Object.keys(this.headers).find(
        (headerName) => headerName.toLowerCase() === name.toLowerCase(),
      );
      const headerName = existingName ?? name;
      const current = this.headers[headerName];

      if (name.toLowerCase() !== 'set-cookie' || current === undefined) {
        this.headers[headerName] = value;
        return;
      }

      const currentValues = Array.isArray(current) ? current : [current];
      const nextValues = Array.isArray(value) ? value : [value];
      this.headers[headerName] = [...currentValues, ...nextValues];
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

describe('setCookie', () => {
  it('encodes values and serializes every portable cookie attribute', () => {
    // Given
    const response = createResponse();
    const expires = new Date('2030-01-02T03:04:05.000Z');

    // When
    setCookie(response, 'session', 'hello world/한글', {
      domain: 'example.com',
      expires,
      httpOnly: true,
      maxAgeSeconds: 3_600,
      path: '/account',
      sameSite: 'lax',
      secure: true,
    });

    // Then
    expect(response.headers['Set-Cookie']).toBe(
      'session=hello%20world%2F%ED%95%9C%EA%B8%80; Max-Age=3600; '
      + 'Expires=Wed, 02 Jan 2030 03:04:05 GMT; Domain=example.com; '
      + 'Path=/account; HttpOnly; Secure; SameSite=Lax',
    );
  });

  it('retains repeated set and clear operations as ordered independent fields', () => {
    // Given
    const response = createResponse();

    // When
    setCookie(response, 'access', 'one', { httpOnly: true, maxAgeSeconds: 60 });
    setCookie(response, 'refresh', 'two', { maxAgeSeconds: 120, sameSite: 'strict' });
    clearCookie(response, 'access', { httpOnly: true, path: '/' });

    // Then
    expect(response.headers['Set-Cookie']).toEqual([
      'access=one; Max-Age=60; HttpOnly',
      'refresh=two; Max-Age=120; SameSite=Strict',
      'access=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly',
    ]);
  });

  it.each([
    '',
    'bad=name',
    'bad;name',
    'bad,name',
    'bad:name',
    'bad(name',
    '한글',
    'line\nbreak',
  ])('rejects invalid cookie name %j before writing a header', (name) => {
    // Given
    const response = createResponse();
    const setHeader = vi.spyOn(response, 'setHeader');

    // When / Then
    expect(() => setCookie(response, name, 'value')).toThrow(/cookie name/i);
    expect(setHeader).not.toHaveBeenCalled();
    expect(response.committed).toBe(false);
  });

  it('rejects values that cannot be safely encoded before writing a header', () => {
    // Given
    const response = createResponse();
    const setHeader = vi.spyOn(response, 'setHeader');

    // When / Then
    expect(() => setCookie(response, 'session', '\uD800')).toThrow(/cookie value/i);
    expect(setHeader).not.toHaveBeenCalled();
    expect(response.committed).toBe(false);
  });

  it.each([
    [{ maxAgeSeconds: -1 }, /maxAgeSeconds/],
    [{ maxAgeSeconds: 1.5 }, /maxAgeSeconds/],
    [{ maxAgeSeconds: 1e21 }, /maxAgeSeconds/],
    [{ maxAgeSeconds: Number.POSITIVE_INFINITY }, /maxAgeSeconds/],
    [{ expires: new Date(Number.NaN) }, /expires/],
    [{ expires: new Date('1600-01-01T00:00:00.000Z') }, /expires/],
    [{ expires: new Date(Date.UTC(10_000, 0, 1)) }, /expires/],
    [{ domain: 'example.com\r\nX-Injected: yes' }, /domain/],
    [{ domain: 'bad domain' }, /domain/],
    [{ domain: 'example/com' }, /domain/],
    [{ domain: 'example,com' }, /domain/],
    [{ domain: 'example\\com' }, /domain/],
    [{ path: '/safe; Injected=yes' }, /path/],
    [{ sameSite: 'none', secure: false }, /sameSite/],
  ] as const)('rejects invalid cookie attributes before writing a header', (options, expectedError) => {
    // Given
    const response = createResponse();
    const setHeader = vi.spyOn(response, 'setHeader');

    // When / Then
    expect(() => setCookie(response, 'session', 'value', options)).toThrow(expectedError);
    expect(setHeader).not.toHaveBeenCalled();
    expect(response.committed).toBe(false);
  });

  it('accepts a leading dot on a valid domain', () => {
    // Given
    const response = createResponse();

    // When
    setCookie(response, 'session', 'value', { domain: '.example.com' });

    // Then
    expect(response.headers['Set-Cookie']).toBe('session=value; Domain=.example.com');
  });

  it('serializes safe decimal delta-second and IMF-fixdate boundaries', () => {
    // Given
    const response = createResponse();

    // When
    setCookie(response, 'first', '', {
      expires: new Date(Date.UTC(1601, 0, 1)),
      maxAgeSeconds: 0,
    });
    setCookie(response, 'last', '', {
      expires: new Date(Date.UTC(9_999, 11, 31, 23, 59, 59)),
      maxAgeSeconds: Number.MAX_SAFE_INTEGER,
    });

    // Then
    expect(response.headers['Set-Cookie']).toEqual([
      'first=; Max-Age=0; Expires=Mon, 01 Jan 1601 00:00:00 GMT',
      'last=; Max-Age=9007199254740991; Expires=Fri, 31 Dec 9999 23:59:59 GMT',
    ]);
  });

  it('omits disabled boolean attributes without weakening SameSite policy', () => {
    // Given
    const response = createResponse();

    // When
    setCookie(response, 'session', '', {
      httpOnly: false,
      sameSite: 'lax',
      secure: false,
    });

    // Then
    expect(response.headers['Set-Cookie']).toBe('session=; SameSite=Lax');
  });
});

describe('clearCookie', () => {
  it('forces deletion attributes while retaining caller-supplied matching attributes', () => {
    // Given
    const response = createResponse();

    // When
    clearCookie(response, 'session', {
      domain: 'auth.example.com',
      path: '/admin',
      sameSite: 'none',
      secure: true,
    });

    // Then
    expect(response.headers['Set-Cookie']).toBe(
      'session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; '
      + 'Domain=auth.example.com; Path=/admin; Secure; SameSite=None',
    );
  });
});
