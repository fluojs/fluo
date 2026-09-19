import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { MicroserviceLifecycleService } from './service.js';
import { MICROSERVICE, MICROSERVICE_OPTIONS } from './tokens.js';
import type { MicroserviceModuleOptions } from './types.js';

/**
 * Runtime module entrypoint for registering microservice transport wiring.
 */
export class MicroservicesModule {
  /**
   * Registers the microservice runtime providers as a global module.
   *
   * @param options Transport and handler runtime options for the microservice lifecycle service.
   * @returns A module definition that exports the lifecycle class token and programmatic `MICROSERVICE` facade.
   */
  static forRoot(options: MicroserviceModuleOptions): ModuleType {
    class MicroservicesModuleDefinition {}

    const additionalExports = options.module?.additionalExports ?? [];
    const additionalProviders = options.module?.providers ?? [];
    const global = options.global ?? true;

    return defineModule(MicroservicesModuleDefinition, {
      exports: [MicroserviceLifecycleService, MICROSERVICE, ...additionalExports],
      global,
      providers: [
        {
          provide: MICROSERVICE_OPTIONS,
          useValue: { transport: options.transport },
        },
        MicroserviceLifecycleService,
        {
          inject: [MicroserviceLifecycleService],
          provide: MICROSERVICE,
          useFactory: (service: unknown) => {
            const runtime = service as MicroserviceLifecycleService;

            return {
              bidiStream: runtime.bidiStream ? (pattern: string, signal?: AbortSignal) => runtime.bidiStream!(pattern, signal) : undefined,
              clientStream: runtime.clientStream ? (pattern: string, signal?: AbortSignal) => runtime.clientStream!(pattern, signal) : undefined,
              close: (signal?: string) => runtime.close(signal),
              emit: (pattern: string, payload: unknown) => runtime.emit(pattern, payload),
              listen: () => runtime.listen(),
              markShutdownStarted: () => runtime.markShutdownStarted(),
              send: (pattern: string, payload: unknown, signal?: AbortSignal) => runtime.send(pattern, payload, signal),
              serverStream: runtime.serverStream
                ? (pattern: string, payload: unknown, signal?: AbortSignal) => runtime.serverStream!(pattern, payload, signal)
                : undefined,
            };
          },
        },
        ...additionalProviders,
      ],
    });
  }
}
