import {
  Controller,
  clearCookie,
  Get,
  type RequestContext,
  setCookie,
} from '@fluojs/http';
import { defineModule, type ModuleType } from '@fluojs/runtime';

const EXPECTED_RESPONSE_COOKIES = [
  'session=hello%20world; Max-Age=90; Domain=example.test; Path=/account; HttpOnly; Secure; SameSite=Lax',
  'refresh=token; Max-Age=180; Path=/account; SameSite=Strict',
  'session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Domain=example.test; Path=/account; HttpOnly; Secure; SameSite=Lax',
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

      return { ok: true };
    }
  }

  class AppModule {}
  defineModule(AppModule, {
    controllers: [ResponseCookieController],
  });

  return AppModule;
}

/**
 * Verifies exact ordered non-folded `Set-Cookie` fields on a native response.
 *
 * @param response Native response returned by a network or fetch-style adapter.
 * @param adapterName Adapter name included in conformance failures.
 * @returns Nothing when the adapter preserves the portable cookie contract.
 */
export function assertPortableResponseCookies(
  response: Response,
  adapterName: string,
): void {
  if (response.status !== 200) {
    throw new Error(
      `${adapterName} adapter changed response-cookie status semantics: received ${String(response.status)}.`,
    );
  }

  const cookies = response.headers.getSetCookie();

  if (JSON.stringify(cookies) !== JSON.stringify(EXPECTED_RESPONSE_COOKIES)) {
    throw new Error(
      `${adapterName} adapter changed ordered non-folded Set-Cookie semantics: ${JSON.stringify(cookies)}.`,
    );
  }
}
