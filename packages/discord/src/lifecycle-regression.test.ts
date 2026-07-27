import { type Constructor, getModuleMetadata } from '@fluojs/core';
import { Container, type Provider } from '@fluojs/di';
import { describe, expect, it, vi } from 'vitest';

import { DiscordTransportError } from './errors.js';
import { DiscordModule } from './module.js';
import { DiscordService } from './service.js';
import type {
  DiscordTemplateRenderInput,
  DiscordTransport,
  NormalizedDiscordMessage,
} from './types.js';

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

describe('DiscordService lifecycle regressions', () => {
  it('waits for in-flight verification before closing a factory-owned transport during shutdown', async () => {
    let rejectVerification = (_reason: Error): void => {
      throw new Error('Verification reject callback was not initialized.');
    };
    let resolveVerificationStarted = (): void => {
      throw new Error('Verification-start resolver was not initialized.');
    };
    const verificationError = new Error('discord auth failed while shutdown starts');
    const verification = new Promise<void>((_resolve, reject) => {
      rejectVerification = reject;
    });
    const verificationStarted = new Promise<void>((resolve) => {
      resolveVerificationStarted = resolve;
    });
    const close = vi.fn(async () => undefined);
    const transport: DiscordTransport = {
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
    await Promise.resolve();
    await Promise.resolve();
    const closeCallsBeforeVerificationSettled = close.mock.calls.length;

    rejectVerification(verificationError);
    await startupExpectation;
    await expect(shutdown).resolves.toBeUndefined();
    await service.onApplicationShutdown();

    expect(closeCallsBeforeVerificationSettled).toBe(0);
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
  });

  it('preserves the initialization phase when owned cleanup also fails during concurrent shutdown', async () => {
    let rejectVerification = (_reason: Error): void => {
      throw new Error('Verification reject callback was not initialized.');
    };
    let resolveVerificationStarted = (): void => {
      throw new Error('Verification-start resolver was not initialized.');
    };
    const verificationError = new Error('discord verification failed');
    const cleanupError = new Error('discord transport close failed');
    const verification = new Promise<void>((_resolve, reject) => {
      rejectVerification = reject;
    });
    const verificationStarted = new Promise<void>((resolve) => {
      resolveVerificationStarted = resolve;
    });
    const close = vi.fn(async () => {
      throw cleanupError;
    });
    const transport: DiscordTransport = {
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
    await Promise.resolve();
    await Promise.resolve();
    const closeCallsBeforeVerificationSettled = close.mock.calls.length;

    rejectVerification(verificationError);
    await Promise.all([startupExpectation, shutdownExpectation]);

    expect(closeCallsBeforeVerificationSettled).toBe(0);
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
  });

  it('keeps a rejected factory create failure out of shutdown cleanup diagnostics', async () => {
    const createError = new Error('discord transport factory unavailable');
    const create = vi.fn(async (): Promise<DiscordTransport> => {
      throw createError;
    });
    const service = await resolveService(
      DiscordModule.forRoot({
        transport: {
          create,
          ownsResources: true,
        },
      }),
    );

    await expect(service.onModuleInit()).rejects.toMatchObject({
      cause: createError,
      message: 'Discord transport failed to initialize.',
    });
    expect(service.createPlatformStatusSnapshot()).toMatchObject({
      details: {
        lifecycleFailurePhase: 'initialization',
        lifecycleState: 'failed',
      },
    });

    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();

    expect(create).toHaveBeenCalledOnce();
    expect(service.createPlatformStatusSnapshot()).toMatchObject({
      details: { lifecycleState: 'stopped' },
      readiness: { status: 'not-ready' },
    });
  });

  it('passes the delivery signal to renderers and checks lifecycle before rendering', async () => {
    const renderInputs: DiscordTemplateRenderInput[] = [];
    const send = vi.fn(async (_message: NormalizedDiscordMessage) => ({ ok: true, warnings: [] }));
    const service = await resolveService(
      DiscordModule.forRoot({
        renderer: {
          async render(input) {
            renderInputs.push(input);
            return { content: 'Rendered notification' };
          },
        },
        transport: { send },
      }),
    );
    const controller = new AbortController();
    await service.onModuleInit();

    await service.sendNotification(
      {
        channel: 'discord',
        payload: {},
        template: 'deploy.finished',
      },
      { signal: controller.signal },
    );

    expect(renderInputs[0]?.signal).toBe(controller.signal);
    expect(send).toHaveBeenCalledOnce();

    await service.onApplicationShutdown();

    await expect(
      service.sendNotification({
        channel: 'discord',
        payload: {},
        recipients: ['thread-a', 'thread-b'],
        template: 'after-shutdown',
      }),
    ).rejects.toThrowError(new DiscordTransportError('Discord transport is shutting down or already stopped.'));
    expect(renderInputs).toHaveLength(1);
  });
});
