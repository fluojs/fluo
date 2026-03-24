import { KonektiError } from '@konekti/core';

export class CommandHandlerNotFoundException extends KonektiError {
  constructor(message: string) {
    super(message, { code: 'CQRS_COMMAND_HANDLER_NOT_FOUND' });
  }
}

export class DuplicateCommandHandlerError extends KonektiError {
  constructor(message: string) {
    super(message, { code: 'CQRS_DUPLICATE_COMMAND_HANDLER' });
  }
}

export class QueryHandlerNotFoundException extends KonektiError {
  constructor(message: string) {
    super(message, { code: 'CQRS_QUERY_HANDLER_NOT_FOUND' });
  }
}

export class DuplicateQueryHandlerError extends KonektiError {
  constructor(message: string) {
    super(message, { code: 'CQRS_DUPLICATE_QUERY_HANDLER' });
  }
}

export class DuplicateEventHandlerError extends KonektiError {
  constructor(message: string) {
    super(message, { code: 'CQRS_DUPLICATE_EVENT_HANDLER' });
  }
}

export class SagaExecutionError extends KonektiError {
  constructor(message: string) {
    super(message, { code: 'CQRS_SAGA_EXECUTION_FAILED' });
  }
}

export const CommandHandlerNotFoundError = CommandHandlerNotFoundException;
export const QueryHandlerNotFoundError = QueryHandlerNotFoundException;
