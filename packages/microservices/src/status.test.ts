import { describe, expect, it } from 'vitest';

import { createMicroservicePlatformStatusSnapshot } from './status.js';

describe('createMicroservicePlatformStatusSnapshot', () => {
  it('reports ready state with transport capability visibility', () => {
    const snapshot = createMicroservicePlatformStatusSnapshot({
      handlerCounts: {
        'bidi-stream': 0,
        'client-stream': 0,
        event: 2,
        message: 1,
        'server-stream': 1,
      },
      lifecycleState: 'ready',
      transportCapabilities: {
        bidiStream: true,
        clientStream: true,
        emit: true,
        send: true,
        serverStream: true,
      },
    });

    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      dependencies: ['transport.external'],
      lifecycleState: 'ready',
    });
  });

  it('marks failed listener state as not-ready/unhealthy', () => {
    const snapshot = createMicroservicePlatformStatusSnapshot({
      handlerCounts: {
        'bidi-stream': 0,
        'client-stream': 0,
        event: 0,
        message: 0,
        'server-stream': 0,
      },
      lastListenError: 'bind EADDRINUSE',
      lifecycleState: 'failed',
      transportCapabilities: {
        bidiStream: false,
        clientStream: false,
        emit: true,
        send: true,
        serverStream: false,
      },
    });

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.health.status).toBe('unhealthy');
    expect(snapshot.readiness.reason).toContain('EADDRINUSE');
  });
});
