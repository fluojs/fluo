import { expect, it, vi } from 'vitest';
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

it('does not materialize a lazy signal covered by an authoritative abort probe', () => {
  // Given
  const probe = vi.fn(() => false);
  const request: FrameworkRequest = {
    body: undefined, cookies: {}, headers: {}, method: 'GET', params: {},
    path: '/', query: {}, raw: {}, url: '/', isAborted: probe,
  };
  Object.defineProperty(request, 'signal', {
    get() {
      throw new Error('The authoritative probe should avoid reading signal.');
    },
  });
  registerAuthoritativeAbortProbe(request, probe, {
    signalIsAuthoritativelyObserved: true,
  });

  // When / Then
  expect(isRequestAborted(request)).toBe(false);
  expect(probe).toHaveBeenCalledTimes(1);
});
