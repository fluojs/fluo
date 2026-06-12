import { Inject } from '@fluojs/core';

import {
  NotificationChannelNotFoundError,
  NotificationQueueNotConfiguredError,
} from './errors.js';
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
    const requestedPublicationError = await this.publishLifecycleEventBestEffort(
      'notification.dispatch.requested',
      notification,
      options,
    );

    if (this.shouldQueueSingleDispatch(options)) {
      try {
        this.requireChannel(notification.channel);
      } catch (error) {
        await this.publishFailureLifecycleEvent(notification, options, error, requestedPublicationError);
        throw error;
      }

      const job = this.createQueueJob(notification);
      try {
        const deliveryId = await this.requireQueueAdapter().enqueue(job);
        const result: NotificationDispatchResult = {
          channel: notification.channel,
          deliveryId: this.normalizeDeliveryId(deliveryId, notification),
          queued: true,
          status: 'queued',
        };

        await this.publishLifecycleEventBestEffort('notification.dispatch.queued', notification, options, result.deliveryId);

        return result;
      } catch (error) {
        await this.publishFailureLifecycleEvent(notification, options, error, requestedPublicationError);
        throw error;
      }
    }

    let channel: NotificationChannel;

    try {
      channel = this.requireChannel(notification.channel);
    } catch (error) {
      await this.publishFailureLifecycleEvent(notification, options, error, requestedPublicationError);
      throw error;
    }

    try {
      const delivery = await channel.send(notification, { signal: options.signal });
      const result: NotificationDispatchResult = {
        channel: notification.channel,
        deliveryId: this.normalizeDeliveryId(delivery.externalId, notification),
        metadata: delivery.metadata,
        queued: delivery.status === 'queued',
        status: delivery.status ?? 'delivered',
      };

      await this.publishLifecycleEventBestEffort(
        result.queued ? 'notification.dispatch.queued' : 'notification.dispatch.delivered',
        notification,
        options,
        result.deliveryId,
      );

      return result;
    } catch (error) {
      await this.publishFailureLifecycleEvent(notification, options, error, requestedPublicationError);
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

    if (this.shouldQueue(notifications.length, options)) {
      const requestedPublicationErrors = await this.publishRequestedLifecycleEvents(notifications, options);

      let queue: ReturnType<NotificationsService['requireQueueAdapter']>;

      try {
        queue = this.requireQueueAdapter();
      } catch (error) {
        await this.publishFailureLifecycleEvents(notifications, options, error, requestedPublicationErrors);
        throw error;
      }

      try {
        for (const notification of notifications) {
          this.requireChannel(notification.channel);
        }
      } catch (error) {
        await this.publishFailureLifecycleEvents(notifications, options, error, requestedPublicationErrors);
        throw error;
      }

      const jobs = notifications.map((notification) => this.createQueueJob(notification));

      if (!queue.enqueueMany) {
        return this.dispatchManyThroughSequentialQueueFallback(notifications, jobs, options, requestedPublicationErrors);
      }

      let ids: readonly string[];

      try {
        ids = validateQueueBatchDeliveryIds(await queue.enqueueMany(jobs), jobs.length);
      } catch (error) {
        await this.publishFailureLifecycleEvents(notifications, options, error, requestedPublicationErrors);
        throw error;
      }

      const results = notifications.map((notification, index) => ({
        channel: notification.channel,
        deliveryId: this.normalizeDeliveryId(ids[index], notification),
        queued: true,
        status: 'queued' as const,
      }));

      for (let index = 0; index < notifications.length; index += 1) {
        const notification = notifications[index];
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

    for (const notification of notifications) {
      try {
        results.push(await this.dispatch(notification, options));
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

    const event: NotificationLifecycleEvent<TRequest> = {
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
    };

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
        const deliveryId = this.normalizeDeliveryId(await queue.enqueue(job), notification);
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
    throw createQueueBatchResultIntegrityError(`expected ${expectedCount} queue ids but received a non-array result`);
  }

  if (value.length !== expectedCount) {
    throw createQueueBatchResultIntegrityError(`expected ${expectedCount} queue ids but received ${value.length}`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw createQueueBatchResultIntegrityError(`queue id at index ${index} must be a non-empty string`);
    }

    return entry;
  });
}

function createQueueBatchResultIntegrityError(message: string): Error {
  const error = new Error(`Notifications queue adapter returned an invalid enqueueMany() result: ${message}.`);
  error.name = 'NotificationQueueResultIntegrityError';

  return error;
}

function createLifecyclePublicationFailureError(dispatchError: unknown, ...publicationErrors: unknown[]): AggregateError {
  const primaryMessage = dispatchError instanceof Error ? dispatchError.message : 'Notification dispatch failed.';

  return new AggregateError(
    [dispatchError, ...publicationErrors],
    `Notification dispatch failed, and failed lifecycle event publication also failed: ${primaryMessage}`,
  );
}

function stableNotificationHash(notification: NotificationDispatchRequest): string {
  let hash = 0x811c9dc5;
  const input = stableStringify(notification);

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(36).padStart(7, '0');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? String(value);
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Date:Invalid' : `Date:${JSON.stringify(value.toISOString())}`;
  }

  if (value instanceof URL) {
    return `URL:${JSON.stringify(value.href)}`;
  }

  if (value instanceof RegExp) {
    return `RegExp:${JSON.stringify(value.source)}/${value.flags}`;
  }

  if (value instanceof Map) {
    const entries = Array.from(value.entries())
      .map(([key, entry]) => `[${stableStringify(key)},${stableStringify(entry)}]`)
      .sort();

    return `Map:{${entries.join(',')}}`;
  }

  if (value instanceof Set) {
    const entries = Array.from(value.values())
      .map((entry) => stableStringify(entry))
      .sort();

    return `Set:[${entries.join(',')}]`;
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  const objectTag = prototype && prototype !== Object.prototype ? `${prototype.constructor?.name ?? 'Object'}:` : '';
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `${objectTag}{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}
