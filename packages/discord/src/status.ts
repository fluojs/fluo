import type { PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@fluojs/runtime';

/** Resolved Discord lifecycle state used for diagnostics and health checks. */
export type DiscordLifecycleState = 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

/** Input required to describe the package health/readiness contract. */
export interface DiscordStatusAdapterInput {
  channelName: string;
  defaultThreadConfigured: boolean;
  lifecycleState: DiscordLifecycleState;
  ownsTransportResources: boolean;
  transportKind: string;
  verifiedOnModuleInit: boolean;
}

/** Structured snapshot returned by {@link createDiscordPlatformStatusSnapshot}. */
export interface DiscordPlatformStatusSnapshot {
  details: Record<string, unknown>;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  readiness: PlatformReadinessReport;
}

function createReadiness(input: DiscordStatusAdapterInput): PlatformReadinessReport {
  if (input.lifecycleState === 'ready') {
    return {
      critical: true,
      status: 'ready',
    };
  }

  if (input.lifecycleState === 'starting') {
    return {
      critical: true,
      reason: 'Discord transport is still starting.',
      status: 'degraded',
    };
  }

  if (input.lifecycleState === 'stopping' || input.lifecycleState === 'stopped') {
    return {
      critical: true,
      reason: 'Discord transport is shutting down or already stopped.',
      status: 'not-ready',
    };
  }

  if (input.lifecycleState === 'failed') {
    return {
      critical: true,
      reason: 'Discord transport failed to initialize.',
      status: 'not-ready',
    };
  }

  return {
    critical: true,
    reason: 'Discord transport has not started yet.',
    status: 'not-ready',
  };
}

function createHealth(input: DiscordStatusAdapterInput): PlatformHealthReport {
  if (input.lifecycleState === 'failed' || input.lifecycleState === 'stopped') {
    return {
      reason: 'Discord transport is unavailable.',
      status: 'unhealthy',
    };
  }

  if (input.lifecycleState === 'created' || input.lifecycleState === 'starting' || input.lifecycleState === 'stopping') {
    return {
      reason: 'Discord transport is transitioning lifecycle state.',
      status: 'degraded',
    };
  }

  return {
    status: 'healthy',
  };
}

/**
 * Creates a health/readiness snapshot for the Discord delivery layer.
 *
 * @param input Lifecycle and ownership details derived from the active Discord module wiring.
 * @returns A structured snapshot suitable for status endpoints and operational diagnostics.
 */
export function createDiscordPlatformStatusSnapshot(input: DiscordStatusAdapterInput): DiscordPlatformStatusSnapshot {
  return {
    details: {
      channelName: input.channelName,
      defaultThreadConfigured: input.defaultThreadConfigured,
      dependencies: ['notifications.channel', 'discord.transport'],
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
