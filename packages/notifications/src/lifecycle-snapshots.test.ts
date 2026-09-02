import { describe, expect, it } from 'vitest';

import { NotificationsService } from './service.js';
import type {
  NotificationChannel,
  NotificationLifecycleEvent,
  NotificationsEventPublisher,
  NotificationsQueueAdapter,
  NotificationsQueueJob,
} from './types.js';

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function createDeferred(): Deferred {
  let resolvePromise: (() => void) | undefined;

  return {
    promise: new Promise<void>((resolve) => {
      resolvePromise = resolve;
    }),
    resolve() {
      resolvePromise?.();
    },
  };
}

class MutatingLifecyclePublisher implements NotificationsEventPublisher {
  readonly events: NotificationLifecycleEvent[] = [];
  readonly mutationResults: boolean[] = [];
  private readonly requested = createDeferred();
  private readonly resumeRequested = createDeferred();

  async publish(event: NotificationLifecycleEvent): Promise<void> {
    this.events.push(event);
    this.mutationResults.push(
      Reflect.set(event, 'channel', 'discord'),
      Reflect.set(event.notification, 'channel', 'discord'),
      Reflect.set(event.notification.payload, 'template', 'corrupted'),
    );

    if (event.name === 'notification.dispatch.requested') {
      this.requested.resolve();
      await this.resumeRequested.promise;
    }
  }

  waitForRequested(): Promise<void> {
    return this.requested.promise;
  }

  continueRequestedPublication(): void {
    this.resumeRequested.resolve();
  }
}

class RecordingQueueAdapter implements NotificationsQueueAdapter {
  readonly jobs: NotificationsQueueJob[] = [];

  async enqueue(job: NotificationsQueueJob): Promise<string> {
    this.jobs.push(job);

    return 'queued:email';
  }
}

describe('NotificationsService lifecycle snapshots', () => {
  it('isolates requested and delivered event snapshots from caller and observer mutations', async () => {
    const publisher = new MutatingLifecyclePublisher();
    const deliveries: NotificationLifecycleEvent['notification'][] = [];
    const channel: NotificationChannel = {
      channel: 'email',
      async send(notification) {
        deliveries.push(notification);

        return { externalId: 'delivered:email' };
      },
    };
    const service = new NotificationsService(
      {
        channels: [channel],
        events: {
          publishLifecycleEvents: true,
          publisher,
        },
      },
      [channel],
    );
    const notification = {
      channel: 'email',
      id: 'original-id',
      payload: { template: 'original' },
    };
    const dispatch = service.dispatch(notification);

    await publisher.waitForRequested();
    notification.channel = 'discord';
    notification.id = 'caller-mutated-id';
    notification.payload.template = 'caller-mutated';
    publisher.continueRequestedPublication();

    await expect(dispatch).resolves.toMatchObject({
      channel: 'email',
      deliveryId: 'delivered:email',
      queued: false,
      status: 'delivered',
    });
    expect(deliveries).toEqual([
      {
        channel: 'email',
        id: 'original-id',
        payload: { template: 'original' },
      },
    ]);
    expect(publisher.mutationResults).toEqual([false, false, false, false, false, false]);
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.delivered',
    ]);
    expect(publisher.events[0]?.notification).not.toBe(deliveries[0]);
    expect(publisher.events[0]?.notification).toEqual({
      channel: 'email',
      id: 'original-id',
      payload: { template: 'original' },
    });
  });

  it('isolates queued event snapshots from caller and observer mutations', async () => {
    const publisher = new MutatingLifecyclePublisher();
    const queue = new RecordingQueueAdapter();
    const channel: NotificationChannel = {
      channel: 'email',
      async send() {
        throw new Error('direct delivery should not run for queued dispatch');
      },
    };
    const service = new NotificationsService(
      {
        channels: [channel],
        events: {
          publishLifecycleEvents: true,
          publisher,
        },
        queue: {
          adapter: queue,
          bulkThreshold: 10,
        },
      },
      [channel],
    );
    const notification = {
      channel: 'email',
      id: 'original-id',
      payload: { template: 'original' },
    };
    const dispatch = service.dispatch(notification, { queue: true });

    await publisher.waitForRequested();
    notification.channel = 'discord';
    notification.id = 'caller-mutated-id';
    notification.payload.template = 'caller-mutated';
    publisher.continueRequestedPublication();

    await expect(dispatch).resolves.toMatchObject({
      channel: 'email',
      deliveryId: 'queued:email',
      queued: true,
      status: 'queued',
    });
    expect(queue.jobs).toMatchObject([
      {
        channel: 'email',
        id: 'original-id',
        notification: {
          channel: 'email',
          id: 'original-id',
          payload: { template: 'original' },
        },
      },
    ]);
    expect(publisher.mutationResults).toEqual([false, false, false, false, false, false]);
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.queued',
    ]);
  });

  it('isolates failed event snapshots from caller and observer mutations', async () => {
    const publisher = new MutatingLifecyclePublisher();
    const channel: NotificationChannel = {
      channel: 'email',
      async send() {
        throw new Error('provider failed');
      },
    };
    const service = new NotificationsService(
      {
        channels: [channel],
        events: {
          publishLifecycleEvents: true,
          publisher,
        },
      },
      [channel],
    );
    const notification = {
      channel: 'email',
      id: 'original-id',
      payload: { template: 'original' },
    };
    const dispatch = service.dispatch(notification);

    await publisher.waitForRequested();
    notification.channel = 'discord';
    notification.id = 'caller-mutated-id';
    notification.payload.template = 'caller-mutated';
    publisher.continueRequestedPublication();

    await expect(dispatch).rejects.toThrow('provider failed');
    expect(publisher.mutationResults).toEqual([false, false, false, false, false, false]);
    expect(publisher.events).toMatchObject([
      {
        channel: 'email',
        name: 'notification.dispatch.requested',
        notification: {
          channel: 'email',
          id: 'original-id',
          payload: { template: 'original' },
        },
      },
      {
        channel: 'email',
        error: { message: 'provider failed', name: 'Error' },
        name: 'notification.dispatch.failed',
        notification: {
          channel: 'email',
          id: 'original-id',
          payload: { template: 'original' },
        },
      },
    ]);
  });
});
