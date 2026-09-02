import { Inject } from '@fluojs/core';

import {
  NotificationChannelNotFoundError,
  NotificationQueueNotConfiguredError,
  NotificationQueueResultIntegrityError,
} from './errors.js';
import {
  createNotificationDispatchSnapshot,
  createNotificationLifecycleEventSnapshot,
} from './snapshots.js';
import { createNotificationsPlatformStatusSnapshot } from './status.js';
import { NOTIFICATION_CHANNELS, NOTIFICATIONS_OPTIONS } from './tokens.js';
import type {
  NormalizedNotificationsModuleOptions,
  NotificationChannel,
  NotificationDispatchBatchResult,
  NotificationDispatchManyOptions,
  NotificationDispatchOptions,
  NotificationDispatchRequest,
  NotificationDispatchResult,
  NotificationLifecycleEvent,
  Notifications,
  NotificationsQueueJob,
} from './types.js';

/**
 * Injectable orchestration service for shared notification dispatch.
 *
 * @remarks
 * The foundation package keeps channel-specific payload semantics opaque. It only
 * resolves channels by name, applies optional queue delegation, and emits optional
 * lifecycle events through the configured publisher seam.
 */
@Inject(NOTIFICATIONS_OPTIONS, NOTIFICATION_CHANNELS)
export class NotificationsService implements Notifications {
  private readonly channelsByName = new Map<string, NotificationChannel>();

  constructor(
    private readonly options: NormalizedNotificationsModuleOptions,
    channels: readonly NotificationChannel[],
  ) {
    for (const channel of channels) {
      this.channelsByName.set(channel.channel, channel);
    }
  }

  /**
   * Dispatches one notification through a registered channel or the configured queue seam.
   *
   * @typeParam TRequest Shared notification request envelope subtype.
   * @param notification Request envelope identifying the channel and opaque payload.
   * @param options Optional abort, queue, and lifecycle-publication controls.
   * @returns A normalized dispatch result describing direct vs queued delivery.
   * @throws {NotificationChannelNotFoundError} When no registered channel matches `notification.channel`.
   * @throws {NotificationQueueNotConfiguredError} When queue delivery is requested without a queue adapter.
   * @throws {NotificationQueueResultIntegrityError} When a queue adapter returns an invalid delivery identifier.
   *
   * @example
   * ```ts
   * await notifications.dispatch({
   *   channel: 'email',
   *   subject: 'Welcome',
   *   payload: { template: 'welcome', userId: 'u_123' },
   *   recipients: ['hello@example.com'],
   * });
   * ```
   */
  async dispatch<TRequest extends NotificationDispatchRequest>(
    notification: TRequest,
    options: NotificationDispatchOptions = {},
  ): Promise<NotificationDispatchResult> {
    const dispatchNotification = createNotificationDispatchSnapshot(notification);

    return this.dispatchAdmitted(dispatchNotification, options);
  }

  private async dispatchAdmitted<TRequest extends NotificationDispatchRequest>(
    dispatchNotification: TRequest,
    options: NotificationDispatchOptions,
  ): Promise<NotificationDispatchResult> {
    const requestedPublicationError = await this.publishLifecycleEventBestEffort(
      'notification.dispatch.requested',
      dispatchNotification,
      options,
    );

    if (this.shouldQueueSingleDispatch(options)) {
      try {
        this.requireChannel(dispatchNotification.channel);
      } catch (error) {
        await this.publishFailureLifecycleEvent(dispatchNotification, options, error, requestedPublicationError);
        throw error;
      }

      const job = this.createQueueJob(dispatchNotification);
      try {
        const deliveryId = validateQueueDeliveryId(await this.requireQueueAdapter().enqueue(job));
        const result: NotificationDispatchResult = {
          channel: dispatchNotification.channel,
          deliveryId,
          queued: true,
          status: 'queued',
        };

        await this.publishLifecycleEventBestEffort(
          'notification.dispatch.queued',
          dispatchNotification,
          options,
          result.deliveryId,
        );

        return result;
      } catch (error) {
        await this.publishFailureLifecycleEvent(dispatchNotification, options, error, requestedPublicationError);
        throw error;
      }
    }

    let channel: NotificationChannel;

    try {
      channel = this.requireChannel(dispatchNotification.channel);
    } catch (error) {
      await this.publishFailureLifecycleEvent(dispatchNotification, options, error, requestedPublicationError);
      throw error;
    }

    try {
      const delivery = await channel.send(dispatchNotification, { signal: options.signal });
      const result: NotificationDispatchResult = {
        channel: dispatchNotification.channel,
        deliveryId: this.normalizeDeliveryId(delivery.externalId, dispatchNotification),
        metadata: delivery.metadata,
        queued: delivery.status === 'queued',
        status: delivery.status ?? 'delivered',
      };

      await this.publishLifecycleEventBestEffort(
        result.queued ? 'notification.dispatch.queued' : 'notification.dispatch.delivered',
        dispatchNotification,
        options,
        result.deliveryId,
      );

      return result;
    } catch (error) {
      await this.publishFailureLifecycleEvent(dispatchNotification, options, error, requestedPublicationError);
      throw error;
    }
  }

  /**
   * Dispatches multiple notifications in input order with optional bulk queue delegation.
   *
   * @typeParam TRequest Shared notification request envelope subtype.
   * @param notifications Ordered notification envelopes to send or enqueue.
   * @param options Optional queue preference and tolerant error-handling controls.
   * @returns A batch summary containing successes and captured failures.
   * @throws {NotificationQueueNotConfiguredError} When queue-backed bulk delivery is requested without a queue adapter.
   * @throws {NotificationQueueResultIntegrityError} When a queue adapter returns invalid delivery identifiers.
   */
  async dispatchMany<TRequest extends NotificationDispatchRequest>(
    notifications: readonly TRequest[],
    options: NotificationDispatchManyOptions = {},
  ): Promise<NotificationDispatchBatchResult<TRequest>> {
    if (notifications.length === 0) {
      return {
        failed: 0,
        failures: [],
        queued: 0,
        results: [],
        succeeded: 0,
      };
    }

    const dispatchNotifications = notifications.map((notification) => createNotificationDispatchSnapshot(notification));

    if (this.shouldQueue(notifications.length, options)) {
      const requestedPublicationErrors = await this.publishRequestedLifecycleEvents(dispatchNotifications, options);

      let queue: ReturnType<NotificationsService['requireQueueAdapter']>;

      try {
        queue = this.requireQueueAdapter();
      } catch (error) {
        await this.publishFailureLifecycleEvents(dispatchNotifications, options, error, requestedPublicationErrors);
        throw error;
      }

      try {
        for (const notification of dispatchNotifications) {
          this.requireChannel(notification.channel);
        }
      } catch (error) {
        await this.publishFailureLifecycleEvents(dispatchNotifications, options, error, requestedPublicationErrors);
        throw error;
      }

      const jobs = dispatchNotifications.map((notification) => this.createQueueJob(notification));

      if (!queue.enqueueMany) {
        return this.dispatchManyThroughSequentialQueueFallback(
          dispatchNotifications,
          jobs,
          options,
          requestedPublicationErrors,
        );
      }

      const admittedJobCount = jobs.length;
      let results: NotificationDispatchResult[];

      try {
        const ids = validateQueueBatchDeliveryIds(await queue.enqueueMany(jobs), admittedJobCount);
        results = dispatchNotifications.map((notification, index) => {
          const deliveryId = ids[index];

          if (deliveryId === undefined) {
            throw createQueueResultIntegrityError('enqueueMany', `queue id at index ${index} must be present`);
          }

          return {
            channel: notification.channel,
            deliveryId,
            queued: true,
            status: 'queued' as const,
          };
        });
      } catch (error) {
        await this.publishFailureLifecycleEvents(dispatchNotifications, options, error, requestedPublicationErrors);
        throw error;
      }

      for (let index = 0; index < dispatchNotifications.length; index += 1) {
        const notification = dispatchNotifications[index];
        await this.publishLifecycleEventBestEffort('notification.dispatch.queued', notification, options, results[index]?.deliveryId);
      }

      return {
        failed: 0,
        failures: [],
        queued: results.length,
        results,
        succeeded: results.length,
      };
    }

    const results: NotificationDispatchResult[] = [];
    const failures: Array<{ error: Error; notification: TRequest }> = [];

    for (const notification of dispatchNotifications) {
      try {
        results.push(await this.dispatchAdmitted(notification, options));
      } catch (error) {
        const failure = {
          error: error instanceof Error ? error : new Error('Notification dispatch failed.'),
          notification,
        };

        if (!(options.continueOnError ?? false)) {
          throw failure.error;
        }

        failures.push(failure);
      }
    }

    return {
      failed: failures.length,
      failures,
      queued: results.filter((result) => result.queued).length,
      results,
      succeeded: results.length,
    };
  }

  /**
   * Creates a health/readiness snapshot for the active notifications wiring.
   *
   * @returns A structured snapshot describing registered channels and optional integration seams.
   */
  createPlatformStatusSnapshot() {
    return createNotificationsPlatformStatusSnapshot({
      bulkQueueThreshold: this.options.queue?.bulkThreshold ?? 0,
      channelsRegistered: this.channelsByName.size,
      eventPublicationEnabled: this.options.events?.publishLifecycleEvents ?? false,
      eventPublisherConfigured: this.options.events !== undefined,
      queueConfigured: this.options.queue !== undefined,
    });
  }

  private createQueueJob<TRequest extends NotificationDispatchRequest>(notification: TRequest): NotificationsQueueJob<TRequest> {
    return {
      channel: notification.channel,
      id: this.createQueueJobId(notification),
      notification,
      queuedAt: new Date().toISOString(),
    };
  }

  private createQueueJobId(notification: NotificationDispatchRequest): string {
    if (notification.id && notification.id.length > 0) {
      return notification.id;
    }

    return `notification:${notification.channel}:${stableNotificationHash(notification)}`;
  }

  private requireChannel(channelName: string): NotificationChannel {
    const channel = this.channelsByName.get(channelName);

    if (!channel) {
      throw new NotificationChannelNotFoundError(channelName);
    }

    return channel;
  }

  private normalizeDeliveryId(value: string | undefined, fallback: NotificationDispatchRequest): string {
    if (value && value.length > 0) {
      return value;
    }

    if (fallback.id) {
      return fallback.id;
    }

    return `fallback:${fallback.channel}:${stableNotificationHash(fallback)}`;
  }

  private requireQueueAdapter() {
    if (!this.options.queue) {
      throw new NotificationQueueNotConfiguredError();
    }

    return this.options.queue.adapter;
  }

  private shouldPublishLifecycleEvents(options: NotificationDispatchOptions): boolean {
    if (typeof options.publishLifecycleEvents === 'boolean') {
      return options.publishLifecycleEvents;
    }

    return this.options.events?.publishLifecycleEvents ?? false;
  }

  private shouldQueueSingleDispatch(options: NotificationDispatchOptions): boolean {
    return options.queue === true;
  }

  private shouldQueue(notificationCount: number, options: NotificationDispatchOptions): boolean {
    if (options.queue === true) {
      return true;
    }

    if (options.queue === false || !this.options.queue) {
      return false;
    }

    return notificationCount >= this.options.queue.bulkThreshold;
  }

  private async publishLifecycleEvent<TRequest extends NotificationDispatchRequest>(
    name: NotificationLifecycleEvent['name'],
    notification: TRequest,
    options: NotificationDispatchOptions,
    deliveryId?: string,
    error?: unknown,
  ): Promise<void> {
    if (!this.options.events || !this.shouldPublishLifecycleEvents(options)) {
      return;
    }

    const event = createNotificationLifecycleEventSnapshot({
      channel: notification.channel,
      deliveryId,
      error: error instanceof Error
        ? {
            message: error.message,
            name: error.name,
          }
        : undefined,
      name,
      notification,
      occurredAt: new Date().toISOString(),
    });

    await this.options.events.publisher.publish(event);
  }

  private async publishLifecycleEventBestEffort<TRequest extends NotificationDispatchRequest>(
    name: NotificationLifecycleEvent['name'],
    notification: TRequest,
    options: NotificationDispatchOptions,
    deliveryId?: string,
    error?: unknown,
  ): Promise<unknown | undefined> {
    try {
      await this.publishLifecycleEvent(name, notification, options, deliveryId, error);
    } catch (publicationError) {
      return publicationError;
    }

    return undefined;
  }

  private async publishFailureLifecycleEvent<TRequest extends NotificationDispatchRequest>(
    notification: TRequest,
    options: NotificationDispatchOptions,
    error: unknown,
    ...precedingPublicationErrors: readonly unknown[]
  ): Promise<void> {
    const priorPublicationErrors = precedingPublicationErrors.filter((entry) => entry !== undefined);

    try {
      await this.publishLifecycleEvent('notification.dispatch.failed', notification, options, undefined, error);
    } catch (publicationError) {
      throw createLifecyclePublicationFailureError(error, ...priorPublicationErrors, publicationError);
    }

    if (priorPublicationErrors.length > 0) {
      throw createLifecyclePublicationFailureError(error, ...priorPublicationErrors);
    }
  }

  private async publishFailureLifecycleEvents<TRequest extends NotificationDispatchRequest>(
    notifications: readonly TRequest[],
    options: NotificationDispatchOptions,
    error: unknown,
    precedingPublicationErrors: readonly unknown[] = [],
  ): Promise<void> {
    const priorPublicationErrors = precedingPublicationErrors.filter((entry) => entry !== undefined);
    const failurePublicationResults = await Promise.allSettled(
      notifications.map((notification) =>
        this.publishLifecycleEvent('notification.dispatch.failed', notification, options, undefined, error),
      ),
    );

    const publicationFailures = failurePublicationResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);

    if (publicationFailures.length > 0) {
      throw createLifecyclePublicationFailureError(error, ...priorPublicationErrors, ...publicationFailures);
    }

    if (priorPublicationErrors.length > 0) {
      throw createLifecyclePublicationFailureError(error, ...priorPublicationErrors);
    }
  }

  private async publishRequestedLifecycleEvents<TRequest extends NotificationDispatchRequest>(
    notifications: readonly TRequest[],
    options: NotificationDispatchOptions,
  ): Promise<readonly unknown[]> {
    const publicationErrors: Array<unknown | undefined> = [];

    for (const notification of notifications) {
      const publicationError = await this.publishLifecycleEventBestEffort(
        'notification.dispatch.requested',
        notification,
        options,
      );

      publicationErrors.push(publicationError);
    }

    return publicationErrors;
  }

  private async dispatchManyThroughSequentialQueueFallback<TRequest extends NotificationDispatchRequest>(
    notifications: readonly TRequest[],
    jobs: readonly NotificationsQueueJob<TRequest>[],
    options: NotificationDispatchManyOptions,
    requestedPublicationErrors: readonly unknown[],
  ): Promise<NotificationDispatchBatchResult<TRequest>> {
    const queue = this.requireQueueAdapter();
    const results: NotificationDispatchResult[] = [];
    const failures: Array<{ error: Error; notification: TRequest }> = [];

    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      const notification = notifications[index];

      if (!job || !notification) {
        continue;
      }

      try {
        const deliveryId = validateQueueDeliveryId(await queue.enqueue(job));
        const result: NotificationDispatchResult = {
          channel: notification.channel,
          deliveryId,
          queued: true,
          status: 'queued',
        };

        results.push(result);
        await this.publishLifecycleEventBestEffort('notification.dispatch.queued', notification, options, deliveryId);
      } catch (error) {
        const failure: { error: Error; notification: TRequest } = {
          error: error instanceof Error ? error : new Error('Notification queue enqueue failed.'),
          notification,
        };

        if (!(options.continueOnError ?? false)) {
          await this.publishFailureLifecycleEvents(notifications.slice(index), options, error, requestedPublicationErrors.slice(index));
          throw error;
        }

        try {
          await this.publishFailureLifecycleEvent(notification, options, error, requestedPublicationErrors[index]);
        } catch (publicationError) {
          failure.error = publicationError instanceof Error
            ? publicationError
            : createLifecyclePublicationFailureError(error, publicationError);
        }

        failures.push(failure);
      }
    }

    return {
      failed: failures.length,
      failures,
      queued: results.length,
      results,
      succeeded: results.length,
    };
  }
}

function validateQueueBatchDeliveryIds(value: unknown, expectedCount: number): readonly string[] {
  if (!Array.isArray(value)) {
    throw createQueueResultIntegrityError('enqueueMany', `expected ${expectedCount} queue ids but received a non-array result`);
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');

  if (!isOwnDataPropertyDescriptor(lengthDescriptor)) {
    throw createQueueResultIntegrityError('enqueueMany', `expected ${expectedCount} queue ids but received an invalid length descriptor`);
  }

  if (lengthDescriptor.value !== expectedCount) {
    throw createQueueResultIntegrityError('enqueueMany', `expected ${expectedCount} queue ids but received ${String(lengthDescriptor.value)}`);
  }

  const ids: string[] = [];

  for (let index = 0; index < expectedCount; index += 1) {
    const descriptor = descriptors[String(index)];

    if (!descriptor) {
      throw createQueueResultIntegrityError('enqueueMany', `queue id at index ${index} must be present`);
    }

    if (!isOwnDataPropertyDescriptor(descriptor)) {
      throw createQueueResultIntegrityError('enqueueMany', `queue id at index ${index} must be an own data property`);
    }

    const entry = descriptor.value;

    if (typeof entry !== 'string' || entry.length === 0) {
      throw createQueueResultIntegrityError('enqueueMany', `queue id at index ${index} must be a non-empty string`);
    }

    ids.push(entry);
  }

  return Object.freeze(ids);
}

function isOwnDataPropertyDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } {
  return descriptor !== undefined
    && Object.hasOwn(descriptor, 'value')
    && !Object.hasOwn(descriptor, 'get')
    && !Object.hasOwn(descriptor, 'set');
}

function validateQueueDeliveryId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw createQueueResultIntegrityError('enqueue', 'queue id must be a non-empty string');
  }

  return value;
}

function createQueueResultIntegrityError(
  operation: 'enqueue' | 'enqueueMany',
  message: string,
): NotificationQueueResultIntegrityError {
  return new NotificationQueueResultIntegrityError(operation, message);
}

function createLifecyclePublicationFailureError(dispatchError: unknown, ...publicationErrors: unknown[]): AggregateError {
  const primaryMessage = dispatchError instanceof Error ? dispatchError.message : 'Notification dispatch failed.';

  return new AggregateError(
    [dispatchError, ...publicationErrors],
    `Notification dispatch failed, and failed lifecycle event publication also failed: ${primaryMessage}`,
  );
}

function stableNotificationHash(notification: NotificationDispatchRequest): string {
  let hash = 0xcbf29ce484222325n;
  const input = stableStringify(notification, createStableStringifyContext());

  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }

  return hash.toString(36).padStart(13, '0');
}

interface StableStringifyContext {
  nextReferenceId: number;
  readonly seen: WeakMap<object, number>;
}

function createStableStringifyContext(): StableStringifyContext {
  return {
    nextReferenceId: 0,
    seen: new WeakMap<object, number>(),
  };
}

function enterStableObject(value: object, context: StableStringifyContext): number | undefined {
  const existingReferenceId = context.seen.get(value);

  if (existingReferenceId !== undefined) {
    return existingReferenceId;
  }

  context.nextReferenceId += 1;
  context.seen.set(value, context.nextReferenceId);

  return undefined;
}

function createCollectionSortContext(parent: object): StableStringifyContext {
  const context = createStableStringifyContext();
  context.nextReferenceId = 1;
  context.seen.set(parent, 1);

  return context;
}

function stableCollectionSortKey(value: unknown, parent: object): string {
  return stableStringify(value, createCollectionSortContext(parent));
}

function compareStableString(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function stableStringify(value: unknown, context: StableStringifyContext): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value !== 'object') {
    if (typeof value === 'bigint') {
      return `BigInt:${value.toString()}`;
    }

    return JSON.stringify(value) ?? String(value);
  }

  const circularReferenceId = enterStableObject(value, context);

  if (circularReferenceId !== undefined) {
    return `Circular:${circularReferenceId}`;
  }

  if (value instanceof ArrayBuffer) {
    const serialized = `ArrayBuffer:{byteLength:${value.byteLength},bytes:${stableByteArray(new Uint8Array(value))}}`;
    context.seen.delete(value);

    return serialized;
  }

  if (ArrayBuffer.isView(value)) {
    const serialized = `ArrayBufferView:{view:${JSON.stringify(Object.prototype.toString.call(value).slice(8, -1))},byteOffset:${value.byteOffset},byteLength:${value.byteLength},bytes:${stableByteArray(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))}}`;
    context.seen.delete(value);

    return serialized;
  }

  if (value instanceof Date) {
    const serialized = Number.isNaN(value.getTime()) ? 'Date:Invalid' : `Date:${JSON.stringify(value.toISOString())}`;
    context.seen.delete(value);

    return serialized;
  }

  if (value instanceof URL) {
    const serialized = `URL:${JSON.stringify(value.href)}`;
    context.seen.delete(value);

    return serialized;
  }

  if (value instanceof URLSearchParams) {
    const serialized = `URLSearchParams:${JSON.stringify(value.toString())}`;
    context.seen.delete(value);

    return serialized;
  }

  if (value instanceof RegExp) {
    const serialized = `RegExp:${JSON.stringify(value.source)}/${value.flags}`;
    context.seen.delete(value);

    return serialized;
  }

  if (value instanceof Map) {
    const entries = Array.from(value.entries())
      .map(([key, entry]) => ({
        entry,
        key,
        sortKey: `[${stableCollectionSortKey(key, value)},${stableCollectionSortKey(entry, value)}]`,
      }))
      .sort((left, right) => compareStableString(left.sortKey, right.sortKey))
      .map(({ key, entry }) => `[${stableStringify(key, context)},${stableStringify(entry, context)}]`);

    context.seen.delete(value);

    return `Map:{${entries.join(',')}}`;
  }

  if (value instanceof Set) {
    const entries = Array.from(value.values())
      .map((entry) => ({
        entry,
        sortKey: stableCollectionSortKey(entry, value),
      }))
      .sort((left, right) => compareStableString(left.sortKey, right.sortKey))
      .map(({ entry }) => stableStringify(entry, context));

    context.seen.delete(value);

    return `Set:[${entries.join(',')}]`;
  }

  if (Array.isArray(value)) {
    const serialized = `[${value.map((entry) => stableStringify(entry, context)).join(',')}]`;
    context.seen.delete(value);

    return serialized;
  }

  const prototype = Object.getPrototypeOf(value);
  const objectTag = prototype && prototype !== Object.prototype ? `${prototype.constructor?.name ?? 'Object'}:` : '';
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => compareStableString(left, right));

  const serialized = `${objectTag}{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry, context)}`).join(',')}}`;
  context.seen.delete(value);

  return serialized;
}

function stableByteArray(bytes: Uint8Array): string {
  return `[${Array.from(bytes).join(',')}]`;
}
