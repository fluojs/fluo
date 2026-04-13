import { FluoError } from '@fluojs/core';

/** Raised when the command bus cannot find a handler for the requested command type. */
export class CommandHandlerNotFoundException extends FluoError {
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
export class DuplicateCommandHandlerError extends FluoError {
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
export class QueryHandlerNotFoundException extends FluoError {
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
export class DuplicateQueryHandlerError extends FluoError {
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
export class DuplicateEventHandlerError extends FluoError {
  /**
   * Creates a duplicate-event-handler error.
   *
   * @param message Human-readable failure description.
   */
  constructor(message: string) {
    super(message, { code: 'CQRS_DUPLICATE_EVENT_HANDLER' });
  }
}

/** Raised when a saga throws a non-Fluo error while handling an event. */
export class SagaExecutionError extends FluoError {
  /**
   * Creates a saga-execution error.
   *
   * @param message Human-readable failure description.
   */
  constructor(message: string) {
    super(message, { code: 'CQRS_SAGA_EXECUTION_FAILED' });
  }
}

/** Raised when saga orchestration re-enters an unsafe in-process topology. */
export class SagaTopologyError extends FluoError {
  /**
   * Creates a saga-topology guard error.
   *
   * @param message Human-readable failure description.
   */
  constructor(message: string) {
    super(message, { code: 'CQRS_SAGA_UNSAFE_TOPOLOGY' });
  }
}
