import type { PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@konekti/runtime';

/** Resolved email lifecycle state used for diagnostics and health checks. */
export type EmailLifecycleState = 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

/** Input required to describe the package health/readiness contract. */
export interface EmailStatusAdapterInput {
  channelName: string;
  defaultFromConfigured: boolean;
  lifecycleState: EmailLifecycleState;
  ownsTransportResources: boolean;
  queueWorkerJobName: string;
  transportKind: string;
  verifiedOnModuleInit: boolean;
}

/** Structured snapshot returned by {@link createEmailPlatformStatusSnapshot}. */
export interface EmailPlatformStatusSnapshot {
  details: Record<string, unknown>;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  readiness: PlatformReadinessReport;
}

function createReadiness(input: EmailStatusAdapterInput): PlatformReadinessReport {
  if (input.lifecycleState === 'ready') {
    return {
      critical: true,
      status: 'ready',
    };
  }

  if (input.lifecycleState === 'starting') {
    return {
      critical: true,
      reason: 'Email transport is still starting.',
      status: 'degraded',
    };
  }

  if (input.lifecycleState === 'stopping' || input.lifecycleState === 'stopped') {
    return {
      critical: true,
      reason: 'Email transport is shutting down or already stopped.',
      status: 'not-ready',
    };
  }

  if (input.lifecycleState === 'failed') {
    return {
      critical: true,
      reason: 'Email transport failed to initialize.',
      status: 'not-ready',
    };
  }

  return {
    critical: true,
    reason: 'Email transport has not started yet.',
    status: 'not-ready',
  };
}

function createHealth(input: EmailStatusAdapterInput): PlatformHealthReport {
  if (input.lifecycleState === 'failed' || input.lifecycleState === 'stopped') {
    return {
      reason: 'Email transport is unavailable.',
      status: 'unhealthy',
    };
  }

  if (input.lifecycleState === 'created' || input.lifecycleState === 'starting' || input.lifecycleState === 'stopping') {
    return {
      reason: 'Email transport is transitioning lifecycle state.',
      status: 'degraded',
    };
  }

  return {
    status: 'healthy',
  };
}

/**
 * Creates a health/readiness snapshot for the email delivery layer.
 *
 * @param input Lifecycle and ownership details derived from the active email module wiring.
 * @returns A structured snapshot suitable for status endpoints and operational diagnostics.
 */
export function createEmailPlatformStatusSnapshot(input: EmailStatusAdapterInput): EmailPlatformStatusSnapshot {
  return {
    details: {
      channelName: input.channelName,
      defaultFromConfigured: input.defaultFromConfigured,
      dependencies: ['notifications.channel', 'email.transport'],
      lifecycleState: input.lifecycleState,
      queueWorkerJobName: input.queueWorkerJobName,
      transportKind: input.transportKind,
      verifiedOnModuleInit: input.verifiedOnModuleInit,
    },
    health: createHealth(input),
    ownership: {
      externallyManaged: !input.ownsTransportResources,
      ownsResources: input.ownsTransportResources,
    },
    readiness: createReadiness(input),
  };
}
