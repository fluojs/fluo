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
  it('closes a factory-owned transport exactly once when verification fails during shutdown', async () => {
    let rejectVerification = (_reason: Error): void => {
      throw new Error('Verification reject callback was not initialized.');
    };
    let resolveClose = (): void => {
      throw new Error('Close resolver was not initialized.');
    };
    let resolveCloseStarted = (): void => {
      throw new Error('Close-start resolver was not initialized.');
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
    const closeDelay = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const closeStarted = new Promise<void>((resolve) => {
      resolveCloseStarted = resolve;
    });
    const close = vi.fn(async () => {
      resolveCloseStarted();
      await closeDelay;
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
    await closeStarted;

    expect(service.createPlatformStatusSnapshot()).toMatchObject({
      details: { lifecycleState: 'stopping' },
      readiness: {
        reason: 'Discord transport is shutting down or already stopped.',
        status: 'not-ready',
      },
    });
    expect(close).toHaveBeenCalledOnce();

    const startupExpectation = expect(startup).rejects.toMatchObject({
      cause: verificationError,
      message: 'Discord transport failed to initialize.',
    });
    rejectVerification(verificationError);
    await Promise.resolve();
    await Promise.resolve();

    expect(close).toHaveBeenCalledOnce();

    resolveClose();
    await startupExpectation;
    await expect(shutdown).resolves.toBeUndefined();
    await service.onApplicationShutdown();

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
