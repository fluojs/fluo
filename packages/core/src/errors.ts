export interface KonektiErrorOptions {
  code?: string;
  cause?: unknown;
  meta?: Record<string, unknown>;
}

export class KonektiError extends Error {
  readonly code: string;
  readonly meta?: Record<string, unknown>;

  constructor(message: string, options: KonektiErrorOptions = {}) {
    super(message, options.cause instanceof Error ? { cause: options.cause } : undefined);

    this.name = new.target.name;
    this.code = options.code ?? 'KONEKTI_ERROR';
    this.meta = options.meta;

    if (!(options.cause instanceof Error) && options.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        configurable: true,
        enumerable: false,
        value: options.cause,
        writable: true,
      });
    }
  }
}

export class InvariantError extends KonektiError {
  constructor(message: string, options: Omit<KonektiErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'INVARIANT_ERROR' });
  }
}

export abstract class KonektiCodeError extends KonektiError {
  constructor(message: string, code: string, options: Omit<KonektiErrorOptions, 'code'> = {}) {
    super(message, { ...options, code });
  }
}

export function formatTokenName(token: unknown): string {
  if (typeof token === 'function' && 'name' in token && token.name) {
    return String(token.name);
  }

  if (typeof token === 'symbol') {
    return token.toString();
  }

  return String(token);
}
