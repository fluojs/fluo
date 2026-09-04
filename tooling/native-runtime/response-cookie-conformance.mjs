import { clearCookie, setCookie } from '../../packages/http/dist/cookie-helpers.js';

export const expectedResponseCookies = [
  'session=hello%20world; Max-Age=90; Path=/account; Domain=example.test; Secure; HttpOnly; SameSite=Lax',
  'refresh=token; Max-Age=180; Path=/account; SameSite=Strict',
  'session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/account; Domain=example.test; Secure; HttpOnly; SameSite=Lax',
  'refresh=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/account',
];

function createResponse() {
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
        this.headers[storedName] = existing === undefined ? [value] : [...existing, value];
        return;
      }

      this.headers[storedName] = [value];
    },
    setStatus() {},
  };
}

export function createNativeResponseCookieConformanceResponse() {
  const frameworkResponse = createResponse();

  setCookie(frameworkResponse, 'session', 'hello world', {
    domain: 'example.test',
    httpOnly: true,
    maxAgeSeconds: 90,
    path: '/account',
    sameSite: 'lax',
    secure: true,
  });
  setCookie(frameworkResponse, 'refresh', 'token', {
    maxAgeSeconds: 180,
    path: '/account',
    sameSite: 'strict',
  });
  clearCookie(frameworkResponse, 'session', {
    domain: 'example.test',
    httpOnly: true,
    path: '/account',
    sameSite: 'lax',
    secure: true,
  });
  clearCookie(frameworkResponse, 'refresh', { path: '/account' });

  const headers = new Headers();
  for (const value of frameworkResponse.headers['Set-Cookie']) {
    headers.append('Set-Cookie', value);
  }

  return new Response(null, { headers });
}

export function assertNativeResponseCookieConformance() {
  const actual = createNativeResponseCookieConformanceResponse().headers.getSetCookie();

  if (actual.length !== expectedResponseCookies.length) {
    throw new Error(`expected ${expectedResponseCookies.length} Set-Cookie fields but received ${actual.length}`);
  }

  for (const [index, expected] of expectedResponseCookies.entries()) {
    if (actual[index] !== expected) {
      throw new Error(`Set-Cookie field ${index} was ${JSON.stringify(actual[index])}, expected ${JSON.stringify(expected)}`);
    }
  }
}
