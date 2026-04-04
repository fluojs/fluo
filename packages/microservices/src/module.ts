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

export class MicroservicesModule {
  static forRoot(options: MicroserviceModuleOptions): ModuleType {
    class MicroservicesModuleDefinition {}

    return defineModule(MicroservicesModuleDefinition, {
      exports: [MICROSERVICE],
      global: true,
      providers: createMicroservicesProviders(options),
    });
  }
}
