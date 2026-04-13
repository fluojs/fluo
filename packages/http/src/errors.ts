import { FluoError } from '@fluojs/core';

/**
 * Error thrown when two or more routes share the same path and method pattern.
 */
export class RouteConflictError extends FluoError {
  constructor(message: string) {
    super(message, { code: 'ROUTE_CONFLICT' });
  }
}

export class InvalidRoutePathError extends FluoError {
  constructor(message: string) {
    super(message, { code: 'INVALID_ROUTE_PATH' });
  }
}

/**
 * Error thrown when no handler matches the incoming request path or method.
 */
export class HandlerNotFoundError extends FluoError {
  constructor(message: string) {
    super(message, { code: 'HANDLER_NOT_FOUND' });
  }
}

/**
 * Error thrown when a request is aborted by the client before processing completes.
 */
export class RequestAbortedError extends FluoError {
  constructor(message = 'Request aborted before response commit.') {
    super(message, { code: 'REQUEST_ABORTED' });
  }
}
