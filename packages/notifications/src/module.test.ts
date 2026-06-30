import { type Constructor, Inject, Module, type Token } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import { Container, type Provider } from '@fluojs/di';
import { createTestingModule } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { NotificationChannelNotFoundError, NotificationQueueNotConfiguredError } from './errors.js';
import { NotificationsModule } from './module.js';
import { NotificationsService } from './service.js';
import { NOTIFICATION_CHANNELS, NOTIFICATIONS } from './tokens.js';
import type {
  NotificationChannel,
  NotificationDispatchRequest,
  NotificationDispatchResult,
  NotificationLifecycleEvent,
  Notifications,
  NotificationsEventPublisher,
  NotificationsQueueAdapter,
  NotificationsQueueJob,
} from './types.js';

function moduleProviders(moduleType: Constructor): Provider[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.providers)) {
    throw new Error('NotificationsModule did not register providers metadata.');
  }

  return metadata.providers as Provider[];
}

class RecordingPublisher implements NotificationsEventPublisher {
  readonly events: NotificationLifecycleEvent[] = [];
  failOnNames = new Set<NotificationLifecycleEvent['name']>();

  async publish(event: NotificationLifecycleEvent): Promise<void> {
    if (this.failOnNames.has(event.name)) {
      throw new Error(`publisher failed:${event.name}`);
    }

    this.events.push(event);
  }
}

class RecordingQueueAdapter implements NotificationsQueueAdapter {
  readonly jobs: NotificationsQueueJob[] = [];
  failOnEnqueue = false;
  failOnEnqueueMany = false;

  async enqueue(job: NotificationsQueueJob): Promise<string> {
    if (this.failOnEnqueue) {
      throw new Error('queue enqueue failed');
    }

    this.jobs.push(job);
    return `queued:${this.jobs.length}`;
  }

  async enqueueMany(jobs: readonly NotificationsQueueJob[]): Promise<readonly string[]> {
    if (this.failOnEnqueueMany) {
      throw new Error('queue enqueueMany failed');
    }

    this.jobs.push(...jobs);
    return jobs.map((_, index) => `queued:${index + 1}`);
  }
}

class LifecycleAwareQueueAdapter extends RecordingQueueAdapter {
  constructor(private readonly lifecycleCalls: string[]) {
    super();
  }

  async close(): Promise<void> {
    this.lifecycleCalls.push('queue.close');
  }

  async drain(): Promise<void> {
    this.lifecycleCalls.push('queue.drain');
  }

  onDestroy(): void {
    this.lifecycleCalls.push('queue.onDestroy');
  }
}

class LifecycleAwarePublisher extends RecordingPublisher {
  constructor(private readonly lifecycleCalls: string[]) {
    super();
  }

  async close(): Promise<void> {
    this.lifecycleCalls.push('publisher.close');
  }

  async drain(): Promise<void> {
    this.lifecycleCalls.push('publisher.drain');
  }

  onDestroy(): void {
    this.lifecycleCalls.push('publisher.onDestroy');
  }
}

class MalformedEnqueueManyQueueAdapter implements NotificationsQueueAdapter {
  readonly jobs: NotificationsQueueJob[] = [];

  constructor(private readonly result: unknown) {}

  async enqueue(job: NotificationsQueueJob): Promise<string> {
    this.jobs.push(job);
    return `queued:${this.jobs.length}`;
  }

  async enqueueMany(jobs: readonly NotificationsQueueJob[]): Promise<readonly string[]> {
    this.jobs.push(...jobs);
    return this.result as readonly string[];
  }
}

class EnqueueOnlyQueueAdapter implements NotificationsQueueAdapter {
  readonly jobs: NotificationsQueueJob[] = [];

  async enqueue(job: NotificationsQueueJob): Promise<string> {
    this.jobs.push(job);
    return `queued:${this.jobs.length}`;
  }
}

class FailingEnqueueOnlyQueueAdapter implements NotificationsQueueAdapter {
  readonly jobs: NotificationsQueueJob[] = [];
  private calls = 0;

  constructor(private readonly failOnCall: number) {}

  async enqueue(job: NotificationsQueueJob): Promise<string> {
    this.calls += 1;

    if (this.calls === this.failOnCall) {
      throw new Error(`queue enqueue failed:${this.failOnCall}`);
    }

    this.jobs.push(job);
    return `queued:${this.jobs.length}`;
  }
}

describe('NotificationsModule', () => {
  it('makes default global providers visible through a real testing module graph', async () => {
    const deliveries: string[] = [];

    @Inject(NotificationsService)
    class RootNotificationsProbe {
      constructor(private readonly notifications: NotificationsService) {}

      send(): Promise<NotificationDispatchResult> {
        return this.notifications.dispatch({ channel: 'email', payload: { template: 'global-visible' } });
      }
    }

    @Module({
      imports: [
        NotificationsModule.forRoot({
          channels: [
            {
              channel: 'email',
              async send(notification: NotificationDispatchRequest) {
                deliveries.push(String(notification.payload.template));

                return { externalId: 'global-delivery' };
              },
            },
          ],
        }),
      ],
    })
    class NotificationsOwnerModule {}

    @Module({
      imports: [NotificationsOwnerModule],
      providers: [RootNotificationsProbe],
    })
    class AppModule {}

    const testingModule = await createTestingModule({ rootModule: AppModule }).compile();

    try {
      const probe = await testingModule.resolve<RootNotificationsProbe>(RootNotificationsProbe);

      await expect(probe.send()).resolves.toMatchObject({
        deliveryId: 'global-delivery',
        queued: false,
        status: 'delivered',
      });
      expect(deliveries).toEqual(['global-visible']);
    } finally {
      await testingModule.container.dispose();
    }
  });

  it('keeps providers usable inside the importing module when global visibility is disabled', async () => {
    const deliveries: string[] = [];

    @Inject(NotificationsService)
    class LocalNotificationsProbe {
      constructor(private readonly notifications: NotificationsService) {}

      send(): Promise<NotificationDispatchResult> {
        return this.notifications.dispatch({ channel: 'email', payload: { template: 'local-visible' } });
      }
    }

    @Module({
      imports: [
        NotificationsModule.forRoot({
          channels: [
            {
              channel: 'email',
              async send(notification: NotificationDispatchRequest) {
                deliveries.push(String(notification.payload.template));

                return { externalId: 'local-delivery' };
              },
            },
          ],
          global: false,
        }),
      ],
      providers: [LocalNotificationsProbe],
    })
    class NotificationsOwnerModule {}

    @Module({
      imports: [NotificationsOwnerModule],
    })
    class AppModule {}

    const testingModule = await createTestingModule({ rootModule: AppModule }).compile();

    try {
      const probe = await testingModule.resolve<LocalNotificationsProbe>(LocalNotificationsProbe);

      await expect(probe.send()).resolves.toMatchObject({
        deliveryId: 'local-delivery',
        queued: false,
        status: 'delivered',
      });
      expect(deliveries).toEqual(['local-visible']);
    } finally {
      await testingModule.container.dispose();
    }
  });

  it('does not expose module-local providers to sibling/root providers in a real testing module graph', async () => {
    @Inject(NotificationsService)
    class RootNotificationsProbe {
      constructor(readonly notifications: NotificationsService) {}
    }

    @Module({
      imports: [
        NotificationsModule.forRoot({
          channels: [
            {
              channel: 'email',
              async send() {
                return { externalId: 'local-only' };
              },
            },
          ],
          global: false,
        }),
      ],
    })
    class NotificationsOwnerModule {}

    @Module({
      imports: [NotificationsOwnerModule],
      providers: [RootNotificationsProbe],
    })
    class AppModule {}

    await expect(createTestingModule({ rootModule: AppModule }).compile()).rejects.toThrow(
      /not visible through a global module|NotificationsService/,
    );
  });

  it('registers sync providers and dispatches through a configured channel', async () => {
    const deliveries: Array<{ payload: Record<string, unknown>; recipients?: readonly string[] }> = [];
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send(notification: NotificationDispatchRequest) {
            deliveries.push({ payload: notification.payload, recipients: notification.recipients });

            return {
              externalId: 'delivery-1',
              metadata: { provider: 'email' },
            };
          },
        },
      ],
    });

    container.register(...moduleProviders(moduleType));

    const service = await container.resolve(NotificationsService);
    const result = await service.dispatch({
      channel: 'email',
      payload: { template: 'welcome', userId: 'user-1' },
      recipients: ['user@example.com'],
      subject: 'Welcome',
    });

    expect(result).toEqual({
      channel: 'email',
      deliveryId: 'delivery-1',
      metadata: { provider: 'email' },
      queued: false,
      status: 'delivered',
    });
    expect(deliveries).toEqual([
      {
        payload: { template: 'welcome', userId: 'user-1' },
        recipients: ['user@example.com'],
      },
    ]);
  });

  it('supports documented class-level service injection for application services', async () => {
    const deliveries: string[] = [];

    @Inject(NotificationsService)
    class WelcomeService {
      constructor(private readonly notifications: NotificationsService) {}

      async sendWelcomeEmail(email: string): Promise<NotificationDispatchResult> {
        return this.notifications.dispatch({
          channel: 'email',
          payload: { template: 'welcome-email' },
          recipients: [email],
          subject: 'Welcome to fluo',
        });
      }
    }

    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send(notification: NotificationDispatchRequest) {
            deliveries.push(notification.recipients?.[0] ?? 'missing-recipient');

            return { externalId: 'welcome-1' };
          },
        },
      ],
    });

    container.register(...moduleProviders(moduleType), WelcomeService);
    const service = await container.resolve(WelcomeService);

    await expect(service.sendWelcomeEmail('user@example.com')).resolves.toMatchObject({
      channel: 'email',
      deliveryId: 'welcome-1',
      queued: false,
      status: 'delivered',
    });
    expect(deliveries).toEqual(['user@example.com']);
  });

  it('keeps single dispatch direct by default even when bulkThreshold is 1', async () => {
    const queue = new RecordingQueueAdapter();
    const deliveries: string[] = [];
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            deliveries.push('direct');
            return { externalId: 'direct-1' };
          },
        },
      ],
      queue: {
        adapter: queue,
        bulkThreshold: 1,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const result = await service.dispatch({ channel: 'email', payload: { template: 'single' } });

    expect(result).toMatchObject({ deliveryId: 'direct-1', queued: false, status: 'delivered' });
    expect(deliveries).toEqual(['direct']);
    expect(queue.jobs).toHaveLength(0);
  });

  it('still allows single dispatch to opt into queue delivery explicitly', async () => {
    const queue = new RecordingQueueAdapter();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not run when queue is explicitly requested');
          },
        },
      ],
      queue: {
        adapter: queue,
        bulkThreshold: 50,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const result = await service.dispatch({ channel: 'email', payload: { template: 'single' } }, { queue: true });

    expect(result).toMatchObject({ deliveryId: 'queued:1', queued: true, status: 'queued' });
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]?.id).toMatch(/^notification:email:[a-z0-9]{7}$/);
    expect(queue.jobs[0]).toMatchObject({
      channel: 'email',
      notification: { channel: 'email', payload: { template: 'single' } },
    });
  });

  it('forces single dispatch through direct delivery when queue is explicitly disabled', async () => {
    const queue = new RecordingQueueAdapter();
    const deliveries: string[] = [];
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send(notification: NotificationDispatchRequest) {
            deliveries.push(String(notification.payload.template));
            return { externalId: 'direct-disabled-queue' };
          },
        },
      ],
      queue: {
        adapter: queue,
        bulkThreshold: 1,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const result = await service.dispatch({ channel: 'email', payload: { template: 'single-direct' } }, { queue: false });

    expect(result).toMatchObject({ deliveryId: 'direct-disabled-queue', queued: false, status: 'delivered' });
    expect(deliveries).toEqual(['single-direct']);
    expect(queue.jobs).toHaveLength(0);
  });

  it('uses stable queue job ids so queue adapters can deduplicate repeated requests', async () => {
    const queue = new RecordingQueueAdapter();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not run when queue is explicitly requested');
          },
        },
      ],
      queue: {
        adapter: queue,
        bulkThreshold: 2,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const request = { channel: 'email', payload: { template: 'digest', userId: 'u1' } };

    await service.dispatch(request, { queue: true });
    await service.dispatch(request, { queue: true });
    await service.dispatch({ ...request, id: 'caller-job-id' }, { queue: true });

    const [firstJob, repeatedJob, callerJob] = queue.jobs;

    expect(firstJob?.id).toMatch(/^notification:email:[a-z0-9]{7}$/);
    expect(repeatedJob?.id).toBe(firstJob?.id);
    expect(callerJob?.id).toBe('caller-job-id');
  });

  it('does not close or drain application-owned queue and event publisher resources during testing module disposal', async () => {
    const lifecycleCalls: string[] = [];
    const queue = new LifecycleAwareQueueAdapter(lifecycleCalls);
    const publisher = new LifecycleAwarePublisher(lifecycleCalls);

    @Module({
      imports: [
        NotificationsModule.forRoot({
          channels: [
            {
              channel: 'email',
              async send() {
                throw new Error('direct delivery should not run when queue is explicitly requested');
              },
            },
          ],
          events: {
            publisher,
          },
          queue: {
            adapter: queue,
            bulkThreshold: 1,
          },
        }),
      ],
    })
    class AppModule {}

    const testingModule = await createTestingModule({ rootModule: AppModule }).compile();

    try {
      const service = await testingModule.resolve<NotificationsService>(NotificationsService);

      await expect(
        service.dispatch({ channel: 'email', payload: { template: 'queued-owned-by-app' } }, { queue: true }),
      ).resolves.toMatchObject({
        deliveryId: 'queued:1',
        queued: true,
        status: 'queued',
      });
      expect(queue.jobs).toHaveLength(1);
      expect(publisher.events.map((event) => event.name)).toEqual([
        'notification.dispatch.requested',
        'notification.dispatch.queued',
      ]);
    } finally {
      await testingModule.container.dispose();
    }

    expect(lifecycleCalls).toEqual([]);
  });

  it('publishes a failed lifecycle event when explicit queue dispatch enqueue fails', async () => {
    const queue = new RecordingQueueAdapter();
    queue.failOnEnqueue = true;
    const publisher = new RecordingPublisher();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not run when queue is explicitly requested');
          },
        },
      ],
      events: {
        publishLifecycleEvents: true,
        publisher,
      },
      queue: {
        adapter: queue,
        bulkThreshold: 50,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await expect(service.dispatch({ channel: 'email', payload: { template: 'single' } }, { queue: true })).rejects.toThrow(
      'queue enqueue failed',
    );
    expect(publisher.events).toMatchObject([
      {
        channel: 'email',
        name: 'notification.dispatch.requested',
      },
      {
        channel: 'email',
        error: { message: 'queue enqueue failed', name: 'Error' },
        name: 'notification.dispatch.failed',
      },
    ]);
  });

  it('surfaces explicit queue enqueue failure publication errors with the original queue error', async () => {
    const queue = new RecordingQueueAdapter();
    queue.failOnEnqueue = true;
    const publisher = new RecordingPublisher();
    publisher.failOnNames.add('notification.dispatch.failed');
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not run when queue is explicitly requested');
          },
        },
      ],
      events: {
        publishLifecycleEvents: true,
        publisher,
      },
      queue: {
        adapter: queue,
        bulkThreshold: 50,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const dispatch = service.dispatch({ channel: 'email', payload: { template: 'single' } }, { queue: true });

    await expect(dispatch).rejects.toBeInstanceOf(AggregateError);
    await expect(dispatch).rejects.toThrow(
      'Notification dispatch failed, and failed lifecycle event publication also failed: queue enqueue failed',
    );

    try {
      await dispatch;
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toHaveLength(2);
      expect((error as AggregateError).errors[0]).toMatchObject({ message: 'queue enqueue failed' });
      expect((error as AggregateError).errors[1]).toMatchObject({
        message: 'publisher failed:notification.dispatch.failed',
      });
    }
  });

  it('defaults lifecycle publication on when an events publisher is configured', async () => {
    const publisher = new RecordingPublisher();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            return { externalId: 'delivery-default-events' };
          },
        },
      ],
      events: {
        publisher,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await expect(service.dispatch({ channel: 'email', payload: { template: 'default-events' } })).resolves.toMatchObject({
      deliveryId: 'delivery-default-events',
      status: 'delivered',
    });
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.delivered',
    ]);
  });

  it('does not publish lifecycle events when module configuration opts out', async () => {
    const publisher = new RecordingPublisher();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            return { externalId: 'delivery-events-disabled' };
          },
        },
      ],
      events: {
        publishLifecycleEvents: false,
        publisher,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await expect(service.dispatch({ channel: 'email', payload: { template: 'events-disabled' } })).resolves.toMatchObject({
      deliveryId: 'delivery-events-disabled',
      status: 'delivered',
    });
    expect(publisher.events).toEqual([]);
  });

  it('publishes requested and failed lifecycle events for direct missing-channel dispatch', async () => {
    const publisher = new RecordingPublisher();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [],
      events: {
        publisher,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await expect(service.dispatch({ channel: 'discord', payload: { template: 'missing' } })).rejects.toBeInstanceOf(
      NotificationChannelNotFoundError,
    );
    expect(publisher.events).toMatchObject([
      {
        channel: 'discord',
        name: 'notification.dispatch.requested',
      },
      {
        channel: 'discord',
        error: { message: 'No notification channel is registered for "discord".', name: 'NotificationChannelNotFoundError' },
        name: 'notification.dispatch.failed',
      },
    ]);
  });

  it('preserves requested lifecycle publication failures when a later direct dispatch fails', async () => {
    const publisher = new RecordingPublisher();
    publisher.failOnNames.add('notification.dispatch.requested');
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('channel delivery failed after requested publication failed');
          },
        },
      ],
      events: {
        publisher,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const dispatch = service.dispatch({ channel: 'email', payload: { template: 'broken-requested' } });

    await expect(dispatch).rejects.toBeInstanceOf(AggregateError);
    await expect(dispatch).rejects.toThrow(
      'Notification dispatch failed, and failed lifecycle event publication also failed: channel delivery failed after requested publication failed',
    );

    try {
      await dispatch;
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toHaveLength(2);
      expect((error as AggregateError).errors[0]).toMatchObject({
        message: 'channel delivery failed after requested publication failed',
      });
      expect((error as AggregateError).errors[1]).toMatchObject({
        message: 'publisher failed:notification.dispatch.requested',
      });
    }

    expect(publisher.events).toMatchObject([
      {
        channel: 'email',
        error: { message: 'channel delivery failed after requested publication failed', name: 'Error' },
        name: 'notification.dispatch.failed',
      },
    ]);
  });

  it('validates channels before queueing a single explicit queue dispatch', async () => {
    const queue = new RecordingQueueAdapter();
    const publisher = new RecordingPublisher();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not run when queue is explicitly requested');
          },
        },
      ],
      queue: {
        adapter: queue,
        bulkThreshold: 50,
      },
      events: {
        publisher,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await expect(
      service.dispatch({ channel: 'discord', payload: { template: 'unknown' } }, { queue: true }),
    ).rejects.toBeInstanceOf(NotificationChannelNotFoundError);
    expect(queue.jobs).toHaveLength(0);
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.failed',
    ]);
  });

  it('resolves async options once and exposes the compatibility facade and channel token', async () => {
    const API_KEY = Symbol('api-key');
    const publisher = new RecordingPublisher();
    const factoryCalls: string[] = [];
    const deliveries: string[] = [];
    const container = new Container();
    const moduleType = NotificationsModule.forRootAsync({
      inject: [API_KEY],
      useFactory: async (...deps: unknown[]) => {
        const [apiKey] = deps;

        if (typeof apiKey !== 'string') {
          throw new Error('api key must be a string');
        }

        factoryCalls.push(apiKey);

        return {
          channels: [
            {
              channel: 'slack',
              async send(notification: NotificationDispatchRequest) {
                deliveries.push(`${String(notification.payload.message)}:${apiKey}`);
                return { externalId: 'slack-1' };
              },
            },
          ],
          events: {
            publishLifecycleEvents: true,
            publisher,
          },
        };
      },
    });

    container.register({ provide: API_KEY as Token<string>, useValue: 'secret-key' }, ...moduleProviders(moduleType));

    const facade = await container.resolve<Notifications>(NOTIFICATIONS);
    const channels = await container.resolve(NOTIFICATION_CHANNELS);
    const service = await container.resolve(NotificationsService);

    await expect(
      facade.dispatch({ channel: 'slack', payload: { message: 'hello' } }),
    ).resolves.toMatchObject({ channel: 'slack', deliveryId: 'slack-1', queued: false });

    expect(service).toBeInstanceOf(NotificationsService);
    expect(channels.map((channel: NotificationChannel) => channel.channel)).toEqual(['slack']);
    expect(Object.isFrozen(channels)).toBe(true);
    expect(factoryCalls).toEqual(['secret-key']);
    expect(deliveries).toEqual(['hello:secret-key']);
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.delivered',
    ]);
  });

  it('uses the optional queue seam for bulk delivery when the threshold is met', async () => {
    const queue = new RecordingQueueAdapter();
    const publisher = new RecordingPublisher();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not be used for queued bulk dispatch');
          },
        },
      ],
      queue: {
        adapter: queue,
        bulkThreshold: 2,
      },
      events: {
        publishLifecycleEvents: true,
        publisher,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const result = await service.dispatchMany([
      { channel: 'email', payload: { template: 'digest', userId: 'u1' } },
      { channel: 'email', id: 'caller-bulk-job-id', payload: { template: 'digest', userId: 'u2' } },
    ]);

    expect(queue.jobs).toHaveLength(2);
    expect(queue.jobs[0]?.id).toMatch(/^notification:email:/);
    expect(queue.jobs[1]?.id).toBe('caller-bulk-job-id');
    expect(result).toMatchObject({
      failed: 0,
      queued: 2,
      succeeded: 2,
    });
    expect(result.results.map((entry: NotificationDispatchResult) => entry.deliveryId)).toEqual(['queued:1', 'queued:2']);
    expect(publisher.events).toMatchObject([
      {
        channel: 'email',
        deliveryId: undefined,
        name: 'notification.dispatch.requested',
      },
      {
        channel: 'email',
        deliveryId: undefined,
        name: 'notification.dispatch.requested',
      },
      {
        channel: 'email',
        deliveryId: 'queued:1',
        name: 'notification.dispatch.queued',
      },
      {
        channel: 'email',
        deliveryId: 'queued:2',
        name: 'notification.dispatch.queued',
      },
    ]);
  });

  it('rejects malformed enqueueMany results without fabricating queued successes', async () => {
    const queue = new MalformedEnqueueManyQueueAdapter(['queued:1']);
    const publisher = new RecordingPublisher();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not be used for queued bulk dispatch');
          },
        },
      ],
      queue: {
        adapter: queue,
        bulkThreshold: 2,
      },
      events: {
        publisher,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await expect(
      service.dispatchMany([
        { channel: 'email', payload: { template: 'digest', userId: 'u1' } },
        { channel: 'email', payload: { template: 'digest', userId: 'u2' } },
      ]),
    ).rejects.toThrow('Notifications queue adapter returned an invalid enqueueMany() result: expected 2 queue ids but received 1.');

    expect(queue.jobs).toHaveLength(2);
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.requested',
      'notification.dispatch.failed',
      'notification.dispatch.failed',
    ]);
  });

  it('rejects empty enqueueMany ids without substituting fallback delivery ids', async () => {
    const queue = new MalformedEnqueueManyQueueAdapter(['queued:1', '']);
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not be used for queued bulk dispatch');
          },
        },
      ],
      queue: {
        adapter: queue,
        bulkThreshold: 2,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await expect(
      service.dispatchMany([
        { channel: 'email', payload: { template: 'digest', userId: 'u1' } },
        { channel: 'email', payload: { template: 'digest', userId: 'u2' } },
      ]),
    ).rejects.toThrow('Notifications queue adapter returned an invalid enqueueMany() result: queue id at index 1 must be a non-empty string.');
  });

  it('rejects sparse enqueueMany results without substituting fallback delivery ids', async () => {
    const queue = new MalformedEnqueueManyQueueAdapter(new Array<string>(2));
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not be used for queued bulk dispatch');
          },
        },
      ],
      queue: {
        adapter: queue,
        bulkThreshold: 2,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await expect(
      service.dispatchMany([
        { channel: 'email', payload: { template: 'digest', userId: 'u1' } },
        { channel: 'email', payload: { template: 'digest', userId: 'u2' } },
      ]),
    ).rejects.toThrow('Notifications queue adapter returned an invalid enqueueMany() result: queue id at index 0 must be present.');
  });

  it('falls back to per-job enqueue calls when the queue adapter omits enqueueMany', async () => {
    const queue = new EnqueueOnlyQueueAdapter();
    const publisher = new RecordingPublisher();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not be used for queued bulk dispatch');
          },
        },
      ],
      queue: {
        adapter: queue,
        bulkThreshold: 2,
      },
      events: {
        publisher,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const result = await service.dispatchMany([
      { channel: 'email', payload: { template: 'digest', userId: 'u1' } },
      { channel: 'email', payload: { template: 'digest', userId: 'u2' } },
    ]);

    expect(queue.jobs).toHaveLength(2);
    expect(result.results.map((entry: NotificationDispatchResult) => entry.deliveryId)).toEqual(['queued:1', 'queued:2']);
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.requested',
      'notification.dispatch.queued',
      'notification.dispatch.queued',
    ]);
  });

  it('reports partial enqueue results from sequential queue fallback when continueOnError is enabled', async () => {
    const queue = new FailingEnqueueOnlyQueueAdapter(2);
    const publisher = new RecordingPublisher();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not be used for queued bulk dispatch');
          },
        },
      ],
      queue: {
        adapter: queue,
        bulkThreshold: 2,
      },
      events: {
        publisher,
      },
    });

    const notifications = [
      { channel: 'email', id: 'first-job', payload: { template: 'digest', userId: 'u1' } },
      { channel: 'email', id: 'second-job', payload: { template: 'digest', userId: 'u2' } },
      { channel: 'email', id: 'third-job', payload: { template: 'digest', userId: 'u3' } },
    ];

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const result = await service.dispatchMany(notifications, { continueOnError: true });

    expect(queue.jobs.map((job) => job.id)).toEqual(['first-job', 'third-job']);
    expect(result).toMatchObject({
      failed: 1,
      queued: 2,
      succeeded: 2,
    });
    expect(result.results.map((entry: NotificationDispatchResult) => entry.deliveryId)).toEqual(['queued:1', 'queued:2']);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.notification).toBe(notifications[1]);
    expect(result.failures[0]?.error).toMatchObject({ message: 'queue enqueue failed:2' });
    expect(publisher.events).toMatchObject([
      { channel: 'email', name: 'notification.dispatch.requested' },
      { channel: 'email', name: 'notification.dispatch.requested' },
      { channel: 'email', name: 'notification.dispatch.requested' },
      { channel: 'email', deliveryId: 'queued:1', name: 'notification.dispatch.queued' },
      {
        channel: 'email',
        error: { message: 'queue enqueue failed:2', name: 'Error' },
        name: 'notification.dispatch.failed',
      },
      { channel: 'email', deliveryId: 'queued:2', name: 'notification.dispatch.queued' },
    ]);
  });

  it('preserves sequential queue fallback partial results when failed lifecycle publication fails under continueOnError', async () => {
    const queue = new FailingEnqueueOnlyQueueAdapter(2);
    const publisher = new RecordingPublisher();
    publisher.failOnNames.add('notification.dispatch.failed');
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not be used for queued bulk dispatch');
          },
        },
      ],
      queue: {
        adapter: queue,
        bulkThreshold: 2,
      },
      events: {
        publisher,
      },
    });

    const notifications = [
      { channel: 'email', id: 'first-job', payload: { template: 'digest', userId: 'u1' } },
      { channel: 'email', id: 'second-job', payload: { template: 'digest', userId: 'u2' } },
      { channel: 'email', id: 'third-job', payload: { template: 'digest', userId: 'u3' } },
    ];

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const result = await service.dispatchMany(notifications, { continueOnError: true });

    expect(queue.jobs.map((job) => job.id)).toEqual(['first-job', 'third-job']);
    expect(result).toMatchObject({
      failed: 1,
      queued: 2,
      succeeded: 2,
    });
    expect(result.results.map((entry: NotificationDispatchResult) => entry.deliveryId)).toEqual(['queued:1', 'queued:2']);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.notification).toBe(notifications[1]);
    expect(result.failures[0]?.error).toBeInstanceOf(AggregateError);

    const failureError = result.failures[0]?.error;

    if (!(failureError instanceof AggregateError)) {
      throw new Error('Expected sequential fallback failure to include lifecycle publication failure details.');
    }

    expect(failureError.errors).toHaveLength(2);
    expect(failureError.errors[0]).toMatchObject({ message: 'queue enqueue failed:2' });
    expect(failureError.errors[1]).toMatchObject({ message: 'publisher failed:notification.dispatch.failed' });
    expect(publisher.events).toMatchObject([
      { channel: 'email', name: 'notification.dispatch.requested' },
      { channel: 'email', name: 'notification.dispatch.requested' },
      { channel: 'email', name: 'notification.dispatch.requested' },
      { channel: 'email', deliveryId: 'queued:1', name: 'notification.dispatch.queued' },
      { channel: 'email', deliveryId: 'queued:2', name: 'notification.dispatch.queued' },
    ]);
  });

  it('publishes terminal events for all requested sequential fallback jobs after an enqueue failure', async () => {
    const queue = new FailingEnqueueOnlyQueueAdapter(2);
    const publisher = new RecordingPublisher();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not be used for queued bulk dispatch');
          },
        },
      ],
      queue: {
        adapter: queue,
        bulkThreshold: 2,
      },
      events: {
        publisher,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await expect(
      service.dispatchMany([
        { channel: 'email', id: 'first-job', payload: { template: 'digest', userId: 'u1' } },
        { channel: 'email', id: 'second-job', payload: { template: 'digest', userId: 'u2' } },
        { channel: 'email', id: 'third-job', payload: { template: 'digest', userId: 'u3' } },
      ]),
    ).rejects.toThrow('queue enqueue failed:2');

    expect(queue.jobs.map((job) => job.id)).toEqual(['first-job']);
    expect(publisher.events).toMatchObject([
      { channel: 'email', name: 'notification.dispatch.requested' },
      { channel: 'email', name: 'notification.dispatch.requested' },
      { channel: 'email', name: 'notification.dispatch.requested' },
      { channel: 'email', deliveryId: 'queued:1', name: 'notification.dispatch.queued' },
      {
        channel: 'email',
        error: { message: 'queue enqueue failed:2', name: 'Error' },
        name: 'notification.dispatch.failed',
      },
      {
        channel: 'email',
        error: { message: 'queue enqueue failed:2', name: 'Error' },
        name: 'notification.dispatch.failed',
      },
    ]);
  });

  it('publishes failed lifecycle events for queued bulk dispatch when the queue is missing', async () => {
    const publisher = new RecordingPublisher();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not be used for queued bulk dispatch');
          },
        },
      ],
      events: {
        publisher,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await expect(
      service.dispatchMany(
        [
          { channel: 'email', payload: { template: 'digest', userId: 'u1' } },
          { channel: 'email', payload: { template: 'digest', userId: 'u2' } },
        ],
        { queue: true },
      ),
    ).rejects.toBeInstanceOf(NotificationQueueNotConfiguredError);

    expect(publisher.events).toMatchObject([
      { channel: 'email', name: 'notification.dispatch.requested' },
      { channel: 'email', name: 'notification.dispatch.requested' },
      {
        channel: 'email',
        error: { message: 'Queue-backed notification delivery requires a configured queue adapter.', name: 'NotificationQueueNotConfiguredError' },
        name: 'notification.dispatch.failed',
      },
      {
        channel: 'email',
        error: { message: 'Queue-backed notification delivery requires a configured queue adapter.', name: 'NotificationQueueNotConfiguredError' },
        name: 'notification.dispatch.failed',
      },
    ]);
  });

  it('publishes deterministic failed lifecycle events when bulk queue enqueue fails', async () => {
    const queue = new RecordingQueueAdapter();
    queue.failOnEnqueueMany = true;
    const publisher = new RecordingPublisher();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not be used for queued bulk dispatch');
          },
        },
      ],
      events: {
        publishLifecycleEvents: true,
        publisher,
      },
      queue: {
        adapter: queue,
        bulkThreshold: 2,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await expect(
      service.dispatchMany([
        { channel: 'email', payload: { template: 'digest', userId: 'u1' } },
        { channel: 'email', payload: { template: 'digest', userId: 'u2' } },
      ]),
    ).rejects.toThrow('queue enqueueMany failed');

    expect(publisher.events).toMatchObject([
      {
        channel: 'email',
        name: 'notification.dispatch.requested',
      },
      {
        channel: 'email',
        name: 'notification.dispatch.requested',
      },
      {
        channel: 'email',
        error: { message: 'queue enqueueMany failed', name: 'Error' },
        name: 'notification.dispatch.failed',
      },
      {
        channel: 'email',
        error: { message: 'queue enqueueMany failed', name: 'Error' },
        name: 'notification.dispatch.failed',
      },
    ]);
  });

  it('surfaces bulk queue enqueue failure publication errors from allSettled results', async () => {
    const queue = new RecordingQueueAdapter();
    queue.failOnEnqueueMany = true;
    const publisher = new RecordingPublisher();
    publisher.failOnNames.add('notification.dispatch.failed');
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not be used for queued bulk dispatch');
          },
        },
      ],
      events: {
        publishLifecycleEvents: true,
        publisher,
      },
      queue: {
        adapter: queue,
        bulkThreshold: 2,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const dispatch = service.dispatchMany([
      { channel: 'email', payload: { template: 'digest', userId: 'u1' } },
      { channel: 'email', payload: { template: 'digest', userId: 'u2' } },
    ]);

    await expect(dispatch).rejects.toBeInstanceOf(AggregateError);
    await expect(dispatch).rejects.toThrow(
      'Notification dispatch failed, and failed lifecycle event publication also failed: queue enqueueMany failed',
    );

    try {
      await dispatch;
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toHaveLength(3);
      expect((error as AggregateError).errors[0]).toMatchObject({ message: 'queue enqueueMany failed' });
      expect((error as AggregateError).errors[1]).toMatchObject({
        message: 'publisher failed:notification.dispatch.failed',
      });
      expect((error as AggregateError).errors[2]).toMatchObject({
        message: 'publisher failed:notification.dispatch.failed',
      });
    }
  });

  it('validates channels before queueing bulk deliveries', async () => {
    const queue = new RecordingQueueAdapter();
    const publisher = new RecordingPublisher();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not run for queued bulk dispatch');
          },
        },
      ],
      queue: {
        adapter: queue,
        bulkThreshold: 2,
      },
      events: {
        publisher,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await expect(
      service.dispatchMany([
        { channel: 'email', payload: { template: 'known' } },
        { channel: 'discord', payload: { template: 'unknown' } },
      ]),
    ).rejects.toBeInstanceOf(NotificationChannelNotFoundError);
    expect(queue.jobs).toHaveLength(0);
    expect(publisher.events).toMatchObject([
      {
        channel: 'email',
        name: 'notification.dispatch.requested',
      },
      {
        channel: 'discord',
        name: 'notification.dispatch.requested',
      },
      {
        channel: 'email',
        error: { message: 'No notification channel is registered for "discord".', name: 'NotificationChannelNotFoundError' },
        name: 'notification.dispatch.failed',
      },
      {
        channel: 'discord',
        error: { message: 'No notification channel is registered for "discord".', name: 'NotificationChannelNotFoundError' },
        name: 'notification.dispatch.failed',
      },
    ]);
  });

  it('preserves direct delivery results when lifecycle publication fails', async () => {
    const publisher = new RecordingPublisher();
    publisher.failOnNames.add('notification.dispatch.delivered');
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            return { externalId: 'delivery-safe' };
          },
        },
      ],
      events: {
        publishLifecycleEvents: true,
        publisher,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await expect(service.dispatch({ channel: 'email', payload: { template: 'safe' } })).resolves.toMatchObject({
      deliveryId: 'delivery-safe',
      status: 'delivered',
    });
  });

  it('surfaces failed lifecycle publication errors instead of swallowing them', async () => {
    const publisher = new RecordingPublisher();
    publisher.failOnNames.add('notification.dispatch.failed');
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('channel delivery failed');
          },
        },
      ],
      events: {
        publishLifecycleEvents: true,
        publisher,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    const dispatch = service.dispatch({ channel: 'email', payload: { template: 'broken' } });

    await expect(dispatch).rejects.toBeInstanceOf(AggregateError);
    await expect(dispatch).rejects.toThrow(
      'Notification dispatch failed, and failed lifecycle event publication also failed: channel delivery failed',
    );

    try {
      await dispatch;
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toHaveLength(2);
      expect((error as AggregateError).errors[0]).toMatchObject({ message: 'channel delivery failed' });
      expect((error as AggregateError).errors[1]).toMatchObject({
        message: 'publisher failed:notification.dispatch.failed',
      });
    }
  });

  it('uses deterministic fallback delivery ids when channels omit external ids', async () => {
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            return {};
          },
        },
      ],
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const request = { channel: 'email', payload: { template: 'welcome', userId: 'u1' } };
    const first = await service.dispatch(request);
    const repeated = await service.dispatch(request);
    const different = await service.dispatch({ channel: 'email', payload: { template: 'welcome', userId: 'u2' } });

    expect(first.deliveryId).toMatch(/^fallback:email:/);
    expect(repeated.deliveryId).toBe(first.deliveryId);
    expect(different.deliveryId).not.toBe(first.deliveryId);
  });

  it('keeps deterministic ids distinct for non-plain payload values', async () => {
    const queue = new RecordingQueueAdapter();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not run when queue is explicitly requested');
          },
        },
      ],
      queue: {
        adapter: queue,
        bulkThreshold: 50,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await service.dispatch({ channel: 'email', payload: { scheduledAt: new Date('2026-01-01T00:00:00.000Z') } }, { queue: true });
    await service.dispatch({ channel: 'email', payload: { scheduledAt: new Date('2026-01-02T00:00:00.000Z') } }, { queue: true });
    await service.dispatch({ channel: 'email', payload: { tags: new Set(['one', 'two']) } }, { queue: true });
    await service.dispatch({ channel: 'email', payload: { tags: new Set(['three', 'two']) } }, { queue: true });
    await service.dispatch({ channel: 'email', payload: { attributes: new Map([['tier', 'gold']]) } }, { queue: true });
    await service.dispatch({ channel: 'email', payload: { attributes: new Map([['tier', 'silver']]) } }, { queue: true });
    await service.dispatch({ channel: 'email', payload: { callbackUrl: new URL('https://example.com/orders/one') } }, { queue: true });
    await service.dispatch({ channel: 'email', payload: { callbackUrl: new URL('https://example.com/orders/two') } }, { queue: true });
    await service.dispatch({ channel: 'email', payload: { query: new URLSearchParams('a=1') } }, { queue: true });
    await service.dispatch({ channel: 'email', payload: { query: new URLSearchParams('a=2') } }, { queue: true });
    await service.dispatch({ channel: 'email', payload: { segmentPattern: /vip-.+/i } }, { queue: true });
    await service.dispatch({ channel: 'email', payload: { segmentPattern: /vip-.+/g } }, { queue: true });
    await service.dispatch({ channel: 'email', payload: { segmentPattern: /trial-.+/i } }, { queue: true });

    expect(new Set(queue.jobs.map((job) => job.id)).size).toBe(13);
  });

  it('captures missing-channel failures during tolerant bulk dispatch', async () => {
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            return { externalId: 'ok-1' };
          },
        },
      ],
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const result = await service.dispatchMany(
      [
        { channel: 'email', payload: { template: 'welcome' } },
        { channel: 'discord', payload: { content: 'missing' } },
      ],
      { continueOnError: true },
    );

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures[0]?.error).toBeInstanceOf(NotificationChannelNotFoundError);
  });

  it('collects provider errors during tolerant direct bulk dispatch', async () => {
    const providerError = new Error('provider delivery failed');
    const deliveredPayloads: string[] = [];
    const queue = new RecordingQueueAdapter();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send(notification: NotificationDispatchRequest) {
            const template = String(notification.payload.template);

            if (template === 'broken') {
              throw providerError;
            }

            deliveredPayloads.push(template);
            return { externalId: `delivered:${template}` };
          },
        },
      ],
      queue: {
        adapter: queue,
        bulkThreshold: 2,
      },
    });

    const notifications = [
      { channel: 'email', payload: { template: 'first' } },
      { channel: 'email', payload: { template: 'broken' } },
      { channel: 'email', payload: { template: 'third' } },
    ];

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const result = await service.dispatchMany(notifications, { continueOnError: true, queue: false });

    expect(queue.jobs).toHaveLength(0);
    expect(deliveredPayloads).toEqual(['first', 'third']);
    expect(result).toMatchObject({
      failed: 1,
      queued: 0,
      succeeded: 2,
    });
    expect(result.results.map((entry: NotificationDispatchResult) => entry.deliveryId)).toEqual([
      'delivered:first',
      'delivered:third',
    ]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.notification).toBe(notifications[1]);
    expect(result.failures[0]?.error).toBe(providerError);
  });
});
