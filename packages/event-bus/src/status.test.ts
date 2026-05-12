import { describe, expect, it } from 'vitest';

import { createEventBusPlatformStatusSnapshot } from './status.js';

describe('createEventBusPlatformStatusSnapshot', () => {
  it('reports local-only ready semantics when transport is absent', () => {
    const snapshot = createEventBusPlatformStatusSnapshot({
      handlersDiscovered: 3,
      lifecycleState: 'ready',
      shutdownDrainTimeoutMs: 5000,
      shutdownDrainTimeouts: 0,
      subscribedChannels: 0,
      transportCloseFailures: 0,
      transportConfigured: false,
      transportPublishFailures: 0,
      transportSubscribeFailures: 0,
      waitForHandlersDefault: true,
    });

    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      dependencies: [],
      operationMode: 'local-only',
    });
  });

  it('surfaces transport subscribe failures as degraded readiness/health', () => {
    const snapshot = createEventBusPlatformStatusSnapshot({
      handlersDiscovered: 2,
      lifecycleState: 'ready',
      shutdownDrainTimeoutMs: 5000,
      shutdownDrainTimeouts: 0,
      subscribedChannels: 1,
      transportCloseFailures: 0,
      transportConfigured: true,
      transportPublishFailures: 0,
      transportSubscribeFailures: 1,
      waitForHandlersDefault: false,
    });

    expect(snapshot.readiness.status).toBe('degraded');
    expect(snapshot.health.status).toBe('degraded');
    expect(snapshot.details.dependencies).toEqual(['transport.external']);
  });

  it('surfaces bounded shutdown drain timeouts as degraded health diagnostics', () => {
    const snapshot = createEventBusPlatformStatusSnapshot({
      handlersDiscovered: 2,
      lifecycleState: 'ready',
      shutdownDrainTimeoutMs: 20,
      shutdownDrainTimeouts: 1,
      subscribedChannels: 1,
      transportCloseFailures: 0,
      transportConfigured: true,
      transportPublishFailures: 0,
      transportSubscribeFailures: 0,
      waitForHandlersDefault: true,
    });

    expect(snapshot.health).toEqual({
      reason: 'Event bus reported recoverable runtime failures.',
      status: 'degraded',
    });
    expect(snapshot.details).toMatchObject({
      shutdownDrainTimeoutMs: 20,
      shutdownDrainTimeouts: 1,
    });
  });
});
