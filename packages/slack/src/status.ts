import type { PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@konekti/runtime';

/** Resolved Slack lifecycle state used for diagnostics and health checks. */
export type SlackLifecycleState = 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

/** Input required to describe the package health/readiness contract. */
export interface SlackStatusAdapterInput {
  channelName: string;
  defaultChannelConfigured: boolean;
  lifecycleState: SlackLifecycleState;
  ownsTransportResources: boolean;
  transportKind: string;
  verifiedOnModuleInit: boolean;
}

/** Structured snapshot returned by {@link createSlackPlatformStatusSnapshot}. */
export interface SlackPlatformStatusSnapshot {
  details: Record<string, unknown>;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  readiness: PlatformReadinessReport;
}

function createReadiness(input: SlackStatusAdapterInput): PlatformReadinessReport {
  if (input.lifecycleState === 'ready') {
    return {
      critical: true,
      status: 'ready',
    };
  }

  if (input.lifecycleState === 'starting') {
    return {
      critical: true,
      reason: 'Slack transport is still starting.',
      status: 'degraded',
    };
  }

  if (input.lifecycleState === 'stopping' || input.lifecycleState === 'stopped') {
    return {
      critical: true,
      reason: 'Slack transport is shutting down or already stopped.',
      status: 'not-ready',
    };
  }

  if (input.lifecycleState === 'failed') {
    return {
      critical: true,
      reason: 'Slack transport failed to initialize.',
      status: 'not-ready',
    };
  }

  return {
    critical: true,
    reason: 'Slack transport has not started yet.',
    status: 'not-ready',
  };
}

function createHealth(input: SlackStatusAdapterInput): PlatformHealthReport {
  if (input.lifecycleState === 'failed' || input.lifecycleState === 'stopped') {
    return {
      reason: 'Slack transport is unavailable.',
      status: 'unhealthy',
    };
  }

  if (input.lifecycleState === 'created' || input.lifecycleState === 'starting' || input.lifecycleState === 'stopping') {
    return {
      reason: 'Slack transport is transitioning lifecycle state.',
      status: 'degraded',
    };
  }

  return {
    status: 'healthy',
  };
}

/**
 * Creates a health/readiness snapshot for the Slack delivery layer.
 *
 * @param input Lifecycle and ownership details derived from the active Slack module wiring.
 * @returns A structured snapshot suitable for status endpoints and operational diagnostics.
 */
export function createSlackPlatformStatusSnapshot(input: SlackStatusAdapterInput): SlackPlatformStatusSnapshot {
  return {
    details: {
      channelName: input.channelName,
      defaultChannelConfigured: input.defaultChannelConfigured,
      dependencies: ['notifications.channel', 'slack.transport'],
      lifecycleState: input.lifecycleState,
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
