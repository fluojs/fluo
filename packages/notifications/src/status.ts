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
  /**
   * Whether lifecycle publication is enabled for the configured publisher. Defaults to
   * `eventPublisherConfigured` when omitted so callers that only know about configuration keep
   * their previous diagnostics.
   */
  eventPublicationEnabled?: boolean;
  eventPublisherConfigured: boolean;
  queueConfigured: boolean;
}

/**
 * Typed diagnostics published under {@link NotificationsPlatformStatusSnapshot.details}.
 *
 * The index signature keeps the shape assignable to `Record<string, unknown>` consumers while the
 * named members give typed access to the documented diagnostics.
 */
export interface NotificationsStatusDetails {
  bulkQueueThreshold: number;
  channelsRegistered: number;
  dependencies: readonly string[];
  /** Whether a configured publisher is actually publishing lifecycle events. */
  eventPublicationEnabled: boolean;
  /** Whether an event publisher is wired, regardless of publication enablement. */
  eventPublisherConfigured: boolean;
  operationMode: NotificationsOperationMode;
  queueConfigured: boolean;
  [detail: string]: unknown;
}

/** Structured snapshot returned by {@link createNotificationsPlatformStatusSnapshot}. */
export interface NotificationsPlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  details: NotificationsStatusDetails;
}

interface ResolvedNotificationsStatusInput {
  bulkQueueThreshold: number;
  channelsRegistered: number;
  eventPublicationEnabled: boolean;
  eventPublisherConfigured: boolean;
  queueConfigured: boolean;
}

function resolveStatusInput(input: NotificationsStatusAdapterInput): ResolvedNotificationsStatusInput {
  return {
    bulkQueueThreshold: input.bulkQueueThreshold,
    channelsRegistered: input.channelsRegistered,
    eventPublicationEnabled:
      input.eventPublisherConfigured && (input.eventPublicationEnabled ?? true),
    eventPublisherConfigured: input.eventPublisherConfigured,
    queueConfigured: input.queueConfigured,
  };
}

function resolveOperationMode(input: ResolvedNotificationsStatusInput): NotificationsOperationMode {
  if (input.channelsRegistered === 0 && !input.queueConfigured && !input.eventPublicationEnabled) {
    return 'unconfigured';
  }

  if (input.queueConfigured && input.eventPublicationEnabled) {
    return 'queue-backed-with-events';
  }

  if (input.queueConfigured) {
    return 'queue-backed';
  }

  if (input.eventPublicationEnabled) {
    return 'direct-with-events';
  }

  return 'direct-only';
}

function createReadiness(input: ResolvedNotificationsStatusInput): PlatformReadinessReport {
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

function createHealth(input: ResolvedNotificationsStatusInput): PlatformHealthReport {
  if (input.channelsRegistered > 0) {
    return {
      status: 'healthy',
    };
  }

  if (input.queueConfigured || input.eventPublicationEnabled) {
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
 * Publisher configuration and lifecycle publication enablement are reported separately:
 * `details.eventPublisherConfigured` records the wiring while `details.eventPublicationEnabled`
 * records whether events are actually published. Operation mode, active dependencies, and external
 * ownership are derived from enablement so a configured-but-disabled publisher is never reported as
 * an active event-backed runtime.
 *
 * @param input Registered-channel and optional-integration state derived from the active module wiring.
 * @returns A structured snapshot suitable for status endpoints and operational diagnostics.
 */
export function createNotificationsPlatformStatusSnapshot(
  input: NotificationsStatusAdapterInput,
): NotificationsPlatformStatusSnapshot {
  const resolved = resolveStatusInput(input);

  return {
    details: {
      bulkQueueThreshold: resolved.bulkQueueThreshold,
      channelsRegistered: resolved.channelsRegistered,
      dependencies: [
        ...(resolved.queueConfigured ? ['notifications.queue-adapter'] : []),
        ...(resolved.eventPublicationEnabled ? ['notifications.event-publisher'] : []),
      ],
      eventPublicationEnabled: resolved.eventPublicationEnabled,
      eventPublisherConfigured: resolved.eventPublisherConfigured,
      operationMode: resolveOperationMode(resolved),
      queueConfigured: resolved.queueConfigured,
    },
    health: createHealth(resolved),
    ownership: {
      externallyManaged: resolved.queueConfigured || resolved.eventPublicationEnabled,
      ownsResources: false,
    },
    readiness: createReadiness(resolved),
  };
}
