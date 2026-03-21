import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { MicroserviceLifecycleService } from './service.js';
import { MICROSERVICE, MICROSERVICE_OPTIONS } from './tokens.js';
import type { MicroserviceModuleOptions } from './types.js';

export function createMicroservicesProviders(options: MicroserviceModuleOptions): Provider[] {
  return [
    {
      provide: MICROSERVICE_OPTIONS,
      useValue: options,
    },
    {
      provide: MICROSERVICE,
      useClass: MicroserviceLifecycleService,
    },
  ];
}

export function createMicroservicesModule(options: MicroserviceModuleOptions): ModuleType {
  class MicroservicesModule {}

  return defineModule(MicroservicesModule, {
    exports: [MICROSERVICE],
    global: true,
    providers: createMicroservicesProviders(options),
  });
}
