import {
  type NotificationChannel,
  NotificationChannelNotFoundError,
  type NotificationDispatchRequest,
  NotificationsConfigurationError,
  NotificationsModule,
  type NotificationsQueueAdapter,
  type NotificationsQueueJob,
  NotificationsService,
} from '@fluojs/notifications';
import { defineModule, FluoFactory, type ModuleType } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

/**
 * @fluojs/notifications guide evidence: channel registration, dispatch
 * results, the queue seam's threshold rules, tolerant batches, and lifecycle
 * event publication - all with in-memory channels/adapters, no sleeps.
 */

class RecordingChannel implements NotificationChannel {
  readonly sent: NotificationDispatchRequest[] = [];

  constructor(
    readonly channel: string,
    private readonly externalId = 'ext-1',
    private readonly fail = false,
  ) {}

  async send(notification: NotificationDispatchRequest): Promise<{ externalId: string; metadata: Record<string, unknown> }> {
    if (this.fail) {
      throw new Error('channel provider unavailable');
    }
    this.sent.push(notification);
    return { externalId: this.externalId, metadata: { provider: 'recording' } };
  }
}

class RecordingQueueAdapter implements NotificationsQueueAdapter {
  readonly jobs: NotificationsQueueJob[] = [];
  readonly batchJobs: NotificationsQueueJob[][] = [];

  async enqueue(job: NotificationsQueueJob): Promise<string> {
    this.jobs.push(job);
    return `q-${String(this.jobs.length)}`;
  }

  async enqueueMany(jobs: readonly NotificationsQueueJob[]): Promise<readonly string[]> {
    this.batchJobs.push([...jobs]);
    return jobs.map((_job, index) => `q-batch-${String(this.batchJobs.length)}-${String(index)}`);
  }
}

class RecordingPublisher {
  readonly events: string[] = [];

  async publish(event: { name: string }): Promise<void> {
    this.events.push(event.name);
  }
}

function buildAppModule(
  channels: NotificationChannel[],
  options?: {
    adapter?: NotificationsQueueAdapter;
    bulkThreshold?: number;
    publisher?: RecordingPublisher;
  },
): ModuleType {
  class NotificationsAppModule {}

  return defineModule(NotificationsAppModule, {
    imports: [
      NotificationsModule.forRoot({
        channels,
        ...(options?.adapter
          ? {
              queue: {
                adapter: options.adapter,
                ...(options.bulkThreshold !== undefined ? { bulkThreshold: options.bulkThreshold } : {}),
              },
            }
          : {}),
        ...(options?.publisher ? { events: { publisher: options.publisher } } : {}),
      }),
    ],
  });
}

describe('@fluojs/notifications guide examples', () => {
  it('dispatches one notification through the registered channel and normalizes the result', async () => {
    const email = new RecordingChannel('email', 'msg-1');
    const context = await FluoFactory.createApplicationContext(buildAppModule([email]));
    try {
      const notifications = await context.get(NotificationsService);

      const result = await notifications.dispatch({
        channel: 'email',
        recipients: ['dev@example.com'],
        subject: 'Welcome to fluo',
        payload: { template: 'welcome', userId: 'u_1' },
      });

      expect(result).toEqual({
        channel: 'email',
        deliveryId: 'msg-1',
        metadata: { provider: 'recording' },
        status: 'delivered',
      });
      expect(email.sent).toHaveLength(1);
      expect(email.sent[0]?.subject).toBe('Welcome to fluo');
    } finally {
      await context.close();
    }
  });

  it('fails a dispatch to an unregistered channel with NotificationChannelNotFoundError', async () => {
    const context = await FluoFactory.createApplicationContext(buildAppModule([new RecordingChannel('email')]));
    try {
      const notifications = await context.get(NotificationsService);

      await expect(notifications.dispatch({ channel: 'sms', payload: { text: 'hi' } })).rejects.toBeInstanceOf(
        NotificationChannelNotFoundError,
      );
    } finally {
      await context.close();
    }
  });

  it('rejects duplicate channel names and invalid bulk thresholds at registration time', () => {
    expect(() =>
      buildAppModule([new RecordingChannel('email'), new RecordingChannel('email')]),
    ).toThrow(NotificationsConfigurationError);

    const adapter = new RecordingQueueAdapter();
    expect(() =>
      buildAppModule([new RecordingChannel('email')], { adapter, bulkThreshold: 0 }),
    ).toThrow(NotificationsConfigurationError);
  });

  it('keeps single dispatch direct by default and opts in with queue: true', async () => {
    const adapter = new RecordingQueueAdapter();
    const channel = new RecordingChannel('email');
    const context = await FluoFactory.createApplicationContext(
      buildAppModule([channel], { adapter, bulkThreshold: 10 }),
    );
    try {
      const notifications = await context.get(NotificationsService);

      const direct = await notifications.dispatch({ channel: 'email', id: 'n-1', payload: { text: 'hi' } });
      expect(direct.status).toBe('delivered');
      expect(adapter.jobs).toHaveLength(0);

      const queued = await notifications.dispatch(
        { channel: 'email', id: 'n-2', payload: { text: 'hi' } },
        { queue: true },
      );
      expect(queued.status).toBe('queued');
      expect(adapter.jobs).toHaveLength(1);
      // The caller-provided id is the authoritative idempotency key.
      expect(adapter.jobs[0]?.id).toBe('n-2');
      expect(adapter.jobs[0]?.notification.id).toBe('n-2');
    } finally {
      await context.close();
    }
  });

  it('queues dispatchMany at or above the bulk threshold and stays direct below it', async () => {
    const adapter = new RecordingQueueAdapter();
    const channel = new RecordingChannel('email');
    const context = await FluoFactory.createApplicationContext(
      buildAppModule([channel], { adapter, bulkThreshold: 3 }),
    );
    try {
      const notifications = await context.get(NotificationsService);

      const small = await notifications.dispatchMany([
        { channel: 'email', payload: { text: 'a' } },
        { channel: 'email', payload: { text: 'b' } },
      ]);
      expect(small.queued).toBe(0);
      expect(small.succeeded).toBe(2);

      const bulk = await notifications.dispatchMany([
        { channel: 'email', payload: { text: '1' } },
        { channel: 'email', payload: { text: '2' } },
        { channel: 'email', payload: { text: '3' } },
      ]);
      expect(bulk.queued).toBe(3);
      expect(bulk.results.every((result) => result.status === 'queued')).toBe(true);
      expect(adapter.batchJobs).toHaveLength(1);
      expect(adapter.batchJobs[0]).toHaveLength(3);
      expect(channel.sent).toHaveLength(2);
    } finally {
      await context.close();
    }
  });

  it('collects per-item failures with continueOnError instead of failing the batch', async () => {
    const healthy = new RecordingChannel('email');
    const broken = new RecordingChannel('sms', 'ext-sms', true);
    const context = await FluoFactory.createApplicationContext(buildAppModule([healthy, broken]));
    try {
      const notifications = await context.get(NotificationsService);

      const batch = await notifications.dispatchMany(
        [
          { channel: 'email', payload: { text: 'ok' } },
          { channel: 'sms', payload: { text: 'boom' } },
          { channel: 'email', payload: { text: 'also ok' } },
        ],
        { continueOnError: true },
      );

      expect(batch.succeeded).toBe(2);
      expect(batch.failed).toBe(1);
      expect(batch.failures).toHaveLength(1);
      expect(batch.failures[0]?.error.message).toBe('channel provider unavailable');
      expect(batch.failures[0]?.notification.channel).toBe('sms');
    } finally {
      await context.close();
    }
  });

  it('publishes requested then delivered lifecycle events, and failed when the channel breaks', async () => {
    const publisher = new RecordingPublisher();
    const context = await FluoFactory.createApplicationContext(
      buildAppModule([new RecordingChannel('email')], { publisher }),
    );
    try {
      const notifications = await context.get(NotificationsService);

      await notifications.dispatch({ channel: 'email', payload: { text: 'hi' } });
      await expect(notifications.dispatch({ channel: 'sms', payload: { text: 'hi' } })).rejects.toBeInstanceOf(
        NotificationChannelNotFoundError,
      );

      expect(publisher.events).toEqual([
        'notification.dispatch.requested',
        'notification.dispatch.delivered',
        'notification.dispatch.requested',
        'notification.dispatch.failed',
      ]);
    } finally {
      await context.close();
    }
  });

  it('suppresses lifecycle publication per call with publishLifecycleEvents: false', async () => {
    const publisher = new RecordingPublisher();
    const context = await FluoFactory.createApplicationContext(
      buildAppModule([new RecordingChannel('email')], { publisher }),
    );
    try {
      const notifications = await context.get(NotificationsService);

      await notifications.dispatch(
        { channel: 'email', payload: { text: 'hi' } },
        { publishLifecycleEvents: false },
      );

      expect(publisher.events).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
