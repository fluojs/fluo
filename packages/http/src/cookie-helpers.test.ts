import { runInNewContext } from 'node:vm';

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

  it.each([
    ['path', '/safe\r\nX-Injected: yes', '/safe', /path/],
    ['domain', 'example.com\r\nX-Injected: yes', 'example.com', /domain/],
    ['maxAgeSeconds', 1e21, 60, /maxAgeSeconds/],
  ] as const)('rejects an unsafe initial %s getter snapshot before writing a header', (
    option,
    unsafeValue,
    safeValue,
    expectedError,
  ) => {
    // Given
    const response = createResponse();
    const setHeader = vi.spyOn(response, 'setHeader');
    let reads = 0;
    const options = {};
    Object.defineProperty(options, option, {
      get() {
        reads += 1;
        return reads === 1 ? unsafeValue : safeValue;
      },
    });

    // When / Then
    expect(() => setCookie(response, 'session', 'value', options)).toThrow(expectedError);
    expect(reads).toBe(1);
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('snapshots every cookie option exactly once before validation', () => {
    // Given
    const response = createResponse();
    const reads = {
      domain: 0,
      expires: 0,
      httpOnly: 0,
      maxAgeSeconds: 0,
      path: 0,
      sameSite: 0,
      secure: 0,
    };
    const options = {
      get domain() {
        reads.domain += 1;
        return 'example.com';
      },
      get expires() {
        reads.expires += 1;
        return new Date('2030-01-02T03:04:05.000Z');
      },
      get httpOnly() {
        reads.httpOnly += 1;
        return true;
      },
      get maxAgeSeconds() {
        reads.maxAgeSeconds += 1;
        return 60;
      },
      get path() {
        reads.path += 1;
        return '/account';
      },
      get sameSite() {
        reads.sameSite += 1;
        return 'lax' as const;
      },
      get secure() {
        reads.secure += 1;
        return true;
      },
    };

    // When
    setCookie(response, 'session', 'value', options);

    // Then
    expect(reads).toEqual({
      domain: 1,
      expires: 1,
      httpOnly: 1,
      maxAgeSeconds: 1,
      path: 1,
      sameSite: 1,
      secure: 1,
    });
    expect(response.headers['Set-Cookie']).toBe(
      'session=value; Max-Age=60; Expires=Wed, 02 Jan 2030 03:04:05 GMT; '
      + 'Domain=example.com; Path=/account; HttpOnly; Secure; SameSite=Lax',
    );
  });

  it.each(['httpOnly', 'domain', 'path'] as const)(
    'snapshots expires before a later %s getter can mutate it',
    (mutatingAccessor) => {
      // Given
      const response = createResponse();
      const expires = new Date('2030-01-02T03:04:05.000Z');
      const mutateExpires = () => {
        expires.setUTCFullYear(2040);
      };
      const options = {
        get domain() {
          if (mutatingAccessor === 'domain') {
            mutateExpires();
          }

          return 'example.com';
        },
        get expires() {
          return expires;
        },
        get httpOnly() {
          if (mutatingAccessor === 'httpOnly') {
            mutateExpires();
          }

          return true;
        },
        get path() {
          if (mutatingAccessor === 'path') {
            mutateExpires();
          }

          return '/account';
        },
      };

      // When
      setCookie(response, 'session', 'value', options);

      // Then
      expect(response.headers['Set-Cookie']).toBe(
        'session=value; Expires=Wed, 02 Jan 2030 03:04:05 GMT; '
        + 'Domain=example.com; Path=/account; HttpOnly',
      );
    },
  );

  it('resists Date formatter call poisoning from a later option getter', () => {
    // Given
    const response = createResponse();
    const originalCall = Object.getOwnPropertyDescriptor(Date.prototype.toUTCString, 'call');

    try {
      const options = {
        get domain() {
          Object.defineProperty(Date.prototype.toUTCString, 'call', {
            configurable: true,
            value: () => 'Wed, 02 Jan 2030 03:04:05 GMT\r\nX-Injected: yes',
          });
          return 'example.com';
        },
        get expires() {
          return new Date('2030-01-02T03:04:05.000Z');
        },
      };

      // When
      setCookie(response, 'session', 'value', options);
    } finally {
      if (originalCall === undefined) {
        Reflect.deleteProperty(Date.prototype.toUTCString, 'call');
      } else {
        Object.defineProperty(Date.prototype.toUTCString, 'call', originalCall);
      }
    }

    // Then
    expect(response.headers['Set-Cookie']).toBe(
      'session=value; Expires=Wed, 02 Jan 2030 03:04:05 GMT; Domain=example.com',
    );
  });

  it('resists RegExp test poisoning from the expires getter', () => {
    // Given
    const response = createResponse();
    const setHeader = vi.spyOn(response, 'setHeader');
    const originalTest = Object.getOwnPropertyDescriptor(RegExp.prototype, 'test');
    let error: unknown;

    try {
      const options = {
        get expires() {
          Object.defineProperty(RegExp.prototype, 'test', {
            configurable: true,
            value: () => true,
          });
          return undefined;
        },
      };

      // When
      try {
        setCookie(response, 'session\r\nX-Injected: yes', 'value', options);
      } catch (caught) {
        error = caught;
      }
    } finally {
      if (originalTest === undefined) {
        Reflect.deleteProperty(RegExp.prototype, 'test');
      } else {
        Object.defineProperty(RegExp.prototype, 'test', originalTest);
      }
    }

    // Then
    expect(error).toBeInstanceOf(TypeError);
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('accepts a valid cross-realm Date', () => {
    // Given
    const response = createResponse();
    const expires = runInNewContext("new Date('2030-01-02T03:04:05.000Z')") as Date;

    // When
    setCookie(response, 'session', 'value', { expires });

    // Then
    expect(response.headers['Set-Cookie']).toBe(
      'session=value; Expires=Wed, 02 Jan 2030 03:04:05 GMT',
    );
  });

  it('rejects Date-like impostors before writing a header', () => {
    // Given
    const response = createResponse();
    const setHeader = vi.spyOn(response, 'setHeader');
    const expires = {
      getTime: () => Date.parse('2030-01-02T03:04:05.000Z'),
      getUTCFullYear: () => 2030,
      toUTCString: () => 'Wed, 02 Jan 2030 03:04:05 GMT',
    } as unknown as Date;

    // When / Then
    expect(() => setCookie(response, 'session', 'value', { expires })).toThrow(/expires/);
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('uses intrinsic Date operations for caller-controlled Date subclasses', () => {
    // Given
    class CallerControlledDate extends Date {}

    const response = createResponse();
    const expires = new CallerControlledDate('2030-01-02T03:04:05.000Z');
    const getTime = vi.fn(() => Date.prototype.getTime.call(expires));
    const getUTCFullYear = vi.fn(() => 10_000);
    const toUTCString = vi.fn(() => 'Wed, 02 Jan 2030 03:04:05 GMT\r\nX-Injected: yes');
    expires.getTime = getTime;
    expires.getUTCFullYear = getUTCFullYear;
    expires.toUTCString = toUTCString;

    // When
    setCookie(response, 'session', 'value', { expires });

    // Then
    expect(getTime).not.toHaveBeenCalled();
    expect(getUTCFullYear).not.toHaveBeenCalled();
    expect(toUTCString).not.toHaveBeenCalled();
    expect(response.headers['Set-Cookie']).toBe(
      'session=value; Expires=Wed, 02 Jan 2030 03:04:05 GMT',
    );
  });

  it.each([
    ['', 'session=value; Path='],
    [' :<~', 'session=value; Path= :<~'],
  ])('accepts RFC6265 path-value boundary %j', (path, expectedHeader) => {
    // Given
    const response = createResponse();

    // When
    setCookie(response, 'session', 'value', { path });

    // Then
    expect(response.headers['Set-Cookie']).toBe(expectedHeader);
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
  it('snapshots inherited non-enumerable scoped options exactly once', () => {
    // Given
    const response = createResponse();
    const reads = {
      domain: 0,
      httpOnly: 0,
      path: 0,
      sameSite: 0,
      secure: 0,
    };
    class ScopedCookieOptions {
      get domain() {
        reads.domain += 1;
        return 'auth.example.com';
      }

      get httpOnly() {
        reads.httpOnly += 1;
        return true;
      }

      get path() {
        reads.path += 1;
        return '/admin';
      }

      get sameSite() {
        reads.sameSite += 1;
        return 'none' as const;
      }

      get secure() {
        reads.secure += 1;
        return true;
      }
    }

    // When
    clearCookie(response, 'session', new ScopedCookieOptions());

    // Then
    expect(reads).toEqual({
      domain: 1,
      httpOnly: 1,
      path: 1,
      sameSite: 1,
      secure: 1,
    });
    expect(response.headers['Set-Cookie']).toBe(
      'session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; '
      + 'Domain=auth.example.com; Path=/admin; HttpOnly; Secure; SameSite=None',
    );
  });

  it('does not evaluate unrelated enumerable option getters', () => {
    // Given
    const response = createResponse();
    const unrelated = vi.fn(() => {
      throw new Error('unrelated getter must not run');
    });
    const options = { domain: 'auth.example.com', path: '/admin' };
    Object.defineProperty(options, 'unrelated', { enumerable: true, get: unrelated });

    // When
    clearCookie(response, 'session', options);

    // Then
    expect(unrelated).not.toHaveBeenCalled();
    expect(response.headers['Set-Cookie']).toBe(
      'session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; '
      + 'Domain=auth.example.com; Path=/admin',
    );
  });

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
