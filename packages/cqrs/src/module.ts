import type { Provider } from '@fluojs/di';
import { EventBusModule, type EventBusModuleOptions } from '@fluojs/event-bus';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { CommandBusLifecycleService } from './buses/command-bus.js';
import { CqrsEventBusService } from './buses/event-bus.js';
import { QueryBusLifecycleService } from './buses/query-bus.js';
import { CqrsSagaLifecycleService } from './buses/saga-bus.js';
import { CqrsShutdownDeadline } from './buses/shutdown-deadline.js';
import { CQRS_MODULE_OPTIONS } from './tokens.js';

/** Module options for CQRS bus and event-bus integration. */
export interface CqrsModuleOptions {
  eventBus?: EventBusModuleOptions;
  /** Whether CQRS bus providers should be visible globally. Defaults to `true`. */
  global?: boolean;
  /** Shutdown drain policy for CQRS event pipelines and saga execution. `drainTimeoutMs` defaults to 5000ms. */
  shutdown?: {
    drainTimeoutMs?: number;
  };
}

function resolveDelegatedEventBusOptions(options: CqrsModuleOptions): EventBusModuleOptions {
  const eventBusOptions = options.eventBus ?? {};
  const eventBusShutdown = eventBusOptions.shutdown;

  return {
    ...eventBusOptions,
    global: eventBusOptions.global ?? options.global ?? true,
    shutdown: {
      ...eventBusShutdown,
      drainTimeoutMs: eventBusShutdown?.drainTimeoutMs ?? options.shutdown?.drainTimeoutMs,
    },
  };
}

/** Creates the providers required for CQRS buses and event-bus integration. */
function createCqrsProviders(options: CqrsModuleOptions, shutdownDeadline: CqrsShutdownDeadline): Provider[] {
  return [
    {
      provide: CQRS_MODULE_OPTIONS,
      useValue: options,
    },
    {
      provide: CqrsShutdownDeadline,
      useValue: shutdownDeadline,
    },
    CommandBusLifecycleService,
    QueryBusLifecycleService,
    CqrsSagaLifecycleService,
    CqrsEventBusService,
  ];
}

/** Runtime module entrypoint for CQRS bus registration and handler discovery. */
export class CqrsModule {
  /**
   * Registers CQRS buses and wires them to the event-bus integration.
   *
   * The exported buses are global by default. Set {@link CqrsModuleOptions.global} to `false` to
   * keep them visible only through modules that import this module definition.
   *
   * @param options CQRS module options including event-bus settings.
   * @returns A module definition that exports the lifecycle services.
   */
  static forRoot(options: CqrsModuleOptions = {}): ModuleType {
    class CqrsModuleDefinition {}
    const shutdownDeadline = new CqrsShutdownDeadline();

    return defineModule(CqrsModuleDefinition, {
      exports: [
        CommandBusLifecycleService,
        QueryBusLifecycleService,
        CqrsEventBusService,
      ],
      global: options.global ?? true,
      imports: [EventBusModule.forRoot(resolveDelegatedEventBusOptions(options))],
      providers: createCqrsProviders(options, shutdownDeadline),
    });
  }
}
