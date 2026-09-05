import { describe, expect, it } from 'vitest';

import { createDeferredFrameworkRequestShell } from './internal-node-request.js';

describe('createDeferredFrameworkRequestShell', () => {
  it('snapshots Node transport metadata for every Node-backed adapter', () => {
    const request = createDeferredFrameworkRequestShell({
      path: '/connection',
      raw: {
        socket: {
          encrypted: true,
          remoteAddress: '2001:db8::10',
        },
      },
      signal: new AbortController().signal,
      url: '/connection',
    });

    expect(request.connection).toEqual({
      protocol: 'https',
      remoteAddress: '2001:db8::10',
    });
    expect(Object.isFrozen(request.connection)).toBe(true);
  });

  it('leaves transport metadata absent when a raw request has no peer address', () => {
    const request = createDeferredFrameworkRequestShell({
      path: '/connection',
      raw: {},
      signal: new AbortController().signal,
      url: '/connection',
    });

    expect(request.connection).toBeUndefined();
  });
});
