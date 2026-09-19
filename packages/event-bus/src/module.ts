import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { EVENT_BUS_SHUTDOWN_COORDINATOR } from './integration.js';
import { EventBusLifecycleService, EventBusService } from './service.js';
import { EVENT_BUS_OPTIONS } from './tokens.js';
import type { EventBusModuleOptions } from './types.js';

function createEventBusProviders(options: EventBusModuleOptions = {}): Provider[] {
  return [
    {
      provide: EVENT_BUS_OPTIONS,
      useValue: options,
    },
    EventBusLifecycleService,
    EventBusService,
    {
      inject: [EventBusLifecycleService],
      provide: EVENT_BUS_SHUTDOWN_COORDINATOR,
      useFactory: (service: unknown) => ({
        adoptShutdownDeadline: (deadlineAtMs: number) =>
          (service as EventBusLifecycleService).adoptShutdownDeadline(deadlineAtMs),
      }),
    },
  ];
}

/**
 * Runtime module entrypoint for the in-process event bus.
 */
export class EventBusModule {
  /**
   * Registers event-bus providers globally by default, or locally when `options.global` is `false`.
   *
   * @param options Event bus module options for publish defaults and optional transport integration.
   * @returns A module definition that exports `EventBusService` and the integration coordinator.
   */
  static forRoot(options: EventBusModuleOptions = {}): ModuleType {
    class EventBusModuleDefinition {}

    return defineModule(EventBusModuleDefinition, {
      exports: [EventBusService, EVENT_BUS_SHUTDOWN_COORDINATOR],
      global: options.global ?? true,
      providers: createEventBusProviders(options),
    });
  }
}
