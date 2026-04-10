import { KonektiError } from '@fluojs/core';

export class RouteConflictError extends KonektiError {
  constructor(message: string) {
    super(message, { code: 'ROUTE_CONFLICT' });
  }
}

export class HandlerNotFoundError extends KonektiError {
  constructor(message: string) {
    super(message, { code: 'HANDLER_NOT_FOUND' });
  }
}

export class RequestAbortedError extends KonektiError {
  constructor(message = 'Request aborted before response commit.') {
    super(message, { code: 'REQUEST_ABORTED' });
  }
}
