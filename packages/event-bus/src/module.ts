import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { EventBusLifecycleService } from './service.js';
import { EVENT_BUS, EVENT_BUS_OPTIONS } from './tokens.js';
import type { EventBusModuleOptions } from './types.js';

/**
 * Creates event-bus lifecycle providers and module options wiring.
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
  /** Registers a global `EVENT_BUS` provider using canonical `forRoot(...)` semantics. */
  static forRoot(options: EventBusModuleOptions = {}): ModuleType {
    class EventBusModuleDefinition {}

    return defineModule(EventBusModuleDefinition, {
      exports: [EVENT_BUS],
      global: true,
      providers: createEventBusProviders(options),
    });
  }
}
