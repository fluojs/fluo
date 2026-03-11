import { KonektiError } from '@konekti/core';

export class InvalidProviderError extends KonektiError {
  constructor(message: string) {
    super(message, { code: 'INVALID_PROVIDER' });
  }
}

export class ContainerResolutionError extends KonektiError {
  constructor(message: string) {
    super(message, { code: 'CONTAINER_RESOLUTION_ERROR' });
  }
}

export class RequestScopeResolutionError extends KonektiError {
  constructor(message: string) {
    super(message, { code: 'REQUEST_SCOPE_RESOLUTION_ERROR' });
  }
}
