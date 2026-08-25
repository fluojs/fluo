import { describe, expect, it, vi } from 'vitest';

import { createFetchStyleHttpAdapterRealtimeCapability } from './adapter.js';

describe('fetch-style HTTP adapter realtime capability', () => {
  it('exposes versioned binding installation when the host supplies it', () => {
    const install = vi.fn();
    const capability = createFetchStyleHttpAdapterRealtimeCapability(
      'supported test host',
      { bindingInstallation: { install } },
    );

    expect(capability).toMatchObject({
      bindingInstallation: { version: 1 },
      version: 2,
    });

    const binding = { protocol: 'socket.io' };
    if (capability.version !== 2) {
      throw new TypeError('Expected realtime capability version 2.');
    }

    capability.bindingInstallation.install(binding);

    expect(install).toHaveBeenCalledExactlyOnceWith(binding);
  });
});
