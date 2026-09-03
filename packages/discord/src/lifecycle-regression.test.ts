import { type Constructor, getModuleMetadata } from '@fluojs/core';
import { Container, type Provider } from '@fluojs/di';
import { describe, expect, it, vi } from 'vitest';

import { DiscordTransportError } from './errors.js';
import { DiscordModule } from './module.js';
import { DiscordService } from './service.js';
import type {
  DiscordTemplateRenderInput,
  DiscordTransport,
  DiscordTransportContext,
  DiscordTransportReceipt,
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

  it('drains a direct delivery accepted before shutdown before closing a factory-owned transport', async () => {
    let resolveDelivery = (): void => {
      throw new Error('Delivery resolver was not initialized.');
    };
    let resolveDeliveryStarted = (): void => {
      throw new Error('Delivery-start resolver was not initialized.');
    };
    let deliverySettled = false;
    const delivery = new Promise<void>((resolve) => {
      resolveDelivery = resolve;
    });
    const deliveryStarted = new Promise<void>((resolve) => {
      resolveDeliveryStarted = resolve;
    });
    const close = vi.fn(async () => {
      expect(deliverySettled).toBe(true);
    });
    const transport: DiscordTransport = {
      close,
      async send() {
        resolveDeliveryStarted();
        await delivery;
        deliverySettled = true;
        return { ok: true, warnings: [] };
      },
    };
    const service = await resolveService(
      DiscordModule.forRoot({
        transport: {
          create: async () => transport,
          ownsResources: true,
        },
      }),
    );
    await service.onModuleInit();

    const acceptedDelivery = service.send({ content: 'Accepted before shutdown.' });
    await deliveryStarted;
    const shutdown = service.onApplicationShutdown();

    resolveDelivery();

    await expect(acceptedDelivery).resolves.toMatchObject({ ok: true });
    await expect(shutdown).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });

  it('drains notification rendering accepted before shutdown before closing a factory-owned transport', async () => {
    let resolveRendering = (): void => {
      throw new Error('Rendering resolver was not initialized.');
    };
    let resolveRenderingStarted = (): void => {
      throw new Error('Rendering-start resolver was not initialized.');
    };
    let renderingSettled = false;
    const rendering = new Promise<void>((resolve) => {
      resolveRendering = resolve;
    });
    const renderingStarted = new Promise<void>((resolve) => {
      resolveRenderingStarted = resolve;
    });
    const close = vi.fn(async () => {
      expect(renderingSettled).toBe(true);
    });
    const send = vi.fn(async (_message: NormalizedDiscordMessage) => ({ ok: true, warnings: [] }));
    const service = await resolveService(
      DiscordModule.forRoot({
        renderer: {
          async render() {
            resolveRenderingStarted();
            await rendering;
            renderingSettled = true;
            return { content: 'Rendered before shutdown.' };
          },
        },
        transport: {
          create: async () => ({
            close,
            send,
          }),
          ownsResources: true,
        },
      }),
    );
    await service.onModuleInit();

    const acceptedDelivery = service.sendNotification({
      channel: 'discord',
      payload: {},
      template: 'deploy.finished',
    });
    await renderingStarted;
    const shutdown = service.onApplicationShutdown();

    resolveRendering();

    await expect(acceptedDelivery).resolves.toMatchObject({ ok: true });
    await expect(shutdown).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('drains a notification admitted during synchronous renderer-triggered shutdown before closing transport', async () => {
    let resolveRendering = (): void => {
      throw new Error('Rendering resolver was not initialized.');
    };
    let resolveRenderingStarted = (): void => {
      throw new Error('Rendering-start resolver was not initialized.');
    };
    let deliverySettled = false;
    let renderingSettled = false;
    let shutdown: Promise<void> | undefined;
    let service: DiscordService | undefined;
    const rendering = new Promise<void>((resolve) => {
      resolveRendering = resolve;
    });
    const renderingStarted = new Promise<void>((resolve) => {
      resolveRenderingStarted = resolve;
    });
    const close = vi.fn(async () => {
      expect(deliverySettled).toBe(true);
      expect(renderingSettled).toBe(true);
    });
    const send = vi.fn(async (_message: NormalizedDiscordMessage) => {
      deliverySettled = true;
      return { ok: true, warnings: [] };
    });
    service = await resolveService(
      DiscordModule.forRoot({
        renderer: {
          async render() {
            if (!service) {
              throw new Error('DiscordService was not initialized before rendering.');
            }

            shutdown = service.onApplicationShutdown();
            resolveRenderingStarted();
            await rendering;
            renderingSettled = true;
            return { content: 'Rendered during shutdown.' };
          },
        },
        transport: {
          create: async () => ({
            close,
            send,
          }),
          ownsResources: true,
        },
      }),
    );
    await service.onModuleInit();

    const acceptedDelivery = service.sendNotification({
      channel: 'discord',
      payload: {},
      template: 'deploy.finished',
    });
    await renderingStarted;
    const activeShutdown = shutdown;

    if (!activeShutdown) {
      throw new Error('Renderer did not initiate shutdown.');
    }

    resolveRendering();

    await expect(acceptedDelivery).resolves.toMatchObject({ ok: true });
    await expect(activeShutdown).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
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

  it('passes a live caller signal to custom transport delivery and preserves its in-flight abort', async () => {
    let resolveTransportSignal = (_signal: AbortSignal | undefined): void => {
      throw new Error('Transport signal resolver was not initialized.');
    };
    const transportSignal = new Promise<AbortSignal | undefined>((resolve) => {
      resolveTransportSignal = resolve;
    });
    const transport: DiscordTransport = {
      send(_message: NormalizedDiscordMessage, context: DiscordTransportContext): Promise<DiscordTransportReceipt> {
        resolveTransportSignal(context.signal);

        return new Promise<DiscordTransportReceipt>((_resolve, reject) => {
          context.signal?.addEventListener(
            'abort',
            () => {
              reject(context.signal?.reason);
            },
            { once: true },
          );
        });
      },
    };
    const service = await resolveService(
      DiscordModule.forRoot({
        transport,
      }),
    );
    const controller = new AbortController();
    const abortReason = new DOMException('Caller cancelled Discord delivery.', 'AbortError');
    await service.onModuleInit();

    const pending = service.send(
      { content: 'In-flight cancellation' },
      { signal: controller.signal },
    );

    await expect(transportSignal).resolves.toBe(controller.signal);

    controller.abort(abortReason);

    await expect(pending).rejects.toBe(abortReason);
  });
});
