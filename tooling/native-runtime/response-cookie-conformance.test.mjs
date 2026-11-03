import { test } from 'bun:test';
import { assertNativeResponseCookieConformance } from './response-cookie-conformance.mjs';

test('preserves ordered independent Set-Cookie fields for repeated setCookie and clearCookie calls', () => {
  assertNativeResponseCookieConformance();
});
