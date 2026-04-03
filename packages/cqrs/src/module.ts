import type { Provider } from '@konekti/di';
import { createEventBusModule, type EventBusModuleOptions } from '@konekti/event-bus';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { CommandBusLifecycleService } from './command-bus.js';
import { CqrsEventBusService } from './event-bus.js';
import { QueryBusLifecycleService } from './query-bus.js';
import { CqrsSagaLifecycleService } from './saga-bus.js';
import { COMMAND_BUS, EVENT_BUS, QUERY_BUS } from './tokens.js';
import type { CommandHandlerClass, EventHandlerClass, QueryHandlerClass, SagaClass } from './types.js';

export interface CqrsModuleOptions {
  commandHandlers?: readonly CommandHandlerClass[];
  eventBus?: EventBusModuleOptions;
  eventHandlers?: readonly EventHandlerClass[];
  queryHandlers?: readonly QueryHandlerClass[];
  sagas?: readonly SagaClass[];
}

function collectOptionHandlerProviders(options: CqrsModuleOptions): Provider[] {
  const providers: Provider[] = [];

  for (const commandHandler of options.commandHandlers ?? []) {
    providers.push(commandHandler);
  }

  for (const queryHandler of options.queryHandlers ?? []) {
    providers.push(queryHandler);
  }

  for (const eventHandler of options.eventHandlers ?? []) {
    providers.push(eventHandler);
  }

  for (const saga of options.sagas ?? []) {
    providers.push(saga);
  }

  return providers;
}

export function createCqrsProviders(options: CqrsModuleOptions = {}): Provider[] {
  return [
    {
      provide: COMMAND_BUS,
      useClass: CommandBusLifecycleService,
    },
    {
      provide: QUERY_BUS,
      useClass: QueryBusLifecycleService,
    },
    CqrsSagaLifecycleService,
    {
      provide: EVENT_BUS,
      useClass: CqrsEventBusService,
    },
    ...collectOptionHandlerProviders(options),
  ];
}

export function createCqrsModule(options: CqrsModuleOptions = {}): ModuleType {
  class CqrsModule {}

  return defineModule(CqrsModule, {
    exports: [COMMAND_BUS, QUERY_BUS, EVENT_BUS],
    global: true,
    imports: [createEventBusModule(options.eventBus)],
    providers: createCqrsProviders(options),
  });
}
