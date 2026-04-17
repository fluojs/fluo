import { describe, expect, expectTypeOf, it } from 'vitest';

import * as notificationsPublicApi from './index.js';
import type {
  NotificationChannel,
  NotificationDispatchBatchResult,
  NotificationDispatchOptions,
  NotificationDispatchRequest,
  NotificationLifecycleEvent,
  Notifications,
  NotificationsEventPublisher,
  NotificationsModuleOptions,
  NotificationsQueueAdapter,
  NotificationsStatusAdapterInput,
} from './index.js';

describe('@fluojs/notifications public API surface', () => {
  it('keeps documented supported root-barrel exports stable', () => {
    expect(notificationsPublicApi).toHaveProperty('NotificationsModule');
    expect(notificationsPublicApi).toHaveProperty('NotificationsService');
    expect(notificationsPublicApi).toHaveProperty('NOTIFICATIONS');
    expect(notificationsPublicApi).toHaveProperty('NOTIFICATION_CHANNELS');
    expect(notificationsPublicApi).toHaveProperty('createNotificationsPlatformStatusSnapshot');
    expect(notificationsPublicApi).toHaveProperty('NotificationsConfigurationError');
    expect(notificationsPublicApi).toHaveProperty('NotificationChannelNotFoundError');
    expect(notificationsPublicApi).toHaveProperty('NotificationQueueNotConfiguredError');
  });

  it('keeps documented TypeScript-only contracts stable enough for leaf packages', () => {
    expectTypeOf<NotificationDispatchRequest>().toMatchTypeOf<{
      channel: string;
      payload: Record<string, unknown>;
    }>();
    expectTypeOf<NotificationDispatchOptions>().toMatchTypeOf<{
      publishLifecycleEvents?: boolean;
      queue?: boolean;
      signal?: AbortSignal;
    }>();
    expectTypeOf<NotificationChannel>().toHaveProperty('channel');
    expectTypeOf<NotificationChannel>().toHaveProperty('send');
    expectTypeOf<NotificationsQueueAdapter>().toHaveProperty('enqueue');
    expectTypeOf<NotificationsEventPublisher>().toHaveProperty('publish');
    expectTypeOf<Notifications>().toHaveProperty('dispatch');
    expectTypeOf<Notifications>().toHaveProperty('dispatchMany');
    expectTypeOf<NotificationsModuleOptions>().toMatchTypeOf<{
      channels?: readonly NotificationChannel[];
    }>();
    expectTypeOf<NotificationLifecycleEvent>().toMatchTypeOf<{
      channel: string;
      name:
        | 'notification.dispatch.requested'
        | 'notification.dispatch.queued'
        | 'notification.dispatch.delivered'
        | 'notification.dispatch.failed';
      occurredAt: string;
    }>();
    expectTypeOf<NotificationDispatchBatchResult>().toMatchTypeOf<{
      failed: number;
      queued: number;
      succeeded: number;
    }>();
    expectTypeOf<NotificationsStatusAdapterInput>().toMatchTypeOf<{
      bulkQueueThreshold: number;
      channelsRegistered: number;
      eventPublisherConfigured: boolean;
      queueConfigured: boolean;
    }>();
  });

  it('hides internal normalized options token from the root barrel', () => {
    expect(notificationsPublicApi).not.toHaveProperty('createNotificationsProviders');
    expect(notificationsPublicApi).not.toHaveProperty('NOTIFICATIONS_OPTIONS');
    expect(notificationsPublicApi).not.toHaveProperty('NotificationsOperationMode');
  });
});
