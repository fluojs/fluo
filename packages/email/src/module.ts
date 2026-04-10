import type { AsyncModuleOptions, MaybePromise } from '@fluojs/core';
import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { EmailConfigurationError } from './errors.js';
import { EmailChannel } from './channel.js';
import { EmailNotificationsQueueWorker } from './queue.js';
import { EmailService } from './service.js';
import { EMAIL, EMAIL_CHANNEL, EMAIL_OPTIONS } from './tokens.js';
import type {
  Email,
  EmailAddressLike,
  EmailAsyncModuleOptions,
  EmailTransport,
  EmailTransportFactory,
  EmailModuleOptions,
  NormalizedEmailModuleOptions,
} from './types.js';

function normalizeAddress(address: EmailAddressLike | undefined) {
  if (!address) {
    return undefined;
  }

  if (typeof address === 'string') {
    return { address: address.trim() };
  }

  return {
    address: address.address.trim(),
    ...(address.name ? { name: address.name } : {}),
  };
}

function normalizeAddressList(value: EmailAddressLike | readonly EmailAddressLike[] | undefined) {
  if (!value) {
    return [];
  }

  const list = Array.isArray(value) ? value : [value];
  return list.map((entry) => normalizeAddress(entry)).filter((entry) => entry !== undefined);
}

function isTransportFactory(value: EmailModuleOptions['transport']): value is EmailTransportFactory {
  return typeof value === 'object' && value !== null && 'create' in value;
}

function normalizeEmailModuleOptions(options: EmailModuleOptions): NormalizedEmailModuleOptions {
  if (!options.transport) {
    throw new EmailConfigurationError('EmailModule requires an explicit `transport` to be configured.');
  }

  const transport = options.transport;
  const createTransport = isTransportFactory(transport)
    ? async (): Promise<EmailTransport> => transport.create()
    : async (): Promise<EmailTransport> => transport as EmailTransport;

  return {
    defaultFrom: normalizeAddress(options.defaultFrom),
    defaultReplyTo: normalizeAddressList(options.defaultReplyTo),
    notifications: {
      channel: options.notifications?.channel?.trim() || 'email',
    },
    renderer: options.renderer,
    transport: {
      create: createTransport,
      kind: isTransportFactory(transport) ? transport.kind?.trim() || 'custom-factory' : 'custom-instance',
      ownsResources: isTransportFactory(transport) ? transport.ownsResources ?? true : false,
    },
    verifyOnModuleInit: options.verifyOnModuleInit ?? false,
  };
}

function createEmailRuntimeProviders(optionsProvider: Provider): Provider[] {
  return [
    optionsProvider,
    EmailService,
    EmailChannel,
    EmailNotificationsQueueWorker,
    {
      inject: [EmailService],
      provide: EMAIL,
      useFactory: (service: unknown): Email => ({
        send: (message, options) => (service as EmailService).send(message, options),
        sendMany: (messages, options) => (service as EmailService).sendMany(messages, options),
        sendNotification: (notification, options) => (service as EmailService).sendNotification(notification, options),
      }),
    },
    {
      inject: [EmailChannel],
      provide: EMAIL_CHANNEL,
      useFactory: (channel: unknown) => channel,
    },
  ];
}

/**
 * Creates email providers for manual module composition.
 *
 * @param options Static email module options including explicit transport wiring.
 * @returns Provider definitions equivalent to {@link EmailModule.forRoot} wiring.
 */
export function createEmailProviders(options: EmailModuleOptions): Provider[] {
  return createEmailRuntimeProviders({
    provide: EMAIL_OPTIONS,
    useValue: normalizeEmailModuleOptions(options),
  });
}

function buildEmailModule(options: EmailModuleOptions): ModuleType {
  class EmailRootModuleDefinition {}

  return defineModule(EmailRootModuleDefinition, {
    exports: [EmailService, EmailChannel, EMAIL, EMAIL_CHANNEL],
    global: true,
    providers: createEmailProviders(options),
  });
}

function buildEmailModuleAsync(options: AsyncModuleOptions<EmailModuleOptions>): ModuleType {
  class EmailAsyncModuleDefinition {}

  const factory = options.useFactory as (...args: unknown[]) => MaybePromise<EmailModuleOptions>;
  let cachedResult: Promise<NormalizedEmailModuleOptions> | undefined;

  const memoizedFactory = (...deps: unknown[]): Promise<NormalizedEmailModuleOptions> => {
    if (!cachedResult) {
      cachedResult = Promise.resolve(factory(...deps)).then((resolved) => normalizeEmailModuleOptions(resolved));
    }

    return cachedResult;
  };

  return defineModule(EmailAsyncModuleDefinition, {
    exports: [EmailService, EmailChannel, EMAIL, EMAIL_CHANNEL],
    global: true,
    providers: createEmailRuntimeProviders({
      inject: options.inject,
      provide: EMAIL_OPTIONS,
      scope: 'singleton',
      useFactory: (...deps: unknown[]) => memoizedFactory(...deps),
    }),
  });
}

/** Runtime module entrypoint for email delivery and notifications integration. */
export class EmailModule {
  /**
   * Registers email providers using static options.
   *
   * @param options Static email module options including transport wiring and optional template rendering behavior.
   * @returns A global module definition that exports {@link EmailService}, {@link EmailChannel}, and queue integration tokens.
   *
   * @example
    * ```ts
    * EmailModule.forRoot({
    *   defaultFrom: 'noreply@example.com',
    *   transport: {
    *     kind: 'example-transport',
    *     create: async () => exampleTransport,
    *   },
    * });
    * ```
    */
  static forRoot(options: EmailModuleOptions): ModuleType {
    return buildEmailModule(options);
  }

  /**
   * Registers email providers from an async DI factory.
   *
   * @param options Async module options that resolve email transport and renderer configuration through DI.
   * @returns A global module definition that memoizes async option resolution per module instance.
   *
   * @example
    * ```ts
    * EmailModule.forRootAsync({
    *   inject: [ConfigService],
    *   useFactory: (config) => ({
    *     defaultFrom: config.mail.from,
    *     transport: {
    *       kind: config.mail.kind,
    *       create: () => config.mail.transport,
    *     },
    *   }),
    * });
    * ```
   */
  static forRootAsync(options: EmailAsyncModuleOptions): ModuleType {
    return buildEmailModuleAsync(options);
  }
}
