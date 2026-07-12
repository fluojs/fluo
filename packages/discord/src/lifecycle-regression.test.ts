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
  it('closes a factory-owned transport exactly once when bootstrap verification fails', async () => {
    const verificationError = new Error('discord auth failed');
    const close = vi.fn(async () => undefined);
    const transport: DiscordTransport = {
      close,
      async send() {
        return { ok: true, warnings: [] };
      },
      async verify() {
        throw verificationError;
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

    await expect(service.onModuleInit()).rejects.toMatchObject({
      cause: verificationError,
      message: 'Discord transport failed to initialize.',
    });
    expect(close).toHaveBeenCalledOnce();

    await Promise.all([service.onApplicationShutdown(), service.onApplicationShutdown()]);

    expect(close).toHaveBeenCalledOnce();
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
