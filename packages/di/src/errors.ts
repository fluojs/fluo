import { KonektiCodeError, formatTokenName } from '@konekti/core';

export class InvalidProviderError extends KonektiCodeError {
  constructor(message: string) {
    super(message, 'INVALID_PROVIDER');
  }
}

export class ContainerResolutionError extends KonektiCodeError {
  constructor(message: string) {
    super(message, 'CONTAINER_RESOLUTION_ERROR');
  }
}

export class RequestScopeResolutionError extends KonektiCodeError {
  constructor(message: string) {
    super(message, 'REQUEST_SCOPE_RESOLUTION_ERROR');
  }
}

export class ScopeMismatchError extends KonektiCodeError {
  constructor(message: string) {
    super(message, 'SCOPE_MISMATCH');
  }
}

export class CircularDependencyError extends KonektiCodeError {
  constructor(chain: readonly unknown[]) {
    const path = chain.map((token) => formatTokenName(token)).join(' -> ');
    super(`Circular dependency detected: ${path}`, 'CIRCULAR_DEPENDENCY');
  }
}

export class DuplicateProviderError extends KonektiCodeError {
  constructor(token: unknown) {
    const name = formatTokenName(token);
    super(
      `Token "${name}" is already registered. Use container.override() for intentional overrides.`,
      'DUPLICATE_PROVIDER',
    );
  }
}
