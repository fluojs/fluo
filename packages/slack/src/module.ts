import type { AsyncModuleOptions, MaybePromise } from '@fluojs/core';
import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { SlackConfigurationError } from './errors.js';
import { SlackChannel } from './channel.js';
import { SlackService } from './service.js';
import { SLACK, SLACK_CHANNEL, SLACK_OPTIONS } from './tokens.js';
import type {
  NormalizedSlackModuleOptions,
  Slack,
  SlackAsyncModuleOptions,
  SlackModuleOptions,
  SlackTransport,
  SlackTransportFactory,
} from './types.js';

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function isTransportFactory(value: SlackModuleOptions['transport']): value is SlackTransportFactory {
  return typeof value === 'object' && value !== null && 'create' in value;
}

function normalizeSlackModuleOptions(options: SlackModuleOptions): NormalizedSlackModuleOptions {
  if (!options.transport) {
    throw new SlackConfigurationError('SlackModule requires an explicit `transport` to be configured.');
  }

  const transport = options.transport;
  const createTransport = isTransportFactory(transport)
    ? async (): Promise<SlackTransport> => transport.create()
    : async (): Promise<SlackTransport> => transport as SlackTransport;

  return {
    defaultChannel: normalizeOptionalString(options.defaultChannel),
    notifications: {
      channel: normalizeOptionalString(options.notifications?.channel) ?? 'slack',
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

function createSlackRuntimeProviders(optionsProvider: Provider): Provider[] {
  return [
    optionsProvider,
    SlackService,
    SlackChannel,
    {
      inject: [SlackService],
      provide: SLACK,
      useFactory: (service: unknown): Slack => ({
        send: (message, options) => (service as SlackService).send(message, options),
        sendMany: (messages, options) => (service as SlackService).sendMany(messages, options),
        sendNotification: (notification, options) => (service as SlackService).sendNotification(notification, options),
      }),
    },
    {
      inject: [SlackChannel],
      provide: SLACK_CHANNEL,
      useFactory: (channel: unknown) => channel,
    },
  ];
}

/**
 * Creates Slack providers for manual module composition.
 *
 * @param options Static Slack module options including explicit transport wiring.
 * @returns Provider definitions equivalent to {@link SlackModule.forRoot} wiring.
 */
export function createSlackProviders(options: SlackModuleOptions): Provider[] {
  return createSlackRuntimeProviders({
    provide: SLACK_OPTIONS,
    useValue: normalizeSlackModuleOptions(options),
  });
}

function buildSlackModule(options: SlackModuleOptions): ModuleType {
  class SlackRootModuleDefinition {}

  return defineModule(SlackRootModuleDefinition, {
    exports: [SlackService, SlackChannel, SLACK, SLACK_CHANNEL],
    global: true,
    providers: createSlackProviders(options),
  });
}

function buildSlackModuleAsync(options: AsyncModuleOptions<SlackModuleOptions>): ModuleType {
  class SlackAsyncModuleDefinition {}

  const factory = options.useFactory as (...args: unknown[]) => MaybePromise<SlackModuleOptions>;
  let cachedResult: Promise<NormalizedSlackModuleOptions> | undefined;

  const memoizedFactory = (...deps: unknown[]): Promise<NormalizedSlackModuleOptions> => {
    if (!cachedResult) {
      cachedResult = Promise.resolve(factory(...deps)).then((resolved) => normalizeSlackModuleOptions(resolved));
    }

    return cachedResult;
  };

  return defineModule(SlackAsyncModuleDefinition, {
    exports: [SlackService, SlackChannel, SLACK, SLACK_CHANNEL],
    global: true,
    providers: createSlackRuntimeProviders({
      inject: options.inject,
      provide: SLACK_OPTIONS,
      scope: 'singleton',
      useFactory: (...deps: unknown[]) => memoizedFactory(...deps),
    }),
  });
}

/** Runtime module entrypoint for Slack delivery and notifications integration. */
export class SlackModule {
  /**
   * Registers Slack providers using static options.
   *
   * @param options Static Slack module options including transport wiring and optional template rendering behavior.
   * @returns A global module definition that exports {@link SlackService}, {@link SlackChannel}, and compatibility tokens.
   *
   * @example
   * ```ts
   * SlackModule.forRoot({
   *   transport: createSlackWebhookTransport({ webhookUrl: 'https://hooks.slack.com/services/...' }),
   * });
   * ```
   */
  static forRoot(options: SlackModuleOptions): ModuleType {
    return buildSlackModule(options);
  }

  /**
   * Registers Slack providers from an async DI factory.
   *
   * @param options Async module options that resolve Slack transport and renderer configuration through DI.
   * @returns A global module definition that memoizes async option resolution per module instance.
   *
   * @example
   * ```ts
   * SlackModule.forRootAsync({
   *   inject: [ConfigService],
   *   useFactory: (config) => ({
   *     defaultChannel: config.slack.channel,
   *     transport: createSlackWebhookTransport({
   *       fetch: config.runtime.fetch,
   *       webhookUrl: config.slack.webhookUrl,
   *     }),
   *   }),
   * });
   * ```
   */
  static forRootAsync(options: SlackAsyncModuleOptions): ModuleType {
    return buildSlackModuleAsync(options);
  }
}
