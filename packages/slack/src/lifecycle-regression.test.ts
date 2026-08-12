import { type Constructor, getModuleMetadata } from '@fluojs/core';
import { Container, type Provider } from '@fluojs/di';
import { describe, expect, it, vi } from 'vitest';

import { SlackModule } from './module.js';
import { SlackService } from './service.js';
import type { SlackTransport } from './types.js';

function moduleProviders(moduleType: Constructor): Provider[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.providers)) {
    throw new Error('SlackModule did not register providers metadata.');
  }

  return metadata.providers as Provider[];
}

async function resolveService(moduleType: Constructor): Promise<SlackService> {
  const container = new Container();
  container.register(...moduleProviders(moduleType));
  return container.resolve(SlackService);
}

describe('SlackService lifecycle regressions', () => {
  it('waits for bootstrap verification before closing a factory-owned transport during shutdown', async () => {
    let resolveVerification = (): void => {
      throw new Error('Verification resolver was not initialized.');
    };
    let resolveVerificationStarted = (): void => {
      throw new Error('Verification-start resolver was not initialized.');
    };
    const verification = new Promise<void>((resolve) => {
      resolveVerification = resolve;
    });
    const verificationStarted = new Promise<void>((resolve) => {
      resolveVerificationStarted = resolve;
    });
    const close = vi.fn(async () => undefined);
    const transport: SlackTransport = {
      close,
      async send() {
        return { ok: true, warnings: [] };
      },
      async verify() {
        resolveVerificationStarted();
        await verification;
      },
    };
    const service = await resolveService(
      SlackModule.forRoot({
        transport: {
          create: async () => transport,
          ownsResources: true,
        },
        verifyOnModuleInit: true,
      }),
    );

    const startup = service.onModuleInit();
    await verificationStarted;
    const shutdown = service.onApplicationShutdown();
    await Promise.resolve();
    await Promise.resolve();

    expect(close).not.toHaveBeenCalled();

    resolveVerification();
    await expect(startup).resolves.toBeUndefined();
    await expect(shutdown).resolves.toBeUndefined();
    await service.onApplicationShutdown();

    expect(close).toHaveBeenCalledOnce();
    expect(service.createPlatformStatusSnapshot()).toMatchObject({
      details: { lifecycleState: 'stopped' },
      readiness: { status: 'not-ready' },
    });
  });
});
