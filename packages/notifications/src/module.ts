import type { AsyncModuleOptions, MaybePromise } from '@konekti/core';
import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { NotificationsConfigurationError } from './errors.js';
import { NotificationsService } from './service.js';
import { NOTIFICATIONS, NOTIFICATION_CHANNELS, NOTIFICATIONS_OPTIONS } from './tokens.js';
import type {
  NormalizedNotificationsModuleOptions,
  NotificationChannel,
  NotificationDispatchManyOptions,
  NotificationDispatchOptions,
  NotificationDispatchRequest,
  NotificationsModuleOptions,
} from './types.js';

const DEFAULT_BULK_QUEUE_THRESHOLD = 10;

function normalizeNotificationsModuleOptions(
  options: NotificationsModuleOptions = {},
): NormalizedNotificationsModuleOptions {
  const channels = [...(options.channels ?? [])];
  const seenChannelNames = new Set<string>();

  for (const channel of channels) {
    if (seenChannelNames.has(channel.channel)) {
      throw new NotificationsConfigurationError(
        `Duplicate notification channel registration detected for "${channel.channel}".`,
      );
    }

    seenChannelNames.add(channel.channel);
  }

  return {
    channels: Object.freeze(channels),
    events: options.events
      ? {
          publishLifecycleEvents: options.events.publishLifecycleEvents ?? true,
          publisher: options.events.publisher,
        }
      : undefined,
    queue: options.queue
      ? {
          adapter: options.queue.adapter,
          bulkThreshold: Math.max(1, options.queue.bulkThreshold ?? DEFAULT_BULK_QUEUE_THRESHOLD),
        }
      : undefined,
  };
}

function createNotificationsRuntimeProviders(optionsProvider: Provider): Provider[] {
  return [
    optionsProvider,
    {
      inject: [NOTIFICATIONS_OPTIONS],
      provide: NOTIFICATION_CHANNELS,
      useFactory: (options: unknown) =>
        (options as NormalizedNotificationsModuleOptions).channels as readonly NotificationChannel[],
    },
    NotificationsService,
    {
      inject: [NotificationsService],
      provide: NOTIFICATIONS,
      useFactory: (service: unknown) => ({
        dispatch: <TRequest extends NotificationDispatchRequest>(
          notification: TRequest,
          options?: NotificationDispatchOptions,
        ) => (service as NotificationsService).dispatch(notification, options),
        dispatchMany: <TRequest extends NotificationDispatchRequest>(
          notifications: readonly TRequest[],
          options?: NotificationDispatchManyOptions,
        ) => (service as NotificationsService).dispatchMany(notifications, options),
      }),
    },
  ];
}

/**
 * Creates notifications providers for manual module composition.
 *
 * @param options Static notifications module options including channels and optional integrations.
 * @returns Provider definitions equivalent to {@link NotificationsModule.forRoot} wiring.
 */
export function createNotificationsProviders(options: NotificationsModuleOptions = {}): Provider[] {
  return createNotificationsRuntimeProviders({
    provide: NOTIFICATIONS_OPTIONS,
    useValue: normalizeNotificationsModuleOptions(options),
  });
}

function buildNotificationsModule(options: NotificationsModuleOptions): ModuleType {
  class NotificationsRootModuleDefinition {}

  return defineModule(NotificationsRootModuleDefinition, {
    exports: [NotificationsService, NOTIFICATIONS, NOTIFICATION_CHANNELS],
    global: true,
    providers: createNotificationsProviders(options),
  });
}

function buildNotificationsModuleAsync(options: AsyncModuleOptions<NotificationsModuleOptions>): ModuleType {
  class NotificationsAsyncModuleDefinition {}

  const factory = options.useFactory as (...args: unknown[]) => MaybePromise<NotificationsModuleOptions>;
  let cachedResult: Promise<NormalizedNotificationsModuleOptions> | undefined;

  const memoizedFactory = (...deps: unknown[]): Promise<NormalizedNotificationsModuleOptions> => {
    if (!cachedResult) {
      cachedResult = Promise.resolve(factory(...deps)).then((resolved) => normalizeNotificationsModuleOptions(resolved));
    }

    return cachedResult;
  };

  return defineModule(NotificationsAsyncModuleDefinition, {
    exports: [NotificationsService, NOTIFICATIONS, NOTIFICATION_CHANNELS],
    global: true,
    providers: createNotificationsRuntimeProviders({
      inject: options.inject,
      provide: NOTIFICATIONS_OPTIONS,
      scope: 'singleton',
      useFactory: (...deps: unknown[]) => memoizedFactory(...deps),
    }),
  });
}

/** Runtime module entrypoint for notification orchestration. */
export class NotificationsModule {
  /**
   * Registers notifications providers using static options.
   *
   * @param options Static notifications module options including channels and optional queue/event integrations.
   * @returns A global module definition that exports {@link NotificationsService}, `NOTIFICATIONS`, and `NOTIFICATION_CHANNELS`.
   *
   * @example
   * ```ts
   * NotificationsModule.forRoot({
   *   channels: [emailChannel],
   * });
   * ```
   */
  static forRoot(options: NotificationsModuleOptions = {}): ModuleType {
    return buildNotificationsModule(options);
  }

  /**
   * Registers notifications providers from an async DI factory.
   *
   * @param options Async module options that resolve channels and optional integration seams.
   * @returns A global module definition that memoizes async options resolution per module instance.
   *
   * @example
   * ```ts
   * NotificationsModule.forRootAsync({
   *   inject: [ConfigService],
   *   useFactory: (config) => ({
   *     channels: [createEmailChannel(config)],
   *   }),
   * });
   * ```
   */
  static forRootAsync(options: AsyncModuleOptions<NotificationsModuleOptions>): ModuleType {
    return buildNotificationsModuleAsync(options);
  }
}
