import { describe, expect, it, vi } from 'vitest';

import {
  createFetchStyleHttpAdapterRealtimeCapability,
  resolveFetchStyleHttpAdapterRealtimeBindingInstallation,
} from './adapter.js';

describe('fetch-style HTTP adapter realtime capability', () => {
  it('preserves capability version 1 when the host supplies binding installation', () => {
    const install = vi.fn();
    const capability = createFetchStyleHttpAdapterRealtimeCapability(
      'supported test host',
      { bindingInstallation: { install } },
    );

    expect(capability).toMatchObject({
      bindingInstallation: { version: 1 },
      version: 1,
    });

    const binding = { protocol: 'socket.io' };
    capability.bindingInstallation?.install(binding);

    expect(install).toHaveBeenCalledExactlyOnceWith(binding);
  });

  it.each([
    ['an unknown capability', undefined],
    ['a capability with the wrong version', {
      bindingInstallation: { install() {}, version: 1 },
      contract: 'raw-websocket-expansion',
      kind: 'fetch-style',
      mode: 'request-upgrade',
      reason: 'test',
      support: 'supported',
      version: 2,
    }],
    ['a capability with a non-callable installer', {
      bindingInstallation: { install: true, version: 1 },
      contract: 'raw-websocket-expansion',
      kind: 'fetch-style',
      mode: 'request-upgrade',
      reason: 'test',
      support: 'supported',
      version: 1,
    }],
    ['an installer with the wrong version', {
      bindingInstallation: { install() {}, version: 2 },
      contract: 'raw-websocket-expansion',
      kind: 'fetch-style',
      mode: 'request-upgrade',
      reason: 'test',
      support: 'supported',
      version: 1,
    }],
  ])('rejects %s at the capability boundary', (_name, capability) => {
    expect(() => resolveFetchStyleHttpAdapterRealtimeBindingInstallation(capability)).toThrow(
      'fetch-style realtime binding installation',
    );
  });
});
