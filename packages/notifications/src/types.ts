import type { AsyncModuleOptions } from '@fluojs/core';

/** Opaque payload shape carried through the shared notification contract. */
export type NotificationPayload = Record<string, unknown>;

/**
 * Shared request envelope that leaf notification packages must understand.
 *
 * @typeParam TPayload Channel-specific payload shape supplied by the caller.
 */
export interface NotificationDispatchRequest<TPayload extends NotificationPayload = NotificationPayload> {
  channel: string;
  id?: string;
  locale?: string;
  metadata?: Record<string, unknown>;
  payload: TPayload;
  recipients?: readonly string[];
  subject?: string;
  template?: string;
}

/** Delivery statuses emitted by direct and queue-backed notification workflows. */
export type NotificationDispatchStatus = 'delivered' | 'queued';

/**
 * Channel-level delivery response returned by one concrete notification implementation.
 *
 * @typeParam TReceipt Provider-specific receipt or transport response shape.
 */
export interface NotificationChannelDelivery<TReceipt = unknown> {
  externalId?: string;
  metadata?: Record<string, unknown>;
  receipt?: TReceipt;
  status?: NotificationDispatchStatus;
}

/** Context object passed to one registered notification channel. */
export interface NotificationChannelContext {
  signal?: AbortSignal;
}

/**
 * Stable contract that downstream channel packages (email, Slack, Discord, etc.) implement.
 *
 * @typeParam TRequest Shared request envelope subtype accepted by the channel implementation.
 * @typeParam TReceipt Provider-specific delivery receipt returned by the channel.
 */
export interface NotificationChannel<
  TRequest extends NotificationDispatchRequest = NotificationDispatchRequest,
  TReceipt = unknown,
> {
  channel: string;
  /**
   * Sends one notification through the concrete channel implementation.
   *
   * @param notification Shared request envelope received from the notifications foundation package.
   * @param context Optional dispatch-time context, including abort propagation.
   * @returns Provider-specific delivery details normalized into the shared contract.
   */
  send(notification: TRequest, context: NotificationChannelContext): Promise<NotificationChannelDelivery<TReceipt>>;
}

/** Job payload forwarded to an optional queue adapter for deferred delivery. */
export interface NotificationsQueueJob<TRequest extends NotificationDispatchRequest = NotificationDispatchRequest> {
  channel: string;
  notification: TRequest;
  queuedAt: string;
}

/**
 * Queue seam used when applications prefer background delivery for bulk notifications.
 *
 * @remarks
 * The foundation package intentionally depends on this abstract contract instead of
 * a concrete `@fluojs/queue` type so that queue-backed delivery remains optional.
 */
export interface NotificationsQueueAdapter {
  /**
   * Enqueues one notification delivery job.
   *
   * @param job Serialized notification envelope ready for background processing.
   * @returns A queue-assigned identifier that can be surfaced to callers.
   */
  enqueue(job: NotificationsQueueJob): Promise<string>;

  /**
   * Enqueues multiple notification delivery jobs in one operation when supported.
   *
   * @param jobs Ordered notification envelopes to enqueue.
   * @returns Ordered queue identifiers aligned with the input order.
   */
  enqueueMany?(jobs: readonly NotificationsQueueJob[]): Promise<readonly string[]>;
}

/** Lifecycle event names emitted through the optional event publication seam. */
export type NotificationLifecycleEventName =
  | 'notification.dispatch.requested'
  | 'notification.dispatch.queued'
  | 'notification.dispatch.delivered'
  | 'notification.dispatch.failed';

/** Published event payload emitted around notification lifecycle transitions. */
export interface NotificationLifecycleEvent<TRequest extends NotificationDispatchRequest = NotificationDispatchRequest> {
  channel: string;
  deliveryId?: string;
  error?: {
    message: string;
    name: string;
  };
  name: NotificationLifecycleEventName;
  notification: TRequest;
  occurredAt: string;
}

/** Optional event publication seam for notification lifecycle visibility. */
export interface NotificationsEventPublisher {
  /**
   * Publishes one notification lifecycle event.
   *
   * @param event Lifecycle event describing a requested, queued, delivered, or failed dispatch step.
   * @returns A promise that resolves once the caller-visible publication completes.
   */
  publish(event: NotificationLifecycleEvent): Promise<void>;
}

/** Queue configuration for optional bulk-delivery offloading. */
export interface NotificationsQueueOptions {
  adapter: NotificationsQueueAdapter;
  bulkThreshold?: number;
}

/** Optional lifecycle publication configuration. */
export interface NotificationsEventsOptions {
  publisher: NotificationsEventPublisher;
  publishLifecycleEvents?: boolean;
}

/** Module options accepted by {@link NotificationsModule.forRoot} and `forRootAsync`. */
export interface NotificationsModuleOptions {
  channels?: readonly NotificationChannel[];
  events?: NotificationsEventsOptions;
  queue?: NotificationsQueueOptions;
}

/** Normalized module options resolved once during module registration. */
export interface NormalizedNotificationsModuleOptions {
  channels: readonly NotificationChannel[];
  events?: {
    publishLifecycleEvents: boolean;
    publisher: NotificationsEventPublisher;
  };
  queue?: {
    adapter: NotificationsQueueAdapter;
    bulkThreshold: number;
  };
}

/** Runtime dispatch controls applied to one notification call. */
export interface NotificationDispatchOptions {
  publishLifecycleEvents?: boolean;
  queue?: boolean;
  signal?: AbortSignal;
}

/** Additional controls for one bulk dispatch invocation. */
export interface NotificationDispatchManyOptions extends NotificationDispatchOptions {
  continueOnError?: boolean;
}

/** Caller-visible normalized result for one dispatched notification. */
export interface NotificationDispatchResult {
  channel: string;
  deliveryId: string;
  metadata?: Record<string, unknown>;
  queued: boolean;
  status: NotificationDispatchStatus;
}

/** Failure record returned by tolerant bulk dispatch operations. */
export interface NotificationDispatchFailure<TRequest extends NotificationDispatchRequest = NotificationDispatchRequest> {
  error: Error;
  notification: TRequest;
}

/** Summary returned by {@link NotificationsService.dispatchMany}. */
export interface NotificationDispatchBatchResult<TRequest extends NotificationDispatchRequest = NotificationDispatchRequest> {
  failed: number;
  failures: readonly NotificationDispatchFailure<TRequest>[];
  queued: number;
  results: readonly NotificationDispatchResult[];
  succeeded: number;
}

/** Facade exposed to application code and the compatibility token. */
export interface Notifications {
  /**
   * Dispatches one notification to a registered channel or the optional queue seam.
   *
   * @typeParam TRequest Shared notification request envelope subtype.
   * @param notification Request envelope identifying the channel and opaque payload.
   * @param options Optional abort, queue, and lifecycle-publication controls.
   * @returns A normalized dispatch result describing whether the delivery was queued or completed directly.
   */
  dispatch<TRequest extends NotificationDispatchRequest>(
    notification: TRequest,
    options?: NotificationDispatchOptions,
  ): Promise<NotificationDispatchResult>;

  /**
   * Dispatches multiple notifications in input order with optional tolerant error handling.
   *
   * @typeParam TRequest Shared notification request envelope subtype.
   * @param notifications Ordered notification envelopes to send or enqueue.
   * @param options Optional queue preference and bulk error-handling controls.
   * @returns A batch summary containing normalized results and any captured failures.
   */
  dispatchMany<TRequest extends NotificationDispatchRequest>(
    notifications: readonly TRequest[],
    options?: NotificationDispatchManyOptions,
  ): Promise<NotificationDispatchBatchResult<TRequest>>;
}

/** Async registration options for notifications modules that derive config through DI. */
export type NotificationsAsyncModuleOptions = AsyncModuleOptions<NotificationsModuleOptions>;
