import { describe, expect, it } from 'vitest';

import { createEmailPlatformStatusSnapshot } from './status.js';

describe('createEmailPlatformStatusSnapshot', () => {
  it('reports ready and healthy state for an initialized injected transport', () => {
    const snapshot = createEmailPlatformStatusSnapshot({
      channelName: 'email',
      defaultFromConfigured: true,
      lifecycleState: 'ready',
      ownsTransportResources: true,
      transportKind: 'resend-http',
      verifiedOnModuleInit: true,
    });

    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      channelName: 'email',
      dependencies: ['notifications.channel', 'email.transport'],
      transportKind: 'resend-http',
      verifiedOnModuleInit: true,
    });
    expect(snapshot.details).not.toHaveProperty('queueWorkerJobName');
  });

  it('marks failed transport startup as not-ready and unhealthy', () => {
    const snapshot = createEmailPlatformStatusSnapshot({
      channelName: 'email',
      defaultFromConfigured: false,
      lifecycleState: 'failed',
      ownsTransportResources: false,
      transportKind: 'custom-instance',
      verifiedOnModuleInit: false,
    });

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.health.status).toBe('unhealthy');
    expect(snapshot.ownership.externallyManaged).toBe(true);
  });

  it('surfaces queue metadata only when the caller provides it explicitly', () => {
    const snapshot = createEmailPlatformStatusSnapshot({
      channelName: 'email',
      defaultFromConfigured: true,
      lifecycleState: 'ready',
      ownsTransportResources: true,
      queueWorkerJobName: 'custom.email.queue.job',
      transportKind: 'resend-http',
      verifiedOnModuleInit: false,
    });

    expect(snapshot.details).toMatchObject({
      queueWorkerJobName: 'custom.email.queue.job',
      transportKind: 'resend-http',
    });
  });
});
