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
