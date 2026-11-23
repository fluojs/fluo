import { type Constructor, Inject, Module, type Token } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import { Container, type Provider } from '@fluojs/di';
import { FluoFactory } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { withCleanup } from '../../../tooling/testing/with-cleanup.js';
import {
  NotificationChannelNotFoundError,
  NotificationQueueNotConfiguredError,
  NotificationQueueResultIntegrityError,
  NotificationsConfigurationError,
} from './errors.js';
import { NotificationsModule } from './module.js';
import { NotificationsService } from './service.js';
import type {
  NotificationChannel,
  NotificationDispatchManyOptions,
  NotificationDispatchOptions,
  NotificationDispatchRequest,
  NotificationDispatchResult,
  NotificationLifecycleEvent,
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

function expectGeneratedQueueJobId(value: string | undefined): void {
  expect(value).toMatch(/^notification:email:[a-z0-9]{13}$/);
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

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise = (): void => {
    throw new Error('Deferred promise was not initialized.');
  };
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

function rejectWhenAborted(
  signal: AbortSignal | undefined,
  started: () => void,
  onListenerRemoved: () => void,
): Promise<never> {
  if (!signal) {
    started();
    return Promise.reject(new Error('Expected the caller abort signal.'));
  }

  return new Promise((_, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      onListenerRemoved();
      reject(signal.reason);
    };

    signal.addEventListener('abort', onAbort);
    started();
  });
}

describe('NotificationsModule', () => {
  it.each([true, false])('dispatch preserves admitted options when queue=%s and the caller reuses them', async (queue) => {
    const requested = createDeferred();
    const release = createDeferred();
    const events: NotificationLifecycleEvent[] = [];
    const signals: Array<AbortSignal | undefined> = [];
    const original = new AbortController();
    const replacement = new AbortController();
    const options: NotificationDispatchOptions = {
      publishLifecycleEvents: true,
      queue,
      signal: original.signal,
    };
    const service = new NotificationsService({
      channels: [],
      events: {
        publishLifecycleEvents: true,
        publisher: {
          async publish(event) {
            events.push(event);
            if (event.notification.id === 'first' && event.name === 'notification.dispatch.requested') {
              requested.resolve();
              await release.promise;
            }
          },
        },
      },
      queue: {
        bulkThreshold: 10,
        adapter: {
          async enqueue(_job, context) {
            signals.push(context?.signal);
            return 'queue-delivery';
          },
        },
      },
    }, [{
      channel: 'email',
      async send(_notification, context) {
        signals.push(context?.signal);
        return { externalId: 'direct-delivery' };
      },
    }]);

    const first = service.dispatch({ id: 'first', channel: 'email', payload: {} }, options);
    await requested.promise;
    options.queue = !queue;
    options.publishLifecycleEvents = false;
    options.signal = replacement.signal;
    const second = await service.dispatch({ id: 'second', channel: 'email', payload: {} }, options);
    release.resolve();

    await expect(first).resolves.toMatchObject({ status: queue ? 'queued' : 'delivered' });
    expect(second.status).toBe(queue ? 'delivered' : 'queued');
    expect(signals).toEqual([replacement.signal, original.signal]);
    expect(events.map((event) => [event.notification.id, event.name])).toEqual([
      ['first', 'notification.dispatch.requested'],
      ['first', queue ? 'notification.dispatch.queued' : 'notification.dispatch.delivered'],
    ]);
  });

  it.each(['direct', 'native', 'sequential'] as const)(
    'dispatchMany preserves admitted options during %s delivery when the caller reuses them',
    async (mode) => {
      const requested = createDeferred();
      const release = createDeferred();
      const events: NotificationLifecycleEvent[] = [];
      const signals: Array<AbortSignal | undefined> = [];
      const original = new AbortController();
      const replacement = new AbortController();
      const deliveryError = new Error('delivery failed');
      const options: NotificationDispatchManyOptions = {
        continueOnError: true,
        publishLifecycleEvents: true,
        queue: mode !== 'direct',
        signal: original.signal,
      };
      const service = new NotificationsService({
        channels: [],
        events: {
          publishLifecycleEvents: true,
          publisher: {
            async publish(event) {
              events.push(event);
              if (event.notification.id === 'first' && event.name === 'notification.dispatch.requested') {
                requested.resolve();
                await release.promise;
              }
            },
          },
        },
        queue: {
          bulkThreshold: 10,
          adapter: {
            async enqueue(job, context) {
              signals.push(context?.signal);
              if (job.notification.id === 'first') {
                throw deliveryError;
              }
              return 'queued-delivery';
            },
            ...(mode === 'native' ? {
              async enqueueMany(jobs: readonly NotificationsQueueJob[], context?: { signal?: AbortSignal }) {
                signals.push(context?.signal);
                return jobs.map((job) => `queued:${job.id}`);
              },
            } : {}),
          },
        },
      }, [{
        channel: 'email',
        async send(notification, context) {
          signals.push(context?.signal);
          if (notification.id === 'first') {
            throw deliveryError;
          }
          return { externalId: 'direct-delivery' };
        },
      }]);
      const batch = [
        { id: 'first', channel: 'email', payload: {} },
        { id: 'last', channel: 'email', payload: {} },
      ];

      const first = service.dispatchMany(batch, options);
      await requested.promise;
      options.queue = mode === 'direct';
      options.continueOnError = false;
      options.publishLifecycleEvents = false;
      options.signal = replacement.signal;
      const second = await service.dispatchMany([{ id: 'second', channel: 'email', payload: {} }], options);
      release.resolve();
      const result = await first;

      expect(second).toMatchObject({ failed: 0, queued: mode === 'direct' ? 1 : 0, succeeded: 1 });
      expect(result).toMatchObject({
        failed: mode === 'native' ? 0 : 1,
        queued: mode === 'native' ? 2 : mode === 'sequential' ? 1 : 0,
        succeeded: mode === 'native' ? 2 : 1,
      });
      if (mode !== 'native') {
        expect(result.failures[0]?.error).toBe(deliveryError);
      }
      expect(signals).toEqual(mode === 'native'
        ? [replacement.signal, original.signal]
        : [replacement.signal, original.signal, original.signal]);
      expect(events.map((event) => [event.notification.id, event.name])).toEqual(mode === 'direct' ? [
        ['first', 'notification.dispatch.requested'],
        ['first', 'notification.dispatch.failed'],
        ['last', 'notification.dispatch.requested'],
        ['last', 'notification.dispatch.delivered'],
      ] : [
        ['first', 'notification.dispatch.requested'],
        ['last', 'notification.dispatch.requested'],
        ['first', mode === 'native' ? 'notification.dispatch.queued' : 'notification.dispatch.failed'],
        ['last', 'notification.dispatch.queued'],
      ]);
    },
  );

  it.each(['single', 'native', 'sequential'] as const)(
    '%s dispatch observes the original signal aborted during requested publication before queue handoff',
    async (mode) => {
      const requested = createDeferred();
      const release = createDeferred();
      const publisher = new RecordingPublisher();
      const original = new AbortController();
      const abortError = new Error('aborted before queue handoff');
      const queue = new RecordingQueueAdapter();
      const service = new NotificationsService({
        channels: [],
        events: {
          publishLifecycleEvents: true,
          publisher: {
            async publish(event) {
              await publisher.publish(event);
              if (event.name === 'notification.dispatch.requested') {
                requested.resolve();
                await release.promise;
              }
            },
          },
        },
        queue: {
          bulkThreshold: 1,
          adapter: mode === 'sequential' ? { enqueue: queue.enqueue.bind(queue) } : queue,
        },
      }, [{ channel: 'email', async send() { return {}; } }]);
      const options: NotificationDispatchOptions = { queue: true, signal: original.signal };
      const notification = { channel: 'email', payload: {} };

      const dispatch = mode === 'single'
        ? service.dispatch(notification, options)
        : service.dispatchMany([notification], options);
      await requested.promise;
      options.signal = new AbortController().signal;
      original.abort(abortError);
      release.resolve();

      await expect(dispatch).rejects.toBe(abortError);
      expect(queue.jobs).toEqual([]);
      expect(publisher.events.map((event) => event.name)).toEqual([
        'notification.dispatch.requested',
        'notification.dispatch.failed',
      ]);
    },
  );

  it.each([
    { batch: false, modulePublication: true },
    { batch: false, modulePublication: false },
    { batch: true, modulePublication: true },
    { batch: true, modulePublication: false },
  ])('dispatch lifecycle override restores module defaults: %j', async ({ batch, modulePublication }) => {
    const publisher = new RecordingPublisher();
    const service = new NotificationsService({
      channels: [],
      events: { publishLifecycleEvents: modulePublication, publisher },
    }, [{ channel: 'email', async send() { return {}; } }]);
    const notification = { channel: 'email', payload: {} };
    const dispatch = (options?: NotificationDispatchOptions) => batch
      ? service.dispatchMany([notification], options)
      : service.dispatch(notification, options);

    await dispatch({ publishLifecycleEvents: !modulePublication });
    expect(publisher.events.map((event) => event.name)).toEqual(modulePublication ? [] : [
      'notification.dispatch.requested',
      'notification.dispatch.delivered',
    ]);
    publisher.events.length = 0;
    await dispatch();

    expect(publisher.events.map((event) => event.name)).toEqual(modulePublication ? [
      'notification.dispatch.requested',
      'notification.dispatch.delivered',
    ] : []);
  });

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

    const testingModule = await Test.createTestingModule({ rootModule: AppModule }).compile();

    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());
      const probe = await testingModule.resolve<RootNotificationsProbe>(RootNotificationsProbe);

      await expect(probe.send()).resolves.toMatchObject({
        deliveryId: 'global-delivery',
        status: 'delivered',
      });
      expect(deliveries).toEqual(['global-visible']);
    });
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

    const testingModule = await Test.createTestingModule({ rootModule: AppModule }).compile();

    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());
      const probe = await testingModule.resolve<LocalNotificationsProbe>(LocalNotificationsProbe);

      await expect(probe.send()).resolves.toMatchObject({
        deliveryId: 'local-delivery',
        status: 'delivered',
      });
      expect(deliveries).toEqual(['local-visible']);
    });
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

    await expect(Test.createTestingModule({ rootModule: AppModule }).compile()).rejects.toThrow(
      /not visible through a global module|NotificationsService/,
    );
  });

  it('makes the async default-global service visible through a real testing module graph', async () => {
    const deliveries: string[] = [];

    @Inject(NotificationsService)
    class RootNotificationsServiceProbe {
      constructor(private readonly notifications: NotificationsService) {}

      send(): Promise<NotificationDispatchResult> {
        return this.notifications.dispatch({
          channel: 'email',
          payload: { template: 'async-global-visible' },
        });
      }
    }

    @Module({
      imports: [
        NotificationsModule.forRootAsync({
          useFactory: async () => ({
            channels: [
              {
                channel: 'email',
                async send(notification: NotificationDispatchRequest) {
                  deliveries.push(String(notification.payload.template));

                  return { externalId: 'async-global-delivery' };
                },
              },
            ],
          }),
        }),
      ],
    })
    class NotificationsOwnerModule {}

    @Module({
      imports: [NotificationsOwnerModule],
      providers: [RootNotificationsServiceProbe],
    })
    class AppModule {}

    const testingModule = await Test.createTestingModule({ rootModule: AppModule }).compile();

    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());
      const probe = await testingModule.resolve<RootNotificationsServiceProbe>(RootNotificationsServiceProbe);
      const dispatch = await probe.send();

      expect(dispatch).toMatchObject({
        deliveryId: 'async-global-delivery',
        status: 'delivered',
      });
      expect(deliveries).toEqual(['async-global-visible']);
    });
  });

  it('keeps async module-local providers hidden from sibling/root providers in a real testing module graph', async () => {
    @Inject(NotificationsService)
    class RootNotificationsServiceProbe {
      constructor(readonly notifications: NotificationsService) {}
    }

    @Module({
      imports: [
        NotificationsModule.forRootAsync({
          global: false,
          useFactory: async () => ({
            channels: [
              {
                channel: 'email',
                async send() {
                  return { externalId: 'async-local-only' };
                },
              },
            ],
          }),
        }),
      ],
    })
    class NotificationsOwnerModule {}

    @Module({
      imports: [NotificationsOwnerModule],
      providers: [RootNotificationsServiceProbe],
    })
    class AppModule {}

    await expect(Test.createTestingModule({ rootModule: AppModule }).compile()).rejects.toThrow(
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
      status: 'delivered',
    });
    expect(deliveries).toEqual([
      {
        payload: { template: 'welcome', userId: 'user-1' },
        recipients: ['user@example.com'],
      },
    ]);
  });

  it('rejects duplicate static channel registrations before creating a provider graph', () => {
    const duplicateEmailChannels: readonly NotificationChannel[] = [
      {
        channel: 'email',
        async send() {
          return { externalId: 'first-email-provider' };
        },
      },
      {
        channel: 'email',
        async send() {
          return { externalId: 'second-email-provider' };
        },
      },
    ];

    expect(() => NotificationsModule.forRoot({ channels: duplicateEmailChannels })).toThrowError(
      new NotificationsConfigurationError('Duplicate notification channel registration detected for "email".'),
    );
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

    expect(result).toMatchObject({ deliveryId: 'direct-1', status: 'delivered' });
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

    expect(result).toMatchObject({ deliveryId: 'queued:1', status: 'queued' });
    expect(queue.jobs).toHaveLength(1);
    expectGeneratedQueueJobId(queue.jobs[0]?.id);
    expect(queue.jobs[0]).toMatchObject({
      channel: 'email',
      notification: { channel: 'email', payload: { template: 'single' } },
    });
  });

  it('forwards a live caller abort signal to direct channels', async () => {
    const abortController = new AbortController();
    const abortError = new Error('direct dispatch aborted');
    const channelStarted = createDeferred();
    let listenerRemoved = false;
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send(_notification, context) {
            return rejectWhenAborted(context.signal, channelStarted.resolve, () => {
              listenerRemoved = true;
            });
          },
        },
      ],
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const dispatch = service.dispatch(
      { channel: 'email', payload: { template: 'direct-abort' } },
      { signal: abortController.signal },
    );

    await channelStarted.promise;
    abortController.abort(abortError);

    await expect(dispatch).rejects.toBe(abortError);
    expect(listenerRemoved).toBe(true);
  });

  it('rejects a pre-aborted queued single dispatch before queue handoff', async () => {
    const abortController = new AbortController();
    const abortError = new Error('queued single dispatch aborted');
    const publisher = new RecordingPublisher();
    let enqueueCalls = 0;
    const queue: NotificationsQueueAdapter = {
      async enqueue() {
        enqueueCalls += 1;
        return 'queued:unexpected';
      },
    };
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [{ channel: 'email', async send() { return { externalId: 'direct-should-not-run' }; } }],
      events: { publisher },
      queue: { adapter: queue },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    abortController.abort(abortError);

    await expect(
      service.dispatch(
        { channel: 'email', payload: { template: 'queued-single-pre-abort' } },
        { queue: true, signal: abortController.signal },
      ),
    ).rejects.toBe(abortError);

    expect(enqueueCalls).toBe(0);
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.failed',
    ]);
    expect(publisher.events).not.toContainEqual(expect.objectContaining({ name: 'notification.dispatch.queued' }));
  });

  it('forwards a live caller abort signal to queued single dispatch and cleans up adapter listeners', async () => {
    const abortController = new AbortController();
    const abortError = new Error('queued single dispatch aborted');
    const enqueueStarted = createDeferred();
    const publisher = new RecordingPublisher();
    let listenerRemoved = false;
    let receivedSignal: AbortSignal | undefined;
    const queue: NotificationsQueueAdapter = {
      async enqueue(_job, context?: { readonly signal?: AbortSignal }) {
        receivedSignal = context?.signal;
        return rejectWhenAborted(context?.signal, enqueueStarted.resolve, () => {
          listenerRemoved = true;
        });
      },
    };
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [{ channel: 'email', async send() { return { externalId: 'direct-should-not-run' }; } }],
      events: { publisher },
      queue: { adapter: queue },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const dispatch = service.dispatch(
      { channel: 'email', payload: { template: 'queued-single-mid-flight' } },
      { queue: true, signal: abortController.signal },
    );

    await enqueueStarted.promise;
    abortController.abort(abortError);

    await expect(dispatch).rejects.toBe(abortError);
    expect(receivedSignal).toBe(abortController.signal);
    expect(listenerRemoved).toBe(true);
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.failed',
    ]);
  });

  it('throws when single dispatch explicitly requests queue delivery without a queue adapter', async () => {
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
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await expect(
      service.dispatch({ channel: 'email', payload: { template: 'single-missing-queue' } }, { queue: true }),
    ).rejects.toBeInstanceOf(NotificationQueueNotConfiguredError);
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

    expect(result).toMatchObject({ deliveryId: 'direct-disabled-queue', status: 'delivered' });
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

    expectGeneratedQueueJobId(firstJob?.id);
    expect(repeatedJob?.id).toBe(firstJob?.id);
    expect(callerJob?.id).toBe('caller-job-id');
  });

  it('derives queue job ids from canonical notification content without pinning opaque hash literals', async () => {
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

    await service.dispatch(
      {
        channel: 'email',
        payload: { template: 'digest', userId: 'u1' },
        recipients: ['user@example.com'],
      },
      { queue: true },
    );
    await service.dispatch(
      {
        recipients: ['user@example.com'],
        payload: { userId: 'u1', template: 'digest' },
        channel: 'email',
      },
      { queue: true },
    );

    const [canonicalJob, reorderedJob] = queue.jobs;

    expectGeneratedQueueJobId(canonicalJob?.id);
    expect(reorderedJob?.id).toBe(canonicalJob?.id);
  });

  it('does not close or drain application-owned queue and event publisher resources during runtime app close', async () => {
    const resourceLifecycleCalls: string[] = [];
    const runtimeShutdownCalls: string[] = [];
    const queue = new LifecycleAwareQueueAdapter(resourceLifecycleCalls);
    const publisher = new LifecycleAwarePublisher(resourceLifecycleCalls);

    class RuntimeShutdownProbe {
      onModuleDestroy(): void {
        runtimeShutdownCalls.push('app.onModuleDestroy');
      }

      onApplicationShutdown(signal?: string): void {
        runtimeShutdownCalls.push(`app.onApplicationShutdown:${signal ?? 'none'}`);
      }
    }

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
      providers: [RuntimeShutdownProbe],
    })
    class AppModule {}

    const app = await FluoFactory.createApplicationContext(AppModule);

    try {
      const service = await app.get<NotificationsService>(NotificationsService);

      await expect(
        service.dispatch({ channel: 'email', payload: { template: 'queued-owned-by-app' } }, { queue: true }),
      ).resolves.toMatchObject({
        deliveryId: 'queued:1',
        status: 'queued',
      });
      expect(queue.jobs).toHaveLength(1);
      expect(publisher.events.map((event) => event.name)).toEqual([
        'notification.dispatch.requested',
        'notification.dispatch.queued',
      ]);
    } finally {
      await app.close('notifications-shutdown-test');
    }

    expect(runtimeShutdownCalls).toEqual([
      'app.onModuleDestroy',
      'app.onApplicationShutdown:notifications-shutdown-test',
    ]);
    expect(resourceLifecycleCalls).toEqual([]);
  });

  it('does not close or drain application-owned queue and event publisher resources during testing module disposal', async () => {
    const resourceLifecycleCalls: string[] = [];
    const queue = new LifecycleAwareQueueAdapter(resourceLifecycleCalls);
    const publisher = new LifecycleAwarePublisher(resourceLifecycleCalls);

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

    const testingModule = await Test.createTestingModule({ rootModule: AppModule }).compile();
    await withCleanup(async (defer) => {
      defer(() => testingModule.container.dispose());
      const service = await testingModule.resolve<NotificationsService>(NotificationsService);

      await expect(
        service.dispatch({ channel: 'email', payload: { template: 'queued-owned-by-app' } }, { queue: true }),
      ).resolves.toMatchObject({
        deliveryId: 'queued:1',
        status: 'queued',
      });
      expect(queue.jobs).toHaveLength(1);
      expect(publisher.events.map((event) => event.name)).toEqual([
        'notification.dispatch.requested',
        'notification.dispatch.queued',
      ]);
    });

    expect(resourceLifecycleCalls).toEqual([]);
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

  describe.each(['direct', 'single queue', 'native bulk', 'sequential queue'] as const)(
    'requested publication outcome: %s',
    (path) => {
      const requestedOutcomes = ['fulfilled', 'Error rejection', 'undefined rejection'] as const;

      it.each(requestedOutcomes.flatMap((outcome) => [false, true].map((rejectFailed) => ({ outcome, rejectFailed }))))(
        'preserves $outcome when delivery fails and failed publication rejection=$rejectFailed',
        async ({ outcome, rejectFailed }) => {
          const dispatchError = new Error('delivery failed');
          const requestedError = new Error('requested publication failed');
          const events: NotificationLifecycleEvent[] = [];
          const rejectDelivery = async (): Promise<never> => {
            throw dispatchError;
          };
          const container = new Container();
          const moduleType = NotificationsModule.forRoot({
            channels: [{ channel: 'email', send: rejectDelivery }],
            queue: {
              adapter: {
                enqueue: rejectDelivery,
                ...(path === 'native bulk' ? { enqueueMany: rejectDelivery } : {}),
              },
            },
            events: {
              publisher: {
                async publish(event) {
                  events.push(event);
                  if (event.name === 'notification.dispatch.requested' && outcome !== 'fulfilled') {
                    return Promise.reject(outcome === 'Error rejection' ? requestedError : undefined);
                  }
                  if (event.name === 'notification.dispatch.failed' && rejectFailed) {
                    return Promise.reject();
                  }
                },
              },
            },
          });
          container.register(...moduleProviders(moduleType));
          const service = await container.resolve(NotificationsService);
          const notification = { channel: 'email', payload: {} };

          const error = await (path === 'direct' || path === 'single queue'
            ? service.dispatch(notification, { queue: path === 'single queue' })
            : service.dispatchMany([notification], { queue: true })).catch((reason: unknown) => reason);

          if (outcome === 'fulfilled' && !rejectFailed) {
            expect(error).toBe(dispatchError);
          } else {
            expect(error).toBeInstanceOf(AggregateError);
            if (!(error instanceof AggregateError)) {
              throw new Error('Expected requested publication rejection to be preserved.');
            }
            expect(error.message).toBe(
              'Notification dispatch failed, and failed lifecycle event publication also failed: delivery failed',
            );
            const expected = [
              dispatchError,
              ...(outcome === 'fulfilled' ? [] : [outcome === 'Error rejection' ? requestedError : undefined]),
              ...(rejectFailed ? [undefined] : []),
            ];
            expect(error.errors).toHaveLength(expected.length);
            expected.forEach((reason, index) => {
              expect(error.errors[index]).toBe(reason);
            });
          }
          expect(events.map((event) => event.name)).toEqual([
            'notification.dispatch.requested',
            'notification.dispatch.failed',
          ]);
        },
      );

      it.each(requestedOutcomes)('keeps successful delivery after %s', async (outcome) => {
        const events: NotificationLifecycleEvent[] = [];
        const acceptedJobs: NotificationsQueueJob[] = [];
        const container = new Container();
        const moduleType = NotificationsModule.forRoot({
          channels: [{
            channel: 'email',
            async send() {
              return { externalId: 'delivered:1' };
            },
          }],
          queue: {
            adapter: {
              async enqueue(job) {
                acceptedJobs.push(job);
                return 'queued:1';
              },
              ...(path === 'native bulk' ? {
                async enqueueMany(jobs: readonly NotificationsQueueJob[]) {
                  acceptedJobs.push(...jobs);
                  return ['queued:1'];
                },
              } : {}),
            },
          },
          events: {
            publisher: {
              async publish(event) {
                events.push(event);
                if (event.name === 'notification.dispatch.requested' && outcome !== 'fulfilled') {
                  return Promise.reject(outcome === 'Error rejection' ? new Error('requested failed') : undefined);
                }
                if (event.name !== 'notification.dispatch.requested') {
                  return Promise.reject(new Error('terminal success publication failed'));
                }
              },
            },
          },
        });
        container.register(...moduleProviders(moduleType));
        const service = await container.resolve(NotificationsService);
        const notification = { channel: 'email', id: 'accepted-job', payload: {} };

        const result = path === 'direct' || path === 'single queue'
          ? await service.dispatch(notification, { queue: path === 'single queue' })
          : await service.dispatchMany([notification], { queue: true });

        const expected = {
          channel: 'email',
          deliveryId: path === 'direct' ? 'delivered:1' : 'queued:1',
          status: path === 'direct' ? 'delivered' : 'queued',
        };
        expect(result).toMatchObject(path === 'direct' || path === 'single queue'
          ? expected
          : { failed: 0, failures: [], queued: 1, succeeded: 1, results: [expected] });
        expect(acceptedJobs.map((job) => job.id)).toEqual(path === 'direct' ? [] : ['accepted-job']);
        expect(events.map((event) => event.name)).toEqual([
          'notification.dispatch.requested',
          path === 'direct' ? 'notification.dispatch.delivered' : 'notification.dispatch.queued',
        ]);
      });
    },
  );

  describe.each(['direct', 'native bulk', 'sequential queue'] as const)(
    'mixed requested rejections: %s',
    (path) => {
      it.each([false, true])('preserves failure order with failed publication rejection=%s', async (rejectFailed) => {
        const dispatchError = new Error('mixed delivery failed');
        const requestedError = new Error('requested Error rejection');
        const failedError = new Error('terminal Error rejection');
        const events: NotificationLifecycleEvent[] = [];
        const accepted: string[] = [];
        const notifications = ['accepted', 'fulfilled', 'error', 'undefined'].map((id) => ({
          channel: 'email',
          id,
          payload: {},
        }));
        const deliver = async (notification: NotificationDispatchRequest): Promise<string> => {
          if (notification.id !== 'accepted') {
            throw dispatchError;
          }
          accepted.push(notification.id);
          return 'accepted:1';
        };
        const container = new Container();
        const moduleType = NotificationsModule.forRoot({
          channels: [{
            channel: 'email',
            async send(notification) {
              return { externalId: await deliver(notification) };
            },
          }],
          queue: {
            adapter: {
              async enqueue(job) {
                return deliver(job.notification);
              },
              ...(path === 'native bulk' ? {
                async enqueueMany() {
                  throw dispatchError;
                },
              } : {}),
            },
          },
          events: {
            publisher: {
              async publish(event) {
                events.push(event);
                const id = event.notification.id;
                if (event.name === 'notification.dispatch.requested') {
                  if (id === 'error' || id === 'accepted') {
                    return Promise.reject(requestedError);
                  }
                  if (id === 'undefined') {
                    return Promise.reject();
                  }
                }
                if (rejectFailed && event.name === 'notification.dispatch.failed') {
                  return Promise.reject(id === 'undefined' ? undefined : failedError);
                }
              },
            },
          },
        });
        container.register(...moduleProviders(moduleType));
        const service = await container.resolve(NotificationsService);

        const result = await service.dispatchMany(
          path === 'native bulk' ? notifications.slice(1) : notifications,
          { queue: path !== 'direct', continueOnError: true },
        ).catch((reason: unknown) => reason instanceof Error ? reason : new Error('Unexpected non-Error dispatch rejection.'));

        if (path === 'native bulk') {
          expect(result).toBeInstanceOf(AggregateError);
          if (!(result instanceof AggregateError)) {
            throw new Error('Expected bulk requested publication rejections.');
          }
          const expected = [dispatchError, requestedError, undefined, ...(rejectFailed ? [failedError, failedError, undefined] : [])];
          expect(result.errors).toHaveLength(expected.length);
          expected.forEach((reason, index) => {
            expect(result.errors[index]).toBe(reason);
          });
          expect(accepted).toEqual([]);
        } else {
          if (result instanceof Error) {
            throw new Error('Expected partial dispatch results.');
          }
          expect(result).toMatchObject({
            succeeded: 1,
            failed: 3,
            queued: path === 'direct' ? 0 : 1,
            results: [{ deliveryId: 'accepted:1', status: path === 'direct' ? 'delivered' : 'queued' }],
          });
          expect(accepted).toEqual(['accepted']);
          expect(result.failures.map((failure) => failure.notification.id)).toEqual(['fulfilled', 'error', 'undefined']);
          result.failures.forEach((failure, index) => {
            const expected = [
              dispatchError,
              ...(index === 1 ? [requestedError] : index === 2 ? [undefined] : []),
              ...(rejectFailed ? [index === 2 ? undefined : failedError] : []),
            ];
            if (expected.length === 1) {
              expect(failure.error).toBe(dispatchError);
            } else {
              expect(failure.error).toBeInstanceOf(AggregateError);
              if (!(failure.error instanceof AggregateError)) {
                throw new Error('Expected item-specific publication failures.');
              }
              const aggregate = failure.error;
              expect(aggregate.errors).toHaveLength(expected.length);
              expected.forEach((reason, errorIndex) => {
                expect(aggregate.errors[errorIndex]).toBe(reason);
              });
            }
          });
        }
        expect(events.filter((event) => event.name === 'notification.dispatch.failed')
          .map((event) => event.notification.id)).toEqual(['fulfilled', 'error', 'undefined']);
        expect(events.filter((event) => event.name === 'notification.dispatch.queued'
          || event.name === 'notification.dispatch.delivered').map((event) => event.notification.id))
          .toEqual(path === 'native bulk' ? [] : ['accepted']);
      });
    },
  );

  it.each([false, true])(
    'preserves only pending requested failures after fail-fast queue fallback with failed rejection=%s',
    async (rejectFailed) => {
      const dispatchError = new Error('fallback enqueue failed');
      const acceptedRequestedError = new Error('already accepted requested failure');
      const pendingRequestedError = new Error('pending requested failure');
      const events: NotificationLifecycleEvent[] = [];
      const enqueued: string[] = [];
      const container = new Container();
      const moduleType = NotificationsModule.forRoot({
        channels: [{
          channel: 'email',
          async send() {
            return {};
          },
        }],
        queue: {
          adapter: {
            async enqueue(job) {
              enqueued.push(job.id);
              if (job.id !== 'accepted') {
                throw dispatchError;
              }
              return 'queued:accepted';
            },
          },
        },
        events: {
          publisher: {
            async publish(event) {
              events.push(event);
              if (event.name === 'notification.dispatch.requested') {
                if (event.notification.id === 'accepted') {
                  return Promise.reject(acceptedRequestedError);
                }
                if (event.notification.id === 'error') {
                  return Promise.reject(pendingRequestedError);
                }
                if (event.notification.id === 'undefined') {
                  return Promise.reject();
                }
              }
              if (rejectFailed && event.name === 'notification.dispatch.failed') {
                return Promise.reject();
              }
            },
          },
        },
      });
      container.register(...moduleProviders(moduleType));
      const service = await container.resolve(NotificationsService);

      const error = await service.dispatchMany(
        ['accepted', 'fulfilled', 'error', 'undefined'].map((id) => ({ channel: 'email', id, payload: {} })),
        { queue: true },
      ).catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError)) {
        throw new Error('Expected pending requested publication failures.');
      }
      const expected = [dispatchError, pendingRequestedError, undefined, ...(rejectFailed ? [undefined, undefined, undefined] : [])];
      expect(error.errors).toHaveLength(expected.length);
      expected.forEach((reason, index) => {
        expect(error.errors[index]).toBe(reason);
      });
      expect(enqueued).toEqual(['accepted', 'fulfilled']);
      expect(events.filter((event) => event.name === 'notification.dispatch.failed')
        .map((event) => event.notification.id)).toEqual(['fulfilled', 'error', 'undefined']);
      expect(events.filter((event) => event.name === 'notification.dispatch.queued')
        .map((event) => event.deliveryId)).toEqual(['queued:accepted']);
    },
  );

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

    const service = await container.resolve(NotificationsService);

    await expect(
      service.dispatch({ channel: 'slack', payload: { message: 'hello' } }),
    ).resolves.toMatchObject({ channel: 'slack', deliveryId: 'slack-1' });

    expect(service).toBeInstanceOf(NotificationsService);
    expect(factoryCalls).toEqual(['secret-key']);
    expect(deliveries).toEqual(['hello:secret-key']);
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.delivered',
    ]);
  });

  it('rejects duplicate async channel registrations before creating dependent providers', async () => {
    let dependentProviderConstructions = 0;

    @Inject(NotificationsService)
    class NotificationsDependentProvider {
      constructor(readonly notifications: NotificationsService) {
        dependentProviderConstructions += 1;
      }
    }

    const container = new Container();
    const moduleType = NotificationsModule.forRootAsync({
      useFactory: async () => ({
        channels: [
          {
            channel: 'email',
            async send() {
              return { externalId: 'first-email-provider' };
            },
          },
          {
            channel: 'email',
            async send() {
              return { externalId: 'second-email-provider' };
            },
          },
        ],
      }),
    });

    container.register(...moduleProviders(moduleType), NotificationsDependentProvider);

    await expect(container.resolve(NotificationsDependentProvider)).rejects.toThrowError(
      new NotificationsConfigurationError('Duplicate notification channel registration detected for "email".'),
    );
    expect(dependentProviderConstructions).toBe(0);
  });

  it('exposes configured service status diagnostics under details only', async () => {
    const queue = new RecordingQueueAdapter();
    const publisher = new RecordingPublisher();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            return { externalId: 'status-delivery' };
          },
        },
      ],
      events: {
        publisher,
      },
      queue: {
        adapter: queue,
        bulkThreshold: 7,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const snapshot = service.createPlatformStatusSnapshot();

    expect(snapshot).toMatchObject({
      details: {
        bulkQueueThreshold: 7,
        dependencies: ['notifications.queue-adapter', 'notifications.event-publisher'],
        eventPublicationEnabled: true,
        eventPublisherConfigured: true,
        operationMode: 'queue-backed-with-events',
        queueConfigured: true,
      },
      health: { status: 'healthy' },
      readiness: { critical: true, status: 'ready' },
    });
    expect(Object.hasOwn(snapshot, 'operationMode')).toBe(false);
    expect(Object.hasOwn(snapshot, 'dependencies')).toBe(false);
    expect(Object.hasOwn(snapshot, 'bulkQueueThreshold')).toBe(false);
    expect(Object.hasOwn(snapshot, 'queueConfigured')).toBe(false);
    expect(Object.hasOwn(snapshot, 'eventPublisherConfigured')).toBe(false);
    expect(Object.hasOwn(snapshot, 'eventPublicationEnabled')).toBe(false);
  });

  it('reports a configured-but-disabled event publisher as inactive in status diagnostics', async () => {
    const publisher = new RecordingPublisher();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            return { externalId: 'status-delivery' };
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
    const snapshot = service.createPlatformStatusSnapshot();

    expect(snapshot.details).toMatchObject({
      dependencies: [],
      eventPublicationEnabled: false,
      eventPublisherConfigured: true,
      operationMode: 'direct-only',
    });
    expect(snapshot.ownership).toEqual({
      externallyManaged: false,
      ownsResources: false,
    });

    await service.dispatch({ channel: 'email', payload: { subject: 'disabled' } });

    expect(publisher.events).toEqual([]);
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

  it('forwards a live caller abort signal to native bulk queue adapters and emits no queued result', async () => {
    const abortController = new AbortController();
    const abortError = new Error('native bulk dispatch aborted');
    const enqueueManyStarted = createDeferred();
    const publisher = new RecordingPublisher();
    let listenerRemoved = false;
    let receivedSignal: AbortSignal | undefined;
    const queue: NotificationsQueueAdapter = {
      async enqueue() {
        return 'queued:unexpected';
      },
      async enqueueMany(_jobs, context?: { readonly signal?: AbortSignal }) {
        receivedSignal = context?.signal;
        return rejectWhenAborted(context?.signal, enqueueManyStarted.resolve, () => {
          listenerRemoved = true;
        });
      },
    };
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [{ channel: 'email', async send() { return { externalId: 'direct-should-not-run' }; } }],
      events: { publisher },
      queue: { adapter: queue, bulkThreshold: 2 },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const dispatch = service.dispatchMany(
      [
        { channel: 'email', payload: { template: 'native-bulk-first' } },
        { channel: 'email', payload: { template: 'native-bulk-second' } },
      ],
      { signal: abortController.signal },
    );

    await enqueueManyStarted.promise;
    abortController.abort(abortError);

    await expect(dispatch).rejects.toBe(abortError);
    expect(receivedSignal).toBe(abortController.signal);
    expect(listenerRemoved).toBe(true);
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.requested',
      'notification.dispatch.failed',
      'notification.dispatch.failed',
    ]);
    expect(publisher.events).not.toContainEqual(expect.objectContaining({ name: 'notification.dispatch.queued' }));
  });

  it('lets explicit bulk queue opt-in override the configured threshold', async () => {
    const queue = new RecordingQueueAdapter();
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not be used for explicit queued bulk dispatch');
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
    const result = await service.dispatchMany(
      [
        { channel: 'email', payload: { template: 'below-threshold', userId: 'u1' } },
        { channel: 'email', payload: { template: 'below-threshold', userId: 'u2' } },
      ],
      { queue: true },
    );

    expect(queue.jobs).toHaveLength(2);
    expect(result).toMatchObject({
      failed: 0,
      queued: 2,
      succeeded: 2,
    });
    expect(result.results.map((entry: NotificationDispatchResult) => entry.deliveryId)).toEqual(['queued:1', 'queued:2']);
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

  it('rejects enqueueMany results after the adapter mutates the admitted jobs length', async () => {
    const publisher = new RecordingPublisher();
    const queue: NotificationsQueueAdapter = {
      async enqueue() {
        return 'queued:unexpected';
      },
      async enqueueMany(jobs) {
        Object.defineProperty(jobs, 'length', { value: 1 });

        return ['queued:1'];
      },
    };
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

    await expect(dispatch).rejects.toBeInstanceOf(NotificationQueueResultIntegrityError);
    await expect(dispatch).rejects.toMatchObject({ operation: 'enqueueMany' });
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.requested',
      'notification.dispatch.failed',
      'notification.dispatch.failed',
    ]);
  });

  it('rejects accessor-backed enqueueMany entries without invoking the mutating accessor', async () => {
    const result = ['queued:1', 'queued:2'];
    Object.defineProperty(result, '0', {
      configurable: true,
      get() {
        result.length = 1;

        return 'queued:1';
      },
    });

    const queue = new MalformedEnqueueManyQueueAdapter(result);
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

    await expect(dispatch).rejects.toBeInstanceOf(NotificationQueueResultIntegrityError);
    await expect(dispatch).rejects.toMatchObject({ operation: 'enqueueMany' });
    expect(result).toHaveLength(2);
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.requested',
      'notification.dispatch.failed',
      'notification.dispatch.failed',
    ]);
  });

  it.each([
    ['null', null],
    ['object', { id: 'queued:1' }],
    ['string', 'queued:1'],
  ])('rejects %s enqueueMany results without fabricating queued successes', async (_label, result) => {
    const queue = new MalformedEnqueueManyQueueAdapter(result);
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

    await expect(dispatch).rejects.toBeInstanceOf(NotificationQueueResultIntegrityError);
    await expect(dispatch).rejects.toMatchObject({ operation: 'enqueueMany' });
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

  it('rejects non-string enqueueMany ids without substituting fallback delivery ids', async () => {
    const queue = new MalformedEnqueueManyQueueAdapter(['queued:1', 42]);
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

  it.each([
    ['empty string', ''],
    ['non-string value', 42],
  ])('rejects %s single enqueue results without fabricating queued successes', async (_label, invalidDeliveryId) => {
    const queue = new EnqueueOnlyQueueAdapter();
    const publisher = new RecordingPublisher();
    Object.defineProperty(queue, 'enqueue', {
      value: async (job: NotificationsQueueJob): Promise<unknown> => {
        queue.jobs.push(job);
        return invalidDeliveryId;
      },
    });
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [
        {
          channel: 'email',
          async send() {
            throw new Error('direct delivery should not be used for queued dispatch');
          },
        },
      ],
      events: {
        publisher,
      },
      queue: {
        adapter: queue,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await expect(
      service.dispatch(
        { channel: 'email', id: 'caller-id', payload: { template: 'digest', userId: 'u1' } },
        { queue: true },
      ),
    ).rejects.toMatchObject({
      message: 'Notifications queue adapter returned an invalid enqueue() result: queue id must be a non-empty string.',
      name: 'NotificationQueueResultIntegrityError',
    });

    expect(queue.jobs).toHaveLength(1);
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.failed',
    ]);
  });

  it.each([
    ['empty string', ''],
    ['non-string value', 42],
  ])(
    'captures %s sequential fallback enqueue results as failures when continueOnError is enabled',
    async (_label, invalidDeliveryId) => {
      const queue = new EnqueueOnlyQueueAdapter();
      const publisher = new RecordingPublisher();
      Object.defineProperty(queue, 'enqueue', {
        value: async (job: NotificationsQueueJob): Promise<unknown> => {
          queue.jobs.push(job);
          return queue.jobs.length === 1 ? invalidDeliveryId : 'queued:2';
        },
      });
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
        queue: {
          adapter: queue,
          bulkThreshold: 2,
        },
      });

      container.register(...moduleProviders(moduleType));
      const service = await container.resolve(NotificationsService);
      const result = await service.dispatchMany(
        [
          { channel: 'email', id: 'first-job', payload: { template: 'digest', userId: 'u1' } },
          { channel: 'email', id: 'second-job', payload: { template: 'digest', userId: 'u2' } },
        ],
        { continueOnError: true },
      );

      expect(queue.jobs.map((job) => job.id)).toEqual(['first-job', 'second-job']);
      expect(result).toMatchObject({
        failed: 1,
        queued: 1,
        succeeded: 1,
      });
      expect(result.results).toEqual([
        {
          channel: 'email',
          deliveryId: 'queued:2',
          status: 'queued',
        },
      ]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.error).toMatchObject({
        message: 'Notifications queue adapter returned an invalid enqueue() result: queue id must be a non-empty string.',
        name: 'NotificationQueueResultIntegrityError',
      });
      expect(result.failures[0]?.notification).toMatchObject({ id: 'first-job' });
      expect(publisher.events.map((event) => event.name)).toEqual([
        'notification.dispatch.requested',
        'notification.dispatch.requested',
        'notification.dispatch.failed',
        'notification.dispatch.queued',
      ]);
    },
  );

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

  it('records abort failures without handing remaining fallback jobs to the queue', async () => {
    const abortController = new AbortController();
    const abortError = new Error('sequential fallback dispatch aborted');
    const firstEnqueueStarted = createDeferred();
    const publisher = new RecordingPublisher();
    const receivedSignals: AbortSignal[] = [];
    let enqueueCalls = 0;
    let listenerRemoved = false;
    let rejectMissingSignal = (): void => {};
    const queue: NotificationsQueueAdapter = {
      async enqueue(_job, context?: { readonly signal?: AbortSignal }) {
        enqueueCalls += 1;

        const signal = context?.signal;

        if (signal) {
          receivedSignals.push(signal);
        }

        if (enqueueCalls > 1) {
          return 'queued:unexpected';
        }

        if (!signal) {
          firstEnqueueStarted.resolve();

          return new Promise((_, reject) => {
            rejectMissingSignal = (): void => {
              reject(new Error('Expected the caller abort signal.'));
            };
          });
        }

        return new Promise((_, reject) => {
          const onAbort = (): void => {
            signal.removeEventListener('abort', onAbort);
            listenerRemoved = true;
            reject(signal.reason);
          };

          signal.addEventListener('abort', onAbort);
          firstEnqueueStarted.resolve();
        });
      },
    };
    const container = new Container();
    const moduleType = NotificationsModule.forRoot({
      channels: [{ channel: 'email', async send() { return { externalId: 'direct-should-not-run' }; } }],
      events: { publisher },
      queue: { adapter: queue, bulkThreshold: 2 },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    const dispatch = service.dispatchMany(
      [
        { channel: 'email', payload: { template: 'sequential-first' } },
        { channel: 'email', payload: { template: 'sequential-second' } },
      ],
      { continueOnError: true, signal: abortController.signal },
    );

    await firstEnqueueStarted.promise;
    abortController.abort(abortError);
    rejectMissingSignal();

    const result = await dispatch;

    expect(enqueueCalls).toBe(1);
    expect(receivedSignals).toEqual([abortController.signal]);
    expect(listenerRemoved).toBe(true);
    expect(result).toMatchObject({
      failed: 2,
      queued: 0,
      succeeded: 0,
    });
    expect(result.results).toEqual([]);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]?.error).toBe(abortError);
    expect(result.failures[1]?.error).toBe(abortError);
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.requested',
      'notification.dispatch.failed',
      'notification.dispatch.failed',
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
    expect(result.failures[0]?.notification).toEqual(notifications[1]);
    expect(result.failures[0]?.notification).not.toBe(notifications[1]);
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
    expect(result.failures[0]?.notification).toEqual(notifications[1]);
    expect(result.failures[0]?.notification).not.toBe(notifications[1]);
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

  it('keeps generated queue and fallback ids deterministic for cyclic opaque payloads', async () => {
    const queue = new RecordingQueueAdapter();
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
      queue: {
        adapter: queue,
        bulkThreshold: 50,
      },
    });

    const cyclicPayload: Record<string, unknown> = { template: 'cyclic' };
    cyclicPayload.self = cyclicPayload;

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);
    await service.dispatch({ channel: 'email', payload: cyclicPayload }, { queue: true });
    await service.dispatch({ channel: 'email', payload: cyclicPayload }, { queue: true });
    const firstFallback = await service.dispatch({ channel: 'email', payload: cyclicPayload });
    const repeatedFallback = await service.dispatch({ channel: 'email', payload: cyclicPayload });

    expectGeneratedQueueJobId(queue.jobs[0]?.id);
    expect(queue.jobs[1]?.id).toBe(queue.jobs[0]?.id);
    expect(firstFallback.deliveryId).toMatch(/^fallback:email:[a-z0-9]{13}$/);
    expect(repeatedFallback.deliveryId).toBe(firstFallback.deliveryId);
  });

  it('keeps generated ids deterministic for reordered cyclic Map and Set payloads', async () => {
    function createPayload(order: readonly [string, 'alpha' | 'beta'][]): Record<string, unknown> {
      const payload: Record<string, unknown> = { template: 'cyclic-collections' };
      const valuesByName = {
        alpha: { label: 'alpha' } as Record<string, unknown>,
        beta: { label: 'beta' } as Record<string, unknown>,
      };
      valuesByName.alpha.self = valuesByName.alpha;
      valuesByName.beta.self = valuesByName.beta;

      payload.map = new Map(order.map(([key, valueName]) => [key, valuesByName[valueName]]));
      payload.set = new Set(order.map(([, valueName]) => valuesByName[valueName]));

      return payload;
    }

    const queue = new RecordingQueueAdapter();
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
      queue: {
        adapter: queue,
        bulkThreshold: 50,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(NotificationsService);

    await service.dispatch({ channel: 'email', payload: createPayload([['a', 'alpha'], ['b', 'beta']]) }, { queue: true });
    await service.dispatch({ channel: 'email', payload: createPayload([['b', 'beta'], ['a', 'alpha']]) }, { queue: true });
    const firstFallback = await service.dispatch({ channel: 'email', payload: createPayload([['a', 'alpha'], ['b', 'beta']]) });
    const reorderedFallback = await service.dispatch({ channel: 'email', payload: createPayload([['b', 'beta'], ['a', 'alpha']]) });

    expectGeneratedQueueJobId(queue.jobs[0]?.id);
    expect(queue.jobs[1]?.id).toBe(queue.jobs[0]?.id);
    expect(reorderedFallback.deliveryId).toBe(firstFallback.deliveryId);
  });

  it('preserves caller-supplied notification ids as queue job ids', async () => {
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

    await service.dispatch({ channel: 'email', id: 'caller-supplied-job-id', payload: { template: 'explicit-id' } }, { queue: true });

    expect(queue.jobs.map((job) => job.id)).toEqual(['caller-supplied-job-id']);
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
    expect(result.failures[0]?.notification).toEqual(notifications[1]);
    expect(result.failures[0]?.notification).not.toBe(notifications[1]);
    expect(result.failures[0]?.error).toBe(providerError);
  });
});
