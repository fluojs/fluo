import { describe, expect, it } from 'vitest';

import { createNotificationsPlatformStatusSnapshot } from './status.js';

describe('createNotificationsPlatformStatusSnapshot', () => {
  it('reports ready/healthy semantics when at least one channel is registered', () => {
    const snapshot = createNotificationsPlatformStatusSnapshot({
      bulkQueueThreshold: 25,
      channelsRegistered: 2,
      eventPublisherConfigured: true,
      queueConfigured: true,
    });

    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      channelsRegistered: 2,
      operationMode: 'queue-backed-with-events',
    });
  });

  it('marks missing channels as not-ready and unhealthy when nothing is configured', () => {
    const snapshot = createNotificationsPlatformStatusSnapshot({
      bulkQueueThreshold: 10,
      channelsRegistered: 0,
      eventPublisherConfigured: false,
      queueConfigured: false,
    });

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.health.status).toBe('unhealthy');
    expect(snapshot.readiness.reason).toContain('No notification channels');
  });
});
