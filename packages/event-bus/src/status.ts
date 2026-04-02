import type { PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@konekti/runtime';

export type EventBusLifecycleState = 'created' | 'discovering' | 'ready' | 'stopping' | 'stopped' | 'failed';

export interface EventBusStatusAdapterInput {
  handlersDiscovered: number;
  lifecycleState: EventBusLifecycleState;
  subscribedChannels: number;
  transportCloseFailures: number;
  transportConfigured: boolean;
  transportPublishFailures: number;
  transportSubscribeFailures: number;
  waitForHandlersDefault: boolean;
}

export interface EventBusPlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  details: Record<string, unknown>;
}

function createReadiness(input: EventBusStatusAdapterInput): PlatformReadinessReport {
  if (input.lifecycleState === 'ready' && input.transportSubscribeFailures === 0) {
    return {
      critical: true,
      status: 'ready',
    };
  }

  if (input.lifecycleState === 'ready' && input.transportSubscribeFailures > 0) {
    return {
      critical: true,
      reason: 'Event bus transport subscription is partially degraded.',
      status: 'degraded',
    };
  }

  if (input.lifecycleState === 'discovering') {
    return {
      critical: true,
      reason: 'Event handlers are still being discovered.',
      status: 'degraded',
    };
  }

  if (input.lifecycleState === 'stopping') {
    return {
      critical: true,
      reason: 'Event bus is shutting down.',
      status: 'not-ready',
    };
  }

  if (input.lifecycleState === 'stopped') {
    return {
      critical: true,
      reason: 'Event bus is stopped.',
      status: 'not-ready',
    };
  }

  if (input.lifecycleState === 'failed') {
    return {
      critical: true,
      reason: 'Event bus failed to complete startup or shutdown.',
      status: 'not-ready',
    };
  }

  return {
    critical: true,
    reason: 'Event bus has not completed discovery yet.',
    status: 'not-ready',
  };
}

function createHealth(input: EventBusStatusAdapterInput): PlatformHealthReport {
  if (input.lifecycleState === 'failed' || input.lifecycleState === 'stopped') {
    return {
      reason: 'Event bus transport lifecycle is not active.',
      status: 'unhealthy',
    };
  }

  if (input.lifecycleState === 'discovering' || input.lifecycleState === 'stopping') {
    return {
      reason: 'Event bus is transitioning lifecycle state.',
      status: 'degraded',
    };
  }

  if (input.transportPublishFailures > 0 || input.transportSubscribeFailures > 0 || input.transportCloseFailures > 0) {
    return {
      reason: 'Event bus transport reported recoverable runtime failures.',
      status: 'degraded',
    };
  }

  return {
    status: 'healthy',
  };
}

function resolveOperationMode(input: EventBusStatusAdapterInput): 'local-only' | 'transport-backed' {
  return input.transportConfigured ? 'transport-backed' : 'local-only';
}

export function createEventBusPlatformStatusSnapshot(input: EventBusStatusAdapterInput): EventBusPlatformStatusSnapshot {
  return {
    details: {
      dependencies: input.transportConfigured ? ['transport.external'] : [],
      handlersDiscovered: input.handlersDiscovered,
      lifecycleState: input.lifecycleState,
      operationMode: resolveOperationMode(input),
      subscribedChannels: input.subscribedChannels,
      transportCloseFailures: input.transportCloseFailures,
      transportConfigured: input.transportConfigured,
      transportPublishFailures: input.transportPublishFailures,
      transportSubscribeFailures: input.transportSubscribeFailures,
      waitForHandlersDefault: input.waitForHandlersDefault,
    },
    health: createHealth(input),
    ownership: {
      externallyManaged: input.transportConfigured,
      ownsResources: false,
    },
    readiness: createReadiness(input),
  };
}
