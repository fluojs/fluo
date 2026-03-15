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

export class CircularDependencyError extends KonektiError {
  constructor(chain: readonly unknown[]) {
    const path = chain.map((t) => CircularDependencyError.tokenName(t)).join(' -> ');
    super(`Circular dependency detected: ${path}`, { code: 'CIRCULAR_DEPENDENCY' });
  }

  private static tokenName(token: unknown): string {
    if (typeof token === 'function' && 'name' in token && token.name) {
      return String(token.name);
    }

    if (typeof token === 'symbol') {
      return token.toString();
    }

    return String(token);
  }
}
