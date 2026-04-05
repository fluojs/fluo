import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { EventBusLifecycleService } from './service.js';
import { EVENT_BUS, EVENT_BUS_OPTIONS } from './tokens.js';
import type { EventBusModuleOptions } from './types.js';

/**
 * Creates event-bus lifecycle providers and module options wiring.
 *
 * @param options Event bus configuration used for publish defaults and optional transport integration.
 * @returns Provider definitions that register `EVENT_BUS_OPTIONS` and the runtime `EVENT_BUS` service.
 */
export function createEventBusProviders(options: EventBusModuleOptions = {}): Provider[] {
  return [
    {
      provide: EVENT_BUS_OPTIONS,
      useValue: options,
    },
    {
      provide: EVENT_BUS,
      useClass: EventBusLifecycleService,
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
   * @param options Event bus module options forwarded to {@link createEventBusProviders}.
   * @returns A module definition that exports the global `EVENT_BUS` token.
   */
  static forRoot(options: EventBusModuleOptions = {}): ModuleType {
    class EventBusModuleDefinition {}

    return defineModule(EventBusModuleDefinition, {
      exports: [EVENT_BUS],
      global: true,
      providers: createEventBusProviders(options),
    });
  }
}
