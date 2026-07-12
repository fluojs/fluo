import type { Token } from '@fluojs/core';

/** Marker interface for command messages handled by {@link CommandBus}. */
export interface ICommand {}

/** Marker interface for query messages whose response type is carried in the generic parameter. */
export interface IQuery<TResult = unknown> {
  readonly __queryResultType__?: TResult;
}

/** Marker interface for cloneable domain events published through the CQRS event bus. */
export interface IEvent {}

/** Contract implemented by classes decorated with {@link CommandHandler}. */
export interface ICommandHandler<TCommand extends ICommand, TResult = void> {
  /**
   * Executes one command instance.
   *
   * @param command Command payload to handle.
   * @param context Optional saga dispatch context to pass through nested CQRS calls.
   * @returns The handler result returned to the command bus caller.
   */
  execute(command: TCommand, context?: CqrsDispatchContext): TResult | Promise<TResult>;
}

/** Contract implemented by classes decorated with {@link QueryHandler}. */
export interface IQueryHandler<TQuery extends IQuery<TResult>, TResult = unknown> {
  /**
   * Executes one query instance.
   *
   * @param query Query payload to handle.
   * @param context Optional saga dispatch context to pass through nested CQRS calls.
   * @returns The query result returned to the caller.
   */
  execute(query: TQuery, context?: CqrsDispatchContext): TResult | Promise<TResult>;
}

/** Contract implemented by classes decorated with {@link EventHandler}. */
export interface IEventHandler<TEvent extends IEvent> {
  /**
   * Reacts to one isolated copy of a published event instance.
   *
   * @param event Event payload cloned for this handler before delegated event-bus publication.
   * @param context Optional saga dispatch context to pass through nested CQRS calls.
   * @returns A promise or void once side effects complete.
   */
  handle(event: TEvent, context?: CqrsDispatchContext): void | Promise<void>;
}

/** Contract implemented by classes decorated with {@link Saga}. */
export interface ISaga<TEvent extends IEvent = IEvent> {
  /**
   * Reacts to one isolated copy of an event and typically emits follow-up commands.
   *
   * @param event Event payload cloned for this saga route before delegated event-bus publication.
   * @param context Optional saga dispatch context to pass through nested CQRS calls.
   * @returns A promise or void once orchestration side effects complete.
   */
  handle(event: TEvent, context?: CqrsDispatchContext): void | Promise<void>;
}

/**
 * Opaque dispatch context used to preserve saga topology guards across nested CQRS calls.
 *
 * CQRS passes this value to command handlers, query handlers, event handlers, and sagas when a
 * nested dispatch chain is active. Application code should pass the value through unchanged to
 * nested `execute(...)`, `publish(...)`, or `publishAll(...)` calls. The context intentionally
 * exposes no public topology fields, and caller-shaped objects cannot supply trusted runtime state.
 */
export interface CqrsDispatchContext {}

/** Constructor type used to identify a command message class. */
export interface CommandType<TCommand extends ICommand = ICommand> {
  new (...args: never[]): TCommand;
}

/** Constructor type used to identify a query message class. */
export interface QueryType<TResult = unknown, TQuery extends IQuery<TResult> = IQuery<TResult>> {
  new (...args: never[]): TQuery;
}

/** Constructor type used to identify an event message class. */
export interface CqrsEventType<TEvent extends IEvent = IEvent> {
  new (...args: never[]): TEvent;
}

/** Class constructor accepted in {@link CqrsModuleOptions.commandHandlers}. */
export interface CommandHandlerClass {
  new (...args: never[]): object;
}

/** Class constructor accepted in {@link CqrsModuleOptions.queryHandlers}. */
export interface QueryHandlerClass {
  new (...args: never[]): object;
}

/** Class constructor accepted in {@link CqrsModuleOptions.eventHandlers}. */
export interface EventHandlerClass {
  new (...args: never[]): object;
}

/** Class constructor accepted in {@link CqrsModuleOptions.sagas}. */
export interface SagaClass {
  new (...args: never[]): object;
}

/** Metadata stored by {@link CommandHandler}. */
export interface CommandHandlerMetadata {
  commandType: CommandType;
}

/** Metadata stored by {@link QueryHandler}. */
export interface QueryHandlerMetadata {
  queryType: QueryType;
}

/** Metadata stored by {@link EventHandler}. */
export interface EventHandlerMetadata {
  eventType: CqrsEventType;
}

/** Metadata stored by {@link Saga}. */
export interface SagaMetadata {
  eventTypes: readonly CqrsEventType[];
}

/** Runtime descriptor for one discovered command handler. */
export interface CommandHandlerDescriptor {
  commandType: CommandType;
  moduleName: string;
  token: Token;
  targetType: Function;
}

/** Runtime descriptor for one discovered query handler. */
export interface QueryHandlerDescriptor {
  moduleName: string;
  queryType: QueryType;
  token: Token;
  targetType: Function;
}

/** Runtime descriptor for one discovered event handler. */
export interface EventHandlerDescriptor {
  eventType: CqrsEventType;
  moduleName: string;
  token: Token;
  targetType: Function;
}

/** Runtime descriptor for one discovered saga listener. */
export interface SagaDescriptor {
  eventType: CqrsEventType;
  moduleName: string;
  token: Token;
  targetType: Function;
}

/** Command dispatch facade exposed by the CQRS module. */
export interface CommandBus {
  /**
   * Executes one command by resolving its discovered singleton handler.
   *
   * @param command Command instance to dispatch.
   * @returns The handler result.
   */
  execute<TCommand extends ICommand, TResult = void>(command: TCommand, context?: CqrsDispatchContext): Promise<TResult>;
}

/** Query dispatch facade exposed by the CQRS module. */
export interface QueryBus {
  /**
   * Executes one query by resolving its discovered singleton handler.
   *
   * @param query Query instance to dispatch.
   * @returns The handler result.
   */
  execute<TQuery extends IQuery<TResult>, TResult = unknown>(query: TQuery, context?: CqrsDispatchContext): Promise<TResult>;
}

/** Event publishing facade exposed by the CQRS module. */
export interface CqrsEventBus {
  /**
   * Publishes one event to local CQRS handlers, sagas, and the underlying event bus.
   *
   * Local CQRS handlers and sagas receive isolated event copies. Delegated `@fluojs/event-bus`
   * subscribers receive the original event after local CQRS side effects complete.
   *
   * @param event Event instance to publish.
   * @param context Optional saga dispatch context to pass through nested CQRS calls.
   * @returns A promise that resolves once publication completes.
   */
  publish<TEvent extends IEvent>(event: TEvent, context?: CqrsDispatchContext): Promise<void>;
  /**
   * Publishes a batch of events in order.
   *
   * @param events Event instances to publish.
   * @param context Optional saga dispatch context to pass through nested CQRS calls.
   * @returns A promise that resolves once all events are published.
   */
  publishAll<TEvent extends IEvent>(events: readonly TEvent[], context?: CqrsDispatchContext): Promise<void>;
}
