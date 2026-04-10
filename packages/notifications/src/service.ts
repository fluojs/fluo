import { Inject } from '@konekti/core';

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
  private fallbackDeliveryIdSequence = 0;

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
    await this.publishLifecycleEventSafely('notification.dispatch.requested', notification, options);

    if (this.shouldQueueSingleDispatch(options)) {
      this.requireChannel(notification.channel);
      const job = this.createQueueJob(notification);
      const deliveryId = await this.requireQueueAdapter().enqueue(job);
      const result: NotificationDispatchResult = {
        channel: notification.channel,
        deliveryId: this.normalizeDeliveryId(deliveryId, notification),
        queued: true,
        status: 'queued',
      };

      await this.publishLifecycleEventSafely('notification.dispatch.queued', notification, options, result.deliveryId);

      return result;
    }

    const channel = this.requireChannel(notification.channel);

    try {
      const delivery = await channel.send(notification, { signal: options.signal });
      const result: NotificationDispatchResult = {
        channel: notification.channel,
        deliveryId: this.normalizeDeliveryId(delivery.externalId, notification),
        metadata: delivery.metadata,
        queued: delivery.status === 'queued',
        status: delivery.status ?? 'delivered',
      };

      await this.publishLifecycleEventSafely(
        result.queued ? 'notification.dispatch.queued' : 'notification.dispatch.delivered',
        notification,
        options,
        result.deliveryId,
      );

      return result;
    } catch (error) {
      await this.publishLifecycleEventSafely('notification.dispatch.failed', notification, options, undefined, error);
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
      const queue = this.requireQueueAdapter();
      for (const notification of notifications) {
        this.requireChannel(notification.channel);
      }
      const jobs = notifications.map((notification) => this.createQueueJob(notification));

      for (const notification of notifications) {
        await this.publishLifecycleEventSafely('notification.dispatch.requested', notification, options);
      }

      const ids = queue.enqueueMany
        ? await queue.enqueueMany(jobs)
        : await Promise.all(jobs.map((job) => queue.enqueue(job)));

      const results = notifications.map((notification, index) => ({
        channel: notification.channel,
        deliveryId: this.normalizeDeliveryId(ids[index], notification),
        queued: true,
        status: 'queued' as const,
      }));

      for (let index = 0; index < notifications.length; index += 1) {
        const notification = notifications[index];
        await this.publishLifecycleEventSafely('notification.dispatch.queued', notification, options, results[index]?.deliveryId);
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
      notification,
      queuedAt: new Date().toISOString(),
    };
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

    this.fallbackDeliveryIdSequence = (this.fallbackDeliveryIdSequence + 1) % Number.MAX_SAFE_INTEGER;

    return `${fallback.channel}:${Date.now().toString(36)}:${this.fallbackDeliveryIdSequence.toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
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

  private async publishLifecycleEventSafely<TRequest extends NotificationDispatchRequest>(
    name: NotificationLifecycleEvent['name'],
    notification: TRequest,
    options: NotificationDispatchOptions,
    deliveryId?: string,
    error?: unknown,
  ): Promise<void> {
    try {
      await this.publishLifecycleEvent(name, notification, options, deliveryId, error);
    } catch {
      return;
    }
  }
}
