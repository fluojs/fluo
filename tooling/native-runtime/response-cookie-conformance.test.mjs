import { assertNativeResponseCookieConformance } from './response-cookie-conformance.mjs';

const registerTest = globalThis.Deno?.test ?? (await import('bun:test')).test;

if (typeof registerTest !== 'function') {
  throw new Error('This conformance test must run under Bun test or Deno test');
}

registerTest('preserves ordered independent Set-Cookie fields for repeated setCookie and clearCookie calls', () => {
  assertNativeResponseCookieConformance();
});
