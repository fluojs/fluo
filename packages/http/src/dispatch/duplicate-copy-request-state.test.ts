import { describe, expect, it, vi } from 'vitest';

import type { FrameworkRequest } from '../types.js';

function createRequest(): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path: '/',
    query: {},
    raw: {},
    url: '/',
  };
}

describe('duplicate HTTP-copy request state', () => {
  it('consumes a copy-A native handoff exactly once through copy B', async () => {
    // Given
    vi.resetModules();
    const copyA = await import('./native-route-handoff.js');
    vi.resetModules();
    const copyB = await import('./native-route-handoff.js');
    const rawRequest = {};
    const handoff = {
      descriptor: {} as never,
      params: { id: '42' },
    };

    // When
    copyA.bindRawRequestNativeRouteHandoff(rawRequest, handoff);

    // Then
    expect(copyB.consumeRawRequestNativeRouteHandoff(rawRequest)).toEqual(handoff);
    expect(copyB.consumeRawRequestNativeRouteHandoff(rawRequest)).toBeUndefined();
  });

  it('reads a copy-A framework handoff through copy B only while its method and path match', async () => {
    // Given
    vi.resetModules();
    const copyA = await import('./native-route-handoff.js');
    vi.resetModules();
    const copyB = await import('./native-route-handoff.js');
    const request = createRequest();
    const handoff = {
      descriptor: {} as never,
      params: { id: '42' },
    };

    // When
    copyA.attachFrameworkRequestNativeRouteHandoff(request, handoff);
    request.path = '/stale';

    // Then
    expect(copyB.readFrameworkRequestNativeRouteHandoff({
      ...request,
      path: '/',
    })).toEqual(handoff);
    expect(copyB.readFrameworkRequestNativeRouteHandoff(request)).toBeUndefined();
  });

  it('shares request-ID absence and authoritative abort state across compatible copies', async () => {
    // Given
    vi.resetModules();
    const snapshotA = await import('../context/request-id-snapshot.js');
    const abortA = await import('./request-abort.js');
    vi.resetModules();
    const snapshotB = await import('../context/request-id-snapshot.js');
    const abortB = await import('./request-abort.js');
    const request = createRequest();
    const abortedRequest = {
      ...createRequest(),
      isAborted: () => false,
      signal: AbortSignal.abort(),
    };

    // When
    snapshotA.markAbsentRequestId(request);
    abortA.registerAuthoritativeAbortProbe(abortedRequest, abortedRequest.isAborted);

    // Then
    expect(snapshotB.hasAbsentRequestId(request)).toBe(true);
    expect(abortB.isRequestAborted(abortedRequest)).toBe(true);
  });
});
