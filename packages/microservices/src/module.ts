import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { MicroserviceLifecycleService } from './service.js';
import { MICROSERVICE, MICROSERVICE_OPTIONS } from './tokens.js';
import type { MicroserviceModuleOptions } from './types.js';

/**
 * Creates DI providers for the microservice runtime and transport options.
 */
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

/**
 * Runtime module entrypoint for registering microservice transport wiring.
 */
export class MicroservicesModule {
  /** Registers a global `MICROSERVICE` provider using canonical `forRoot(...)` semantics. */
  static forRoot(options: MicroserviceModuleOptions): ModuleType {
    class MicroservicesModuleDefinition {}

    return defineModule(MicroservicesModuleDefinition, {
      exports: [MICROSERVICE],
      global: true,
      providers: createMicroservicesProviders(options),
    });
  }
}
