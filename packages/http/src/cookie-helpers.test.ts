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
    [{ maxAgeSeconds: 1.5 }, /maxAgeSeconds/],
    [{ maxAgeSeconds: Number.POSITIVE_INFINITY }, /maxAgeSeconds/],
    [{ expires: new Date(Number.NaN) }, /expires/],
    [{ domain: 'example.com\r\nX-Injected: yes' }, /domain/],
    [{ path: '/safe; Injected=yes' }, /path/],
  ] as const)('rejects invalid cookie attributes before writing a header', (options, expectedError) => {
    // Given
    const response = createResponse();
    const setHeader = vi.spyOn(response, 'setHeader');

    // When / Then
    expect(() => setCookie(response, 'session', 'value', options)).toThrow(expectedError);
    expect(setHeader).not.toHaveBeenCalled();
    expect(response.committed).toBe(false);
  });

  it('omits disabled boolean attributes and preserves signed whole-second max ages', () => {
    // Given
    const response = createResponse();

    // When
    setCookie(response, 'session', '', {
      httpOnly: false,
      maxAgeSeconds: -1,
      sameSite: 'none',
      secure: false,
    });

    // Then
    expect(response.headers['Set-Cookie']).toBe(
      'session=; Max-Age=-1; SameSite=None',
    );
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
