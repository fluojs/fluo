import { describe, expect, it } from 'vitest';

import { type Constructor, type Token } from '@konekti/core';
import { getModuleMetadata } from '@konekti/core/internal';
import { Container, type Provider } from '@konekti/di';

import { NotificationChannelNotFoundError } from './errors.js';
import { NotificationsModule } from './module.js';
import { NotificationsService } from './service.js';
import { NOTIFICATION_CHANNELS, NOTIFICATIONS } from './tokens.js';
import type {
  NotificationChannel,
  NotificationDispatchResult,
  NotificationDispatchRequest,
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

  async enqueue(job: NotificationsQueueJob): Promise<string> {
    this.jobs.push(job);
    return `queued:${this.jobs.length}`;
  }

  async enqueueMany(jobs: readonly NotificationsQueueJob[]): Promise<readonly string[]> {
    this.jobs.push(...jobs);
    return jobs.map((_, index) => `queued:${index + 1}`);
  }
}

describe('NotificationsModule', () => {
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
      { channel: 'email', payload: { template: 'digest', userId: 'u2' } },
    ]);

    expect(queue.jobs).toHaveLength(2);
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

  it('validates channels before queueing bulk deliveries', async () => {
    const queue = new RecordingQueueAdapter();
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

  it('preserves underlying delivery errors when lifecycle failure publication also fails', async () => {
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

    await expect(service.dispatch({ channel: 'email', payload: { template: 'broken' } })).rejects.toThrow(
      'channel delivery failed',
    );
  });

  it('uses collision-resistant fallback delivery ids when channels omit external ids', async () => {
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
    const first = await service.dispatch({ channel: 'email', payload: { template: 'first' } });
    const second = await service.dispatch({ channel: 'email', payload: { template: 'second' } });

    expect(first.deliveryId).not.toBe(second.deliveryId);
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
});
