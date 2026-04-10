import type { PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@fluojs/runtime';

/** Resolved notification runtime mode used for diagnostics. */
export type NotificationsOperationMode =
  | 'direct-only'
  | 'direct-with-events'
  | 'queue-backed'
  | 'queue-backed-with-events'
  | 'unconfigured';

/** Input required to describe the package health/readiness contract. */
export interface NotificationsStatusAdapterInput {
  bulkQueueThreshold: number;
  channelsRegistered: number;
  eventPublisherConfigured: boolean;
  queueConfigured: boolean;
}

/** Structured snapshot returned by {@link createNotificationsPlatformStatusSnapshot}. */
export interface NotificationsPlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  details: Record<string, unknown>;
}

function resolveOperationMode(input: NotificationsStatusAdapterInput): NotificationsOperationMode {
  if (input.channelsRegistered === 0 && !input.queueConfigured && !input.eventPublisherConfigured) {
    return 'unconfigured';
  }

  if (input.queueConfigured && input.eventPublisherConfigured) {
    return 'queue-backed-with-events';
  }

  if (input.queueConfigured) {
    return 'queue-backed';
  }

  if (input.eventPublisherConfigured) {
    return 'direct-with-events';
  }

  return 'direct-only';
}

function createReadiness(input: NotificationsStatusAdapterInput): PlatformReadinessReport {
  if (input.channelsRegistered > 0) {
    return {
      critical: true,
      status: 'ready',
    };
  }

  return {
    critical: true,
    reason: 'No notification channels are registered.',
    status: 'not-ready',
  };
}

function createHealth(input: NotificationsStatusAdapterInput): PlatformHealthReport {
  if (input.channelsRegistered > 0) {
    return {
      status: 'healthy',
    };
  }

  if (input.queueConfigured || input.eventPublisherConfigured) {
    return {
      reason: 'Notifications infrastructure is configured, but no delivery channels are registered yet.',
      status: 'degraded',
    };
  }

  return {
    reason: 'Notifications module has no registered channels or optional integrations.',
    status: 'unhealthy',
  };
}

/**
 * Creates a health/readiness snapshot for the notifications orchestration layer.
 *
 * @param input Registered-channel and optional-integration counts derived from the active module wiring.
 * @returns A structured snapshot suitable for status endpoints and operational diagnostics.
 */
export function createNotificationsPlatformStatusSnapshot(
  input: NotificationsStatusAdapterInput,
): NotificationsPlatformStatusSnapshot {
  return {
    details: {
      bulkQueueThreshold: input.bulkQueueThreshold,
      channelsRegistered: input.channelsRegistered,
      dependencies: [
        ...(input.queueConfigured ? ['notifications.queue-adapter'] : []),
        ...(input.eventPublisherConfigured ? ['notifications.event-publisher'] : []),
      ],
      eventPublisherConfigured: input.eventPublisherConfigured,
      operationMode: resolveOperationMode(input),
      queueConfigured: input.queueConfigured,
    },
    health: createHealth(input),
    ownership: {
      externallyManaged: input.queueConfigured || input.eventPublisherConfigured,
      ownsResources: false,
    },
    readiness: createReadiness(input),
  };
}
