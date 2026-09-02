import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createNotificationsPlatformStatusSnapshot,
  type NotificationsOperationMode,
  type NotificationsStatusDetails,
} from './status.js';

describe('createNotificationsPlatformStatusSnapshot', () => {
  it('reports ready/healthy semantics when at least one channel is registered', () => {
    const snapshot = createNotificationsPlatformStatusSnapshot({
      bulkQueueThreshold: 25,
      channelsRegistered: 2,
      eventPublicationEnabled: true,
      eventPublisherConfigured: true,
      queueConfigured: true,
    });

    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      channelsRegistered: 2,
      dependencies: ['notifications.queue-adapter', 'notifications.event-publisher'],
      eventPublicationEnabled: true,
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
      eventPublicationEnabled: false,
      eventPublisherConfigured: false,
      queueConfigured: false,
    });

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.health.status).toBe('unhealthy');
    expect(snapshot.readiness.reason).toContain('No notification channels');
    expect(snapshot.details).toMatchObject({
      dependencies: [],
      eventPublicationEnabled: false,
      eventPublisherConfigured: false,
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
      eventPublicationEnabled: true,
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
      eventPublicationEnabled: false,
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

  describe('configured publisher with disabled publication', () => {
    it('excludes the event publisher from active dependencies and event-backed operation mode', () => {
      const snapshot = createNotificationsPlatformStatusSnapshot({
        bulkQueueThreshold: 10,
        channelsRegistered: 1,
        eventPublicationEnabled: false,
        eventPublisherConfigured: true,
        queueConfigured: false,
      });

      expect(snapshot.details).toMatchObject({
        dependencies: [],
        eventPublicationEnabled: false,
        eventPublisherConfigured: true,
        operationMode: 'direct-only',
      });
    });

    it('does not report external ownership when the only configured seam is a disabled publisher', () => {
      const snapshot = createNotificationsPlatformStatusSnapshot({
        bulkQueueThreshold: 10,
        channelsRegistered: 1,
        eventPublicationEnabled: false,
        eventPublisherConfigured: true,
        queueConfigured: false,
      });

      expect(snapshot.ownership).toEqual({
        externallyManaged: false,
        ownsResources: false,
      });
    });

    it('keeps queue-backed operation mode free of event semantics', () => {
      const snapshot = createNotificationsPlatformStatusSnapshot({
        bulkQueueThreshold: 10,
        channelsRegistered: 1,
        eventPublicationEnabled: false,
        eventPublisherConfigured: true,
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

    it('stays unconfigured for operation mode when a disabled publisher is the only registration', () => {
      const snapshot = createNotificationsPlatformStatusSnapshot({
        bulkQueueThreshold: 0,
        channelsRegistered: 0,
        eventPublicationEnabled: false,
        eventPublisherConfigured: true,
        queueConfigured: false,
      });

      expect(snapshot.details).toMatchObject({
        dependencies: [],
        operationMode: 'unconfigured',
      });
      expect(snapshot.ownership).toEqual({
        externallyManaged: false,
        ownsResources: false,
      });
    });

    it('reports degraded health while a disabled publisher is the only configured integration', () => {
      const snapshot = createNotificationsPlatformStatusSnapshot({
        bulkQueueThreshold: 0,
        channelsRegistered: 0,
        eventPublicationEnabled: false,
        eventPublisherConfigured: true,
        queueConfigured: false,
      });

      expect(snapshot.health.status).toBe('unhealthy');
    });
  });

  it('treats an omitted enablement flag as enabled for configured publishers', () => {
    const snapshot = createNotificationsPlatformStatusSnapshot({
      bulkQueueThreshold: 10,
      channelsRegistered: 1,
      eventPublisherConfigured: true,
      queueConfigured: false,
    });

    expect(snapshot.details).toMatchObject({
      dependencies: ['notifications.event-publisher'],
      eventPublicationEnabled: true,
      eventPublisherConfigured: true,
      operationMode: 'direct-with-events',
    });
  });

  it('never enables publication without a configured publisher', () => {
    const snapshot = createNotificationsPlatformStatusSnapshot({
      bulkQueueThreshold: 10,
      channelsRegistered: 1,
      eventPublicationEnabled: true,
      eventPublisherConfigured: false,
      queueConfigured: false,
    });

    expect(snapshot.details).toMatchObject({
      dependencies: [],
      eventPublicationEnabled: false,
      eventPublisherConfigured: false,
      operationMode: 'direct-only',
    });
    expect(snapshot.ownership).toEqual({
      externallyManaged: false,
      ownsResources: false,
    });
  });

  it('exposes documented diagnostics as typed details while keeping an index signature for compatibility', () => {
    const snapshot = createNotificationsPlatformStatusSnapshot({
      bulkQueueThreshold: 12,
      channelsRegistered: 3,
      eventPublicationEnabled: false,
      eventPublisherConfigured: true,
      queueConfigured: true,
    });

    expectTypeOf(snapshot.details).toEqualTypeOf<NotificationsStatusDetails>();
    expectTypeOf(snapshot.details.bulkQueueThreshold).toEqualTypeOf<number>();
    expectTypeOf(snapshot.details.channelsRegistered).toEqualTypeOf<number>();
    expectTypeOf(snapshot.details.dependencies).toEqualTypeOf<readonly string[]>();
    expectTypeOf(snapshot.details.eventPublicationEnabled).toEqualTypeOf<boolean>();
    expectTypeOf(snapshot.details.eventPublisherConfigured).toEqualTypeOf<boolean>();
    expectTypeOf(snapshot.details.queueConfigured).toEqualTypeOf<boolean>();
    expectTypeOf(snapshot.details.operationMode).toEqualTypeOf<NotificationsOperationMode>();
    expectTypeOf<NotificationsStatusDetails['unknownFutureDetail']>().toEqualTypeOf<unknown>();

    const asRecord: Record<string, unknown> = snapshot.details;

    expect(asRecord.bulkQueueThreshold).toBe(12);
  });
});
