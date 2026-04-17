import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { EventBusLifecycleService } from './service.js';
import { EVENT_BUS, EVENT_BUS_OPTIONS } from './tokens.js';
import type { EventBusModuleOptions, EventPublishOptions } from './types.js';

function createEventBusProviders(options: EventBusModuleOptions = {}): Provider[] {
  return [
    {
      provide: EVENT_BUS_OPTIONS,
      useValue: options,
    },
    EventBusLifecycleService,
    {
      inject: [EventBusLifecycleService],
      provide: EVENT_BUS,
      useFactory: (service: unknown) => ({
        publish: (event: object, publishOptions?: EventPublishOptions) =>
          (service as EventBusLifecycleService).publish(event, publishOptions),
      }),
    },
  ];
}

/**
 * Runtime module entrypoint for the in-process event bus.
 */
export class EventBusModule {
  /**
   * Registers the event-bus providers as a global module.
   *
   * @param options Event bus module options for publish defaults and optional transport integration.
   * @returns A module definition that exports `EventBusLifecycleService` and the compatibility token `EVENT_BUS`.
   */
  static forRoot(options: EventBusModuleOptions = {}): ModuleType {
    class EventBusModuleDefinition {}

    return defineModule(EventBusModuleDefinition, {
      exports: [EventBusLifecycleService, EVENT_BUS],
      global: true,
      providers: createEventBusProviders(options),
    });
  }
}
