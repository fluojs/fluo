import type { Token } from '@konekti/core';

export interface ICommand {}

export interface IQuery<TResult = unknown> {
  readonly __queryResultType__?: TResult;
}

export interface IEvent {}

export interface ICommandHandler<TCommand extends ICommand, TResult = void> {
  execute(command: TCommand): TResult | Promise<TResult>;
}

export interface IQueryHandler<TQuery extends IQuery<TResult>, TResult = unknown> {
  execute(query: TQuery): TResult | Promise<TResult>;
}

export interface IEventHandler<TEvent extends IEvent> {
  handle(event: TEvent): void | Promise<void>;
}

export interface ISaga<TEvent extends IEvent = IEvent> {
  handle(event: TEvent): void | Promise<void>;
}

export interface CommandType<TCommand extends ICommand = ICommand> {
  new (...args: never[]): TCommand;
}

export interface QueryType<TResult = unknown, TQuery extends IQuery<TResult> = IQuery<TResult>> {
  new (...args: never[]): TQuery;
}

export interface CqrsEventType<TEvent extends IEvent = IEvent> {
  new (...args: never[]): TEvent;
}

export interface CommandHandlerClass {
  new (...args: never[]): object;
}

export interface QueryHandlerClass {
  new (...args: never[]): object;
}

export interface EventHandlerClass {
  new (...args: never[]): object;
}

export interface SagaClass {
  new (...args: never[]): object;
}

export interface CommandHandlerMetadata {
  commandType: CommandType;
}

export interface QueryHandlerMetadata {
  queryType: QueryType;
}

export interface EventHandlerMetadata {
  eventType: CqrsEventType;
}

export interface SagaMetadata {
  eventTypes: readonly CqrsEventType[];
}

export interface CommandHandlerDescriptor {
  commandType: CommandType;
  moduleName: string;
  token: Token;
  targetType: Function;
}

export interface QueryHandlerDescriptor {
  moduleName: string;
  queryType: QueryType;
  token: Token;
  targetType: Function;
}

export interface EventHandlerDescriptor {
  eventType: CqrsEventType;
  moduleName: string;
  token: Token;
  targetType: Function;
}

export interface SagaDescriptor {
  eventType: CqrsEventType;
  moduleName: string;
  token: Token;
  targetType: Function;
}

export interface CommandBus {
  execute<TCommand extends ICommand, TResult = void>(command: TCommand): Promise<TResult>;
}

export interface QueryBus {
  execute<TQuery extends IQuery<TResult>, TResult = unknown>(query: TQuery): Promise<TResult>;
}

export interface CqrsEventBus {
  publish<TEvent extends IEvent>(event: TEvent): Promise<void>;
  publishAll<TEvent extends IEvent>(events: readonly TEvent[]): Promise<void>;
}
