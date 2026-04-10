import type { AsyncModuleOptions, MaybePromise } from '@fluojs/core';
import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { DiscordChannel } from './channel.js';
import { DiscordConfigurationError } from './errors.js';
import { DiscordService } from './service.js';
import { DISCORD, DISCORD_CHANNEL, DISCORD_OPTIONS } from './tokens.js';
import type {
  Discord,
  DiscordAsyncModuleOptions,
  DiscordModuleOptions,
  DiscordTransport,
  DiscordTransportFactory,
  NormalizedDiscordModuleOptions,
} from './types.js';

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function isTransportFactory(value: DiscordModuleOptions['transport']): value is DiscordTransportFactory {
  return typeof value === 'object' && value !== null && 'create' in value;
}

function normalizeDiscordModuleOptions(options: DiscordModuleOptions): NormalizedDiscordModuleOptions {
  if (!options.transport) {
    throw new DiscordConfigurationError('DiscordModule requires an explicit `transport` to be configured.');
  }

  const transport = options.transport;
  const createTransport = isTransportFactory(transport)
    ? async (): Promise<DiscordTransport> => transport.create()
    : async (): Promise<DiscordTransport> => transport as DiscordTransport;

  return {
    defaultThreadId: normalizeOptionalString(options.defaultThreadId),
    notifications: {
      channel: normalizeOptionalString(options.notifications?.channel) ?? 'discord',
    },
    renderer: options.renderer,
    transport: {
      create: createTransport,
      kind: isTransportFactory(transport) ? normalizeOptionalString(transport.kind) ?? 'custom-factory' : 'custom-instance',
      ownsResources: isTransportFactory(transport) ? transport.ownsResources ?? true : false,
    },
    verifyOnModuleInit: options.verifyOnModuleInit ?? false,
  };
}

function createDiscordRuntimeProviders(optionsProvider: Provider): Provider[] {
  return [
    optionsProvider,
    DiscordService,
    DiscordChannel,
    {
      inject: [DiscordService],
      provide: DISCORD,
      useFactory: (service: unknown): Discord => ({
        send: (message, options) => (service as DiscordService).send(message, options),
        sendMany: (messages, options) => (service as DiscordService).sendMany(messages, options),
        sendNotification: (notification, options) => (service as DiscordService).sendNotification(notification, options),
      }),
    },
    {
      inject: [DiscordChannel],
      provide: DISCORD_CHANNEL,
      useFactory: (channel: unknown) => channel,
    },
  ];
}

/**
 * Creates Discord providers for manual module composition.
 *
 * @param options Static Discord module options including explicit transport wiring.
 * @returns Provider definitions equivalent to {@link DiscordModule.forRoot} wiring.
 */
export function createDiscordProviders(options: DiscordModuleOptions): Provider[] {
  return createDiscordRuntimeProviders({
    provide: DISCORD_OPTIONS,
    useValue: normalizeDiscordModuleOptions(options),
  });
}

function buildDiscordModule(options: DiscordModuleOptions): ModuleType {
  class DiscordRootModuleDefinition {}

  return defineModule(DiscordRootModuleDefinition, {
    exports: [DiscordService, DiscordChannel, DISCORD, DISCORD_CHANNEL],
    global: true,
    providers: createDiscordProviders(options),
  });
}

function buildDiscordModuleAsync(options: AsyncModuleOptions<DiscordModuleOptions>): ModuleType {
  class DiscordAsyncModuleDefinition {}

  const factory = options.useFactory as (...args: unknown[]) => MaybePromise<DiscordModuleOptions>;
  let cachedResult: Promise<NormalizedDiscordModuleOptions> | undefined;

  const memoizedFactory = (...deps: unknown[]): Promise<NormalizedDiscordModuleOptions> => {
    if (!cachedResult) {
      cachedResult = Promise.resolve(factory(...deps)).then((resolved) => normalizeDiscordModuleOptions(resolved));
    }

    return cachedResult;
  };

  return defineModule(DiscordAsyncModuleDefinition, {
    exports: [DiscordService, DiscordChannel, DISCORD, DISCORD_CHANNEL],
    global: true,
    providers: createDiscordRuntimeProviders({
      inject: options.inject,
      provide: DISCORD_OPTIONS,
      scope: 'singleton',
      useFactory: (...deps: unknown[]) => memoizedFactory(...deps),
    }),
  });
}

/** Runtime module entrypoint for Discord delivery and notifications integration. */
export class DiscordModule {
  /**
   * Registers Discord providers using static options.
   *
   * @param options Static Discord module options including transport wiring and optional template rendering behavior.
   * @returns A global module definition that exports {@link DiscordService}, {@link DiscordChannel}, and compatibility tokens.
   *
   * @example
   * ```ts
   * DiscordModule.forRoot({
   *   transport: createDiscordWebhookTransport({ webhookUrl: 'https://discord.com/api/webhooks/...' }),
   * });
   * ```
   */
  static forRoot(options: DiscordModuleOptions): ModuleType {
    return buildDiscordModule(options);
  }

  /**
   * Registers Discord providers from an async DI factory.
   *
   * @param options Async module options that resolve Discord transport and renderer configuration through DI.
   * @returns A global module definition that memoizes async option resolution per module instance.
   *
   * @example
   * ```ts
   * DiscordModule.forRootAsync({
   *   inject: [ConfigService],
   *   useFactory: (config) => ({
   *     defaultThreadId: config.discord.threadId,
   *     transport: createDiscordWebhookTransport({
   *       fetch: config.runtime.fetch,
   *       webhookUrl: config.discord.webhookUrl,
   *     }),
   *   }),
   * });
   * ```
   */
  static forRootAsync(options: DiscordAsyncModuleOptions): ModuleType {
    return buildDiscordModuleAsync(options);
  }
}
