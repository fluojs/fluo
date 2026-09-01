import { describe, expect, it } from 'vitest';

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
      const storedName = existingName ?? name;

      if (name.toLowerCase() === 'set-cookie') {
        const existing = this.headers[storedName];
        const existingValues = existing === undefined
          ? []
          : Array.isArray(existing)
            ? existing
            : [existing];
        const nextValues = Array.isArray(value) ? value : [value];

        this.headers[storedName] = [...existingValues, ...nextValues];
        return;
      }

      this.headers[storedName] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

describe('portable response cookie helpers', () => {
  it('serializes an encoded cookie with explicit cross-runtime attributes', () => {
    const response = createResponse();

    setCookie(response, 'session', 'token with spaces', {
      domain: 'example.com',
      expires: new Date('2025-01-01T00:00:00.000Z'),
      httpOnly: true,
      maxAgeSeconds: 300,
      path: '/sessions',
      sameSite: 'lax',
      secure: true,
    });

    expect(response.headers).toEqual({
      'Set-Cookie': [
        'session=token%20with%20spaces; Max-Age=300; Expires=Wed, 01 Jan 2025 00:00:00 GMT; Domain=example.com; Path=/sessions; HttpOnly; Secure; SameSite=Lax',
      ],
    });
  });

  it('keeps repeated Set-Cookie writes ordered and non-folded', () => {
    const response = createResponse();

    setCookie(response, 'first', 'one');
    clearCookie(response, 'second', { path: '/sessions' });

    expect(response.headers['Set-Cookie']).toEqual([
      'first=one',
      'second=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/sessions',
    ]);
  });

  it('preserves matching scope attributes while expiring a cookie', () => {
    const response = createResponse();

    clearCookie(response, 'session', {
      domain: 'example.com',
      httpOnly: true,
      path: '/sessions',
      sameSite: 'strict',
      secure: true,
    });

    expect(response.headers['Set-Cookie']).toEqual([
      'session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Domain=example.com; Path=/sessions; HttpOnly; Secure; SameSite=Strict',
    ]);
  });

  it('rejects invalid serialization inputs before headers change', () => {
    const response = createResponse();

    expect(() => setCookie(response, 'bad name', 'value')).toThrow(TypeError);
    expect(() => setCookie(response, 'session', '\uD800')).toThrow(URIError);
    expect(() => setCookie(response, 'session', 'value', { domain: 'bad_domain' })).toThrow(TypeError);
    expect(() => setCookie(response, 'session', 'value', { maxAgeSeconds: -1 })).toThrow(TypeError);
    expect(() => setCookie(response, 'session', 'value', { maxAgeSeconds: 1.5 })).toThrow(TypeError);
    expect(() => setCookie(response, 'session', 'value', { path: '/line\nbreak' })).toThrow(TypeError);
    expect(() => setCookie(response, 'session', 'value', { sameSite: 'none' })).toThrow(TypeError);

    expect(response.headers).toEqual({});
  });
});
