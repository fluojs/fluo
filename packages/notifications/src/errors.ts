/**
 * Base error type for caller-visible notification module configuration failures.
 */
export class NotificationsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationsConfigurationError';
  }
}

/**
 * Thrown when a notification references a channel that is not registered.
 */
export class NotificationChannelNotFoundError extends Error {
  constructor(readonly channel: string) {
    super(`No notification channel is registered for "${channel}".`);
    this.name = 'NotificationChannelNotFoundError';
  }
}

/**
 * Thrown when queue-backed delivery is requested without a configured queue adapter.
 */
export class NotificationQueueNotConfiguredError extends Error {
  constructor() {
    super('Queue-backed notification delivery requires a configured queue adapter.');
    this.name = 'NotificationQueueNotConfiguredError';
  }
}

/**
 * Thrown when a queue adapter returns an invalid queue-assigned delivery identifier.
 */
export class NotificationQueueResultIntegrityError extends Error {
  constructor(
    readonly operation: 'enqueue' | 'enqueueMany',
    message: string,
  ) {
    super(`Notifications queue adapter returned an invalid ${operation}() result: ${message}.`);
    this.name = 'NotificationQueueResultIntegrityError';
  }
}
