import { describe, expect, it } from 'vitest';

import { NotificationsService } from './service.js';
import type {
  NotificationChannel,
  NotificationDispatchRequest,
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

class SelectiveFailureQueueAdapter implements NotificationsQueueAdapter {
  readonly jobs: NotificationsQueueJob[] = [];

  async enqueue(job: NotificationsQueueJob): Promise<string> {
    this.jobs.push(job);

    if (job.notification.id === 'batch-two') {
      throw new Error('queue rejected batch-two');
    }

    return `queued:${job.notification.id ?? 'generated'}`;
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

  it('publishes immutable value representations for nested mutable built-ins', async () => {
    const publisher = new MutatingLifecyclePublisher();
    const deliveries: NotificationDispatchRequest[] = [];
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
    const expression = /notice/gy;
    expression.lastIndex = 2;
    const notification = {
      channel: 'email',
      metadata: {
        map: new Map([['one', { value: 'initial' }]]),
        set: new Set(['one']),
      },
      payload: {
        date: new Date(0),
        expression,
        parameters: new URLSearchParams('tag=one&tag=two'),
        url: new URL('https://example.test/a'),
      },
    };

    const dispatch = service.dispatch(notification);

    await publisher.waitForRequested();

    notification.metadata.map.set('two', { value: 'caller-mutated' });
    notification.metadata.set.add('two');
    notification.payload.date.setTime(1_000);
    notification.payload.expression.lastIndex = 0;
    notification.payload.parameters.append('tag', 'caller-mutated');
    notification.payload.url.pathname = '/b';
    publisher.continueRequestedPublication();

    await dispatch;

    const snapshot = publisher.events[0]?.notification;
    expect(snapshot).toMatchObject({
      metadata: {
        map: {
          entries: [['one', { value: 'initial' }]],
          kind: 'Map',
        },
        set: {
          kind: 'Set',
          values: ['one'],
        },
      },
      payload: {
        date: {
          epochMilliseconds: 0,
          kind: 'Date',
        },
        expression: {
          flags: 'gy',
          kind: 'RegExp',
          lastIndex: 2,
          source: 'notice',
        },
        parameters: {
          kind: 'URLSearchParams',
          query: 'tag=one&tag=two',
        },
        url: {
          href: 'https://example.test/a',
          kind: 'URL',
        },
      },
    });
    expect(deliveries[0]?.metadata?.map).toEqual(new Map([['one', { value: 'initial' }]]));
    expect(deliveries[0]?.metadata?.set).toEqual(new Set(['one']));
    expect(deliveries[0]?.payload.date).toEqual(new Date(0));
    expect(deliveries[0]?.payload.expression).toEqual(expect.objectContaining({ lastIndex: 2 }));
    expect(deliveries[0]?.payload.parameters).toEqual(new URLSearchParams('tag=one&tag=two'));
    expect(deliveries[0]?.payload.url).toEqual(new URL('https://example.test/a'));
    expect(publisher.events[1]?.notification).toEqual(snapshot);
    expect(publisher.events[1]?.notification).not.toBe(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.metadata)).toBe(true);
    expect(Object.isFrozen(snapshot?.payload)).toBe(true);
    expect(Reflect.set(snapshot?.payload.date ?? {}, 'epochMilliseconds', 1_000)).toBe(false);
    expect(snapshot?.payload.date).toEqual({
      epochMilliseconds: 0,
      kind: 'Date',
    });
  });

  it('preserves cyclic lifecycle snapshots as isolated immutable graphs', async () => {
    const publisher = new MutatingLifecyclePublisher();
    const deliveries: NotificationDispatchRequest[] = [];
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
    const payload: Record<string, unknown> = { template: 'original' };
    payload.self = payload;
    const notification = {
      channel: 'email',
      id: 'original-id',
      payload,
    };
    const dispatch = service.dispatch(notification);

    await publisher.waitForRequested();
    payload.template = 'caller-mutated';
    publisher.continueRequestedPublication();

    await dispatch;

    const requested = publisher.events[0];
    const delivered = publisher.events[1];
    const requestedPayload = requested?.notification.payload;
    const deliveredPayload = delivered?.notification.payload;

    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.delivered',
    ]);
    expect(publisher.mutationResults).toEqual([false, false, false, false, false, false]);
    expect(requestedPayload?.self).toBe(requestedPayload);
    expect(deliveredPayload?.self).toBe(deliveredPayload);
    expect(requestedPayload).not.toBe(payload);
    expect(requestedPayload).not.toBe(deliveries[0]?.payload);
    expect(requestedPayload).not.toBe(deliveredPayload);
    expect(Object.isFrozen(requested)).toBe(true);
    expect(Object.isFrozen(requested?.notification)).toBe(true);
    expect(Object.isFrozen(requestedPayload)).toBe(true);
    expect(Reflect.set(requestedPayload ?? {}, 'template', 'observer-mutated')).toBe(false);
    expect(requestedPayload?.template).toBe('original');
    expect(deliveredPayload?.template).toBe('original');
  });

  it('represents ArrayBuffer and view lifecycle values as immutable byte data', async () => {
    const publisher = new MutatingLifecyclePublisher();
    const channel: NotificationChannel = {
      channel: 'email',
      async send() {
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
    const buffer = new ArrayBuffer(3);
    const bytes = new Uint8Array(buffer);
    bytes.set([1, 2, 3]);
    const dispatch = service.dispatch({
      channel: 'email',
      payload: {
        buffer,
        dataView: new DataView(buffer, 0, 2),
        view: new Uint8Array(buffer, 1, 2),
      },
    });

    await publisher.waitForRequested();
    bytes[1] = 9;
    publisher.continueRequestedPublication();

    await dispatch;

    expect(publisher.events[0]?.notification.payload).toMatchObject({
      buffer: {
        byteLength: 3,
        bytes: [1, 2, 3],
        kind: 'ArrayBuffer',
      },
      dataView: {
        byteLength: 2,
        byteOffset: 0,
        bytes: [1, 2],
        kind: 'ArrayBufferView',
        view: 'DataView',
      },
      view: {
        byteLength: 2,
        byteOffset: 1,
        bytes: [2, 3],
        kind: 'ArrayBufferView',
        view: 'Uint8Array',
      },
    });
    expect(publisher.events[1]?.notification).toEqual(publisher.events[0]?.notification);
  });

  it('admits every queued batch envelope before requested publication can yield', async () => {
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
    const first: NotificationDispatchRequest = {
      channel: 'email',
      payload: { template: 'first' },
    };
    const second: NotificationDispatchRequest = {
      channel: 'email',
      id: 'batch-two',
      payload: { template: 'second' },
    };
    const dispatch = service.dispatchMany([first, second], { queue: true });

    await publisher.waitForRequested();
    first.channel = 'discord';
    first.id = 'caller-mutated-first';
    first.payload.template = 'caller-mutated-first';
    second.channel = 'discord';
    second.id = 'caller-mutated-second';
    second.payload.template = 'caller-mutated-second';
    publisher.continueRequestedPublication();

    await expect(dispatch).resolves.toMatchObject({
      failed: 0,
      queued: 2,
      results: [
        { channel: 'email', queued: true, status: 'queued' },
        { channel: 'email', queued: true, status: 'queued' },
      ],
      succeeded: 2,
    });
    expect(queue.jobs).toMatchObject([
      {
        channel: 'email',
        notification: {
          channel: 'email',
          payload: { template: 'first' },
        },
      },
      {
        channel: 'email',
        id: 'batch-two',
        notification: {
          channel: 'email',
          id: 'batch-two',
          payload: { template: 'second' },
        },
      },
    ]);
    expect(queue.jobs[0]?.id).toMatch(/^notification:email:/);
    expect(queue.jobs[0]?.id).not.toBe('caller-mutated-first');
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.requested',
      'notification.dispatch.queued',
      'notification.dispatch.queued',
    ]);
    expect(publisher.mutationResults).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('admits direct batch envelopes before lifecycle publication and preserves failure snapshots', async () => {
    const publisher = new MutatingLifecyclePublisher();
    const deliveries: NotificationDispatchRequest[] = [];
    const channel: NotificationChannel = {
      channel: 'email',
      async send(notification) {
        deliveries.push(notification);

        if (notification.id === 'batch-two') {
          throw new Error('provider rejected batch-two');
        }

        return { externalId: 'delivered:first' };
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
    const first: NotificationDispatchRequest = {
      channel: 'email',
      id: 'batch-one',
      payload: { template: 'first' },
    };
    const second: NotificationDispatchRequest = {
      channel: 'email',
      id: 'batch-two',
      payload: { template: 'second' },
    };
    const dispatch = service.dispatchMany([first, second], { continueOnError: true });

    await publisher.waitForRequested();
    second.channel = 'discord';
    second.id = 'caller-mutated-second';
    second.payload.template = 'caller-mutated-second';
    publisher.continueRequestedPublication();

    await expect(dispatch).resolves.toMatchObject({
      failed: 1,
      failures: [
        {
          notification: {
            channel: 'email',
            id: 'batch-two',
            payload: { template: 'second' },
          },
        },
      ],
      queued: 0,
      results: [
        {
          channel: 'email',
          deliveryId: 'delivered:first',
          queued: false,
          status: 'delivered',
        },
      ],
      succeeded: 1,
    });
    expect(deliveries).toEqual([
      {
        channel: 'email',
        id: 'batch-one',
        payload: { template: 'first' },
      },
      {
        channel: 'email',
        id: 'batch-two',
        payload: { template: 'second' },
      },
    ]);
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.delivered',
      'notification.dispatch.requested',
      'notification.dispatch.failed',
    ]);
    expect(publisher.events.slice(2)).toMatchObject([
      {
        notification: {
          channel: 'email',
          id: 'batch-two',
          payload: { template: 'second' },
        },
      },
      {
        notification: {
          channel: 'email',
          id: 'batch-two',
          payload: { template: 'second' },
        },
      },
    ]);
    expect(publisher.mutationResults).toHaveLength(12);
    expect(publisher.mutationResults.every((result) => result === false)).toBe(true);
  });

  it('uses admitted envelopes for sequential queue fallback failure records', async () => {
    const publisher = new MutatingLifecyclePublisher();
    const queue = new SelectiveFailureQueueAdapter();
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
    const first: NotificationDispatchRequest = {
      channel: 'email',
      id: 'batch-one',
      payload: { template: 'first' },
    };
    const second: NotificationDispatchRequest = {
      channel: 'email',
      id: 'batch-two',
      payload: { template: 'second' },
    };
    const dispatch = service.dispatchMany([first, second], {
      continueOnError: true,
      queue: true,
    });

    await publisher.waitForRequested();
    second.channel = 'discord';
    second.id = 'caller-mutated-second';
    second.payload.template = 'caller-mutated-second';
    publisher.continueRequestedPublication();

    await expect(dispatch).resolves.toMatchObject({
      failed: 1,
      failures: [
        {
          notification: {
            channel: 'email',
            id: 'batch-two',
            payload: { template: 'second' },
          },
        },
      ],
      queued: 1,
      results: [
        {
          channel: 'email',
          deliveryId: 'queued:batch-one',
          queued: true,
          status: 'queued',
        },
      ],
      succeeded: 1,
    });
    expect(queue.jobs).toMatchObject([
      {
        channel: 'email',
        id: 'batch-one',
        notification: {
          channel: 'email',
          id: 'batch-one',
          payload: { template: 'first' },
        },
      },
      {
        channel: 'email',
        id: 'batch-two',
        notification: {
          channel: 'email',
          id: 'batch-two',
          payload: { template: 'second' },
        },
      },
    ]);
    expect(publisher.events.map((event) => event.name)).toEqual([
      'notification.dispatch.requested',
      'notification.dispatch.requested',
      'notification.dispatch.queued',
      'notification.dispatch.failed',
    ]);
    expect(publisher.events[3]).toMatchObject({
      notification: {
        channel: 'email',
        id: 'batch-two',
        payload: { template: 'second' },
      },
    });
    expect(publisher.mutationResults).toHaveLength(12);
    expect(publisher.mutationResults.every((result) => result === false)).toBe(true);
  });

  it('rejects own and prototype accessors before they can expose mutable state', async () => {
    const publisher = new MutatingLifecyclePublisher();
    const deliveries: NotificationDispatchRequest[] = [];
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
    let ownAccessorReads = 0;
    const ownAccessorPayload: Record<string, unknown> = {};
    Object.defineProperty(ownAccessorPayload, 'template', {
      enumerable: true,
      get() {
        ownAccessorReads += 1;

        return 'unsafe';
      },
    });
    let prototypeAccessorReads = 0;
    const prototype = {};
    Object.defineProperty(prototype, 'template', {
      enumerable: true,
      get() {
        prototypeAccessorReads += 1;

        return 'unsafe';
      },
    });
    const prototypeAccessorPayload = Object.create(prototype) as Record<string, unknown>;

    await expect(
      service.dispatch({ channel: 'email', payload: ownAccessorPayload }),
    ).rejects.toThrow('Notification snapshots only support data properties on plain objects.');
    await expect(
      service.dispatch({ channel: 'email', payload: prototypeAccessorPayload }),
    ).rejects.toThrow('Notification snapshots only support data properties on plain objects.');

    expect(ownAccessorReads).toBe(0);
    expect(prototypeAccessorReads).toBe(0);
    expect(publisher.events).toEqual([]);
    expect(deliveries).toEqual([]);
  });
});
