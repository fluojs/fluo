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

  async publish(event: NotificationLifecycleEvent): Promise<void> {
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
    expect(factoryCalls).toEqual(['secret-key']);
    expect(deliveries).toEqual(['hello:secret-key']);
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.delivered',
    ]);
  });

  it('uses the optional queue seam for bulk delivery when the threshold is met', async () => {
    const queue = new RecordingQueueAdapter();
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
