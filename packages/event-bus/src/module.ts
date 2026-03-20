import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { EventBusLifecycleService } from './service.js';
import { EVENT_BUS, EVENT_BUS_OPTIONS } from './tokens.js';
import type { EventBusModuleOptions } from './types.js';

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

export function createEventBusModule(options: EventBusModuleOptions = {}): ModuleType {
  class EventBusModule {}

  return defineModule(EventBusModule, {
    exports: [EVENT_BUS],
    global: true,
    providers: createEventBusProviders(options),
  });
}
