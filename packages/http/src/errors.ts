import { KonektiError } from '@konekti/core';

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
