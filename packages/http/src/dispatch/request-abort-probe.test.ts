import { expect, it } from 'vitest';
import type { FrameworkRequest } from '../types.js';
import { isRequestAborted, registerAuthoritativeAbortProbe } from './request-abort.js';

it('does not transfer an authoritative probe to a request with an independent signal', () => {
  // Given
  const probe = () => false;
  const request: FrameworkRequest = {
    body: undefined, cookies: {}, headers: {}, method: 'GET', params: {},
    path: '/', query: {}, raw: {}, url: '/', isAborted: probe,
  };
  registerAuthoritativeAbortProbe(request, probe);
  const copiedRequest = { ...request, signal: AbortSignal.abort() };
  // When / Then
  expect(isRequestAborted(copiedRequest)).toBe(true);
});
