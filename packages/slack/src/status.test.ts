import { describe, expect, it } from 'vitest';

import { createSlackPlatformStatusSnapshot } from './status.js';

describe('createSlackPlatformStatusSnapshot', () => {
  it('reports ready and healthy state for an initialized injected transport', () => {
    const snapshot = createSlackPlatformStatusSnapshot({
      channelName: 'slack',
      defaultChannelConfigured: true,
      lifecycleState: 'ready',
      ownsTransportResources: true,
      transportKind: 'slack-webhook',
      verifiedOnModuleInit: true,
    });

    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      channelName: 'slack',
      defaultChannelConfigured: true,
      dependencies: ['notifications.channel', 'slack.transport'],
      transportKind: 'slack-webhook',
      verifiedOnModuleInit: true,
    });
  });

  it('marks failed transport startup as not-ready and unhealthy', () => {
    const snapshot = createSlackPlatformStatusSnapshot({
      channelName: 'slack',
      defaultChannelConfigured: false,
      lifecycleState: 'failed',
      ownsTransportResources: false,
      transportKind: 'custom-instance',
      verifiedOnModuleInit: false,
    });

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.health.status).toBe('unhealthy');
    expect(snapshot.ownership.externallyManaged).toBe(true);
  });
});
