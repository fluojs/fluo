import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { EventBusLifecycleService } from './service.js';
import { EVENT_BUS } from './tokens.js';

export function createEventBusProviders(): Provider[] {
  return [
    {
      provide: EVENT_BUS,
      useClass: EventBusLifecycleService,
    },
  ];
}

export function createEventBusModule(): ModuleType {
  class EventBusModule {}

  return defineModule(EventBusModule, {
    exports: [EVENT_BUS],
    global: true,
    providers: createEventBusProviders(),
  });
}
