import { describe, expect, it, vi } from 'vitest';

import { createFetchStyleHttpAdapterRealtimeCapability } from './adapter.js';

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
});
