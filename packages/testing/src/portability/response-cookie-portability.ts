import {
  Controller,
  clearCookie,
  Get,
  type RequestContext,
  setCookie,
} from '@fluojs/http';
import { defineModule, type ModuleType } from '@fluojs/runtime';

const EXPECTED_RESPONSE_COOKIES = [
  'session=hello%20world; Max-Age=90; Path=/account; Domain=example.test; Secure; HttpOnly; SameSite=Lax',
  'refresh=token; Max-Age=180; Path=/account; SameSite=Strict',
  'session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/account; Domain=example.test; Secure; HttpOnly; SameSite=Lax',
] as const;

/**
 * Creates the shared controller fixture for portable response-cookie conformance.
 *
 * @returns A module that writes two cookies and then clears the first cookie.
 */
export function createResponseCookiePortabilityModule(): ModuleType {
  @Controller('/response-cookies')
  class ResponseCookieController {
    @Get('/')
    write(_input: undefined, context: RequestContext) {
      setCookie(context.response, 'session', 'hello world', {
        domain: 'example.test',
        httpOnly: true,
        maxAgeSeconds: 90,
        path: '/account',
        sameSite: 'lax',
        secure: true,
      });
      setCookie(context.response, 'refresh', 'token', {
        maxAgeSeconds: 180,
        path: '/account',
        sameSite: 'strict',
      });
      clearCookie(context.response, 'session', {
        domain: 'example.test',
        httpOnly: true,
        path: '/account',
        sameSite: 'lax',
        secure: true,
      });

      return { written: true };
    }
  }

  class ResponseCookieModule {}
  defineModule(ResponseCookieModule, {
    controllers: [ResponseCookieController],
  });

  return ResponseCookieModule;
}

/**
 * Verifies that one adapter response retains each cookie as an ordered field.
 *
 * @param response Response produced by the adapter under test.
 * @param adapterName Adapter name included in assertion failures.
 * @returns Nothing. Throws when cookies are folded, reordered, or lost.
 */
export function assertPortableResponseCookies(response: Response, adapterName: string): void {
  const actual = response.headers.getSetCookie();

  if (actual.length !== EXPECTED_RESPONSE_COOKIES.length) {
    throw new Error(`${adapterName} returned ${actual.length} Set-Cookie fields instead of ${EXPECTED_RESPONSE_COOKIES.length}.`);
  }

  for (const [index, expected] of EXPECTED_RESPONSE_COOKIES.entries()) {
    if (actual[index] !== expected) {
      throw new Error(`${adapterName} returned an incorrect Set-Cookie field at index ${index}.`);
    }
  }
}
