import { KonektiError } from '@fluojs/core';

/** Raised when the command bus cannot find a handler for the requested command type. */
export class CommandHandlerNotFoundException extends KonektiError {
  /**
   * Creates a missing-command-handler error.
   *
   * @param message Human-readable failure description.
   */
  constructor(message: string) {
    super(message, { code: 'CQRS_COMMAND_HANDLER_NOT_FOUND' });
  }
}

/** Raised when two different singleton providers claim the same command type. */
export class DuplicateCommandHandlerError extends KonektiError {
  /**
   * Creates a duplicate-command-handler error.
   *
   * @param message Human-readable failure description.
   */
  constructor(message: string) {
    super(message, { code: 'CQRS_DUPLICATE_COMMAND_HANDLER' });
  }
}

/** Raised when the query bus cannot find a handler for the requested query type. */
export class QueryHandlerNotFoundException extends KonektiError {
  /**
   * Creates a missing-query-handler error.
   *
   * @param message Human-readable failure description.
   */
  constructor(message: string) {
    super(message, { code: 'CQRS_QUERY_HANDLER_NOT_FOUND' });
  }
}

/** Raised when two different singleton providers claim the same query type. */
export class DuplicateQueryHandlerError extends KonektiError {
  /**
   * Creates a duplicate-query-handler error.
   *
   * @param message Human-readable failure description.
   */
  constructor(message: string) {
    super(message, { code: 'CQRS_DUPLICATE_QUERY_HANDLER' });
  }
}

/** Raised when conflicting event-handler registrations break the CQRS discovery contract. */
export class DuplicateEventHandlerError extends KonektiError {
  /**
   * Creates a duplicate-event-handler error.
   *
   * @param message Human-readable failure description.
   */
  constructor(message: string) {
    super(message, { code: 'CQRS_DUPLICATE_EVENT_HANDLER' });
  }
}

/** Raised when a saga throws a non-Konekti error while handling an event. */
export class SagaExecutionError extends KonektiError {
  /**
   * Creates a saga-execution error.
   *
   * @param message Human-readable failure description.
   */
  constructor(message: string) {
    super(message, { code: 'CQRS_SAGA_EXECUTION_FAILED' });
  }
}
