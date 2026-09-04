import { type Constructor, getModuleMetadata } from '@fluojs/core';
import { Container, type Provider } from '@fluojs/di';
import { describe, expect, it, vi } from 'vitest';

import { DiscordModule } from './module.js';
import { DiscordService } from './service.js';
import type { DiscordTransport } from './types.js';

function moduleProviders(moduleType: Constructor): Provider[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.providers)) {
    throw new Error('DiscordModule did not register providers metadata.');
  }

  return metadata.providers as Provider[];
}

async function resolveService(moduleType: Constructor): Promise<DiscordService> {
  const container = new Container();
  container.register(...moduleProviders(moduleType));
  return container.resolve(DiscordService);
}

describe('DiscordService shutdown lifecycle regressions', () => {
  it('waits for in-flight verification before closing a factory-owned transport during shutdown', async () => {
    let rejectVerification = (_reason: Error): void => {
      throw new Error('Verification reject callback was not initialized.');
    };
    let resolveVerificationStarted = (): void => {
      throw new Error('Verification-start resolver was not initialized.');
    };
    let resolveVerificationSettled = (): void => {
      throw new Error('Verification-settled resolver was not initialized.');
    };
    let resolveCloseStarted = (): void => {
      throw new Error('Close-start resolver was not initialized.');
    };
    const verificationError = new Error('discord auth failed while shutdown starts');
    const lifecycleEvents: ('verification-started' | 'verification-settled' | 'close-started')[] = [];
    const verification = new Promise<void>((_resolve, reject) => {
      rejectVerification = reject;
    });
    const verificationStarted = new Promise<void>((resolve) => {
      resolveVerificationStarted = resolve;
    });
    const verificationSettled = new Promise<void>((resolve) => {
      resolveVerificationSettled = resolve;
    });
    const closeStarted = new Promise<void>((resolve) => {
      resolveCloseStarted = resolve;
    });
    const close = vi.fn(async () => {
      lifecycleEvents.push('close-started');
      resolveCloseStarted();
    });
    const transport: DiscordTransport = {
      close,
      async send() {
        return { ok: true, warnings: [] };
      },
      async verify() {
        lifecycleEvents.push('verification-started');
        resolveVerificationStarted();

        try {
          await verification;
        } finally {
          lifecycleEvents.push('verification-settled');
          resolveVerificationSettled();
        }
      },
    };
    const service = await resolveService(
      DiscordModule.forRoot({
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

    expect(service.createPlatformStatusSnapshot()).toMatchObject({
      details: { lifecycleState: 'stopping' },
      readiness: {
        reason: 'Discord transport is shutting down or already stopped.',
        status: 'not-ready',
      },
    });

    const startupExpectation = expect(startup).rejects.toMatchObject({
      cause: verificationError,
      message: 'Discord transport failed to initialize.',
    });

    rejectVerification(verificationError);
    await verificationSettled;
    await closeStarted;
    await startupExpectation;
    await expect(shutdown).resolves.toBeUndefined();
    await service.onApplicationShutdown();

    expect(lifecycleEvents).toEqual(['verification-started', 'verification-settled', 'close-started']);
    expect(close).toHaveBeenCalledOnce();
    const stoppedStatus = service.createPlatformStatusSnapshot();
    expect(stoppedStatus).toMatchObject({
      details: { lifecycleState: 'stopped' },
      readiness: {
        reason: 'Discord transport is shutting down or already stopped.',
        status: 'not-ready',
      },
    });
    expect(stoppedStatus.details).not.toHaveProperty('lifecycleFailurePhase');
  }, 1_000);

  it('preserves the initialization phase when owned cleanup also fails during concurrent shutdown', async () => {
    let rejectVerification = (_reason: Error): void => {
      throw new Error('Verification reject callback was not initialized.');
    };
    let resolveVerificationStarted = (): void => {
      throw new Error('Verification-start resolver was not initialized.');
    };
    let resolveVerificationSettled = (): void => {
      throw new Error('Verification-settled resolver was not initialized.');
    };
    let resolveCloseStarted = (): void => {
      throw new Error('Close-start resolver was not initialized.');
    };
    const verificationError = new Error('discord verification failed');
    const cleanupError = new Error('discord transport close failed');
    const lifecycleEvents: ('verification-started' | 'verification-settled' | 'close-started')[] = [];
    const verification = new Promise<void>((_resolve, reject) => {
      rejectVerification = reject;
    });
    const verificationStarted = new Promise<void>((resolve) => {
      resolveVerificationStarted = resolve;
    });
    const verificationSettled = new Promise<void>((resolve) => {
      resolveVerificationSettled = resolve;
    });
    const closeStarted = new Promise<void>((resolve) => {
      resolveCloseStarted = resolve;
    });
    const close = vi.fn(async () => {
      lifecycleEvents.push('close-started');
      resolveCloseStarted();
      throw cleanupError;
    });
    const transport: DiscordTransport = {
      close,
      async send() {
        return { ok: true, warnings: [] };
      },
      async verify() {
        lifecycleEvents.push('verification-started');
        resolveVerificationStarted();

        try {
          await verification;
        } finally {
          lifecycleEvents.push('verification-settled');
          resolveVerificationSettled();
        }
      },
    };
    const service = await resolveService(
      DiscordModule.forRoot({
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
    const startupExpectation = expect(startup).rejects.toMatchObject({
      message: 'Discord transport failed to initialize.',
    });
    const shutdownExpectation = expect(shutdown).rejects.toMatchObject({
      cause: cleanupError,
      message: 'Discord transport failed to close cleanly.',
    });

    rejectVerification(verificationError);
    await verificationSettled;
    await closeStarted;
    await Promise.all([startupExpectation, shutdownExpectation]);

    expect(lifecycleEvents).toEqual(['verification-started', 'verification-settled', 'close-started']);
    expect(close).toHaveBeenCalledOnce();
    expect(service.createPlatformStatusSnapshot()).toMatchObject({
      details: {
        lifecycleFailurePhase: 'initialization',
        lifecycleState: 'failed',
      },
      readiness: {
        reason: 'Discord transport failed to initialize.',
        status: 'not-ready',
      },
    });
  }, 1_000);
});
