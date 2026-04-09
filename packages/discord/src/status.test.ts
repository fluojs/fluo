import { describe, expect, it } from 'vitest';

import { createDiscordPlatformStatusSnapshot } from './status.js';

describe('createDiscordPlatformStatusSnapshot', () => {
  it('reports ready and healthy state for an initialized injected transport', () => {
    const snapshot = createDiscordPlatformStatusSnapshot({
      channelName: 'discord',
      defaultThreadConfigured: true,
      lifecycleState: 'ready',
      ownsTransportResources: true,
      transportKind: 'discord-webhook',
      verifiedOnModuleInit: true,
    });

    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      channelName: 'discord',
      defaultThreadConfigured: true,
      dependencies: ['notifications.channel', 'discord.transport'],
      transportKind: 'discord-webhook',
      verifiedOnModuleInit: true,
    });
  });

  it('marks failed transport startup as not-ready and unhealthy', () => {
    const snapshot = createDiscordPlatformStatusSnapshot({
      channelName: 'discord',
      defaultThreadConfigured: false,
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
