import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { MicroserviceLifecycleService } from './service.js';
import { MICROSERVICE, MICROSERVICE_OPTIONS } from './tokens.js';
import type { MicroserviceModuleOptions } from './types.js';

/**
 * Creates DI providers for the microservice runtime and transport options.
 *
 * @param options Microservice transport configuration consumed by the runtime lifecycle service.
 * @returns Provider definitions that register `MICROSERVICE_OPTIONS` and the runtime `MICROSERVICE` service.
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
  /**
   * Registers the microservice runtime providers as a global module.
   *
   * @param options Transport and handler runtime options for the microservice lifecycle service.
   * @returns A module definition that exports the global `MICROSERVICE` token.
   */
  static forRoot(options: MicroserviceModuleOptions): ModuleType {
    class MicroservicesModuleDefinition {}

    return defineModule(MicroservicesModuleDefinition, {
      exports: [MICROSERVICE],
      global: true,
      providers: createMicroservicesProviders(options),
    });
  }
}
