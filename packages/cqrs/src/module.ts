import type { Provider } from '@konekti/di';
import { EventBusModule, type EventBusModuleOptions } from '@konekti/event-bus';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { CommandBusLifecycleService } from './buses/command-bus.js';
import { CqrsEventBusService } from './buses/event-bus.js';
import { QueryBusLifecycleService } from './buses/query-bus.js';
import { CqrsSagaLifecycleService } from './buses/saga-bus.js';
import { COMMAND_BUS, EVENT_BUS, QUERY_BUS } from './tokens.js';
import type {
  CommandHandlerClass,
  EventHandlerClass,
  ICommand,
  IEvent,
  IQuery,
  QueryHandlerClass,
  SagaClass,
} from './types.js';

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
    CommandBusLifecycleService,
    {
      inject: [CommandBusLifecycleService],
      provide: COMMAND_BUS,
      useFactory: (service: unknown) => ({
        execute: (command: ICommand) => (service as CommandBusLifecycleService).execute(command),
      }),
    },
    QueryBusLifecycleService,
    {
      inject: [QueryBusLifecycleService],
      provide: QUERY_BUS,
      useFactory: (service: unknown) => ({
        execute: (query: IQuery<unknown>) => (service as QueryBusLifecycleService).execute(query),
      }),
    },
    CqrsSagaLifecycleService,
    CqrsEventBusService,
    {
      inject: [CqrsEventBusService],
      provide: EVENT_BUS,
      useFactory: (service: unknown) => ({
        publish: (event: IEvent) => (service as CqrsEventBusService).publish(event),
        publishAll: (events: readonly IEvent[]) => (service as CqrsEventBusService).publishAll(events),
      }),
    },
    ...collectOptionHandlerProviders(options),
  ];
}

export class CqrsModule {
  static forRoot(options: CqrsModuleOptions = {}): ModuleType {
    class CqrsModuleDefinition {}

    return defineModule(CqrsModuleDefinition, {
      exports: [
        CommandBusLifecycleService,
        QueryBusLifecycleService,
        CqrsEventBusService,
        COMMAND_BUS,
        QUERY_BUS,
        EVENT_BUS,
      ],
      global: true,
      imports: [EventBusModule.forRoot(options.eventBus)],
      providers: createCqrsProviders(options),
    });
  }
}
