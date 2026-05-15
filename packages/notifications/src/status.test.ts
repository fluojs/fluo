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
      dependencies: ['notifications.queue-adapter', 'notifications.event-publisher'],
      eventPublisherConfigured: true,
      operationMode: 'queue-backed-with-events',
      queueConfigured: true,
    });
    expect(snapshot.ownership).toEqual({
      externallyManaged: true,
      ownsResources: false,
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
    expect(snapshot.details).toMatchObject({
      dependencies: [],
      operationMode: 'unconfigured',
    });
    expect(snapshot.ownership).toEqual({
      externallyManaged: false,
      ownsResources: false,
    });
  });

  it('reports event publisher dependency diagnostics without queue ownership', () => {
    const snapshot = createNotificationsPlatformStatusSnapshot({
      bulkQueueThreshold: 10,
      channelsRegistered: 1,
      eventPublisherConfigured: true,
      queueConfigured: false,
    });

    expect(snapshot.details).toMatchObject({
      dependencies: ['notifications.event-publisher'],
      operationMode: 'direct-with-events',
    });
    expect(snapshot.ownership).toEqual({
      externallyManaged: true,
      ownsResources: false,
    });
  });

  it('reports queue adapter dependency diagnostics without event publishing', () => {
    const snapshot = createNotificationsPlatformStatusSnapshot({
      bulkQueueThreshold: 10,
      channelsRegistered: 1,
      eventPublisherConfigured: false,
      queueConfigured: true,
    });

    expect(snapshot.details).toMatchObject({
      dependencies: ['notifications.queue-adapter'],
      operationMode: 'queue-backed',
    });
    expect(snapshot.ownership).toEqual({
      externallyManaged: true,
      ownsResources: false,
    });
  });
});
