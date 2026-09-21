const fluoErrorContractKey = Symbol.for('fluo.error.contract');
const FLUO_ERROR_CONTRACT_VERSION = 1;

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Applies the shared, versioned error identity used across compatible duplicate package copies.
 *
 * @param error Error instance owned by a public fluo package.
 * @param owner Package name that owns validation of the error's additional fields.
 */
export function setFluoErrorContract(error: Error, owner: `@fluojs/${string}`): void {
  Object.defineProperty(error, fluoErrorContractKey, {
    configurable: true,
    enumerable: false,
    value: Object.freeze({ owner, version: FLUO_ERROR_CONTRACT_VERSION }),
    writable: false,
  });
}

/**
 * Checks the shared error identity and required common fields without relying on constructor identity.
 *
 * @param value Candidate thrown value.
 * @param owner Optional package owner required by a package-specific predicate.
 * @returns `true` for a compatible branded error with valid common fields.
 */
export function isFluoError(value: unknown, owner?: `@fluojs/${string}`): value is FluoError {
  if (!(value instanceof Error) || !isRecord(value)) return false;

  const contract = value[fluoErrorContractKey];
  return isRecord(contract)
    && contract.version === FLUO_ERROR_CONTRACT_VERSION
    && typeof contract.owner === 'string'
    && (owner === undefined || contract.owner === owner)
    && typeof value.name === 'string'
    && typeof value.message === 'string'
    && typeof value.code === 'string'
    && (value.meta === undefined || (isRecord(value.meta) && !Array.isArray(value.meta)));
}

/**
 * Options for creating a {@link FluoError}.
 */
export interface FluoErrorOptions {
  /** Stable error code for programmatic identification. */
  code?: string;
  /** Original error that caused this failure. */
  cause?: unknown;
  /** Additional structured metadata for diagnostics. */
  meta?: Record<string, unknown>;
}

/**
 * Base error class for all fluo framework errors.
 */
export class FluoError extends Error {
  /** Stable error code. */
  readonly code: string;
  /** Additional structured metadata. */
  readonly meta?: Record<string, unknown>;

  /**
   * Creates a new FluoError.
   *
   * @param message Human-readable error message.
   * @param options Optional error configuration including `code`, `cause`, and `meta`.
   */
  constructor(message: string, options: FluoErrorOptions = {}) {
    super(message, options.cause instanceof Error ? { cause: options.cause } : undefined);

    this.name = new.target.name;
    this.code = options.code ?? 'FLUO_ERROR';
    setFluoErrorContract(this, '@fluojs/core');
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

/**
 * Error thrown when a system invariant is violated.
 */
export class InvariantError extends FluoError {
  /**
   * Creates an invariant error.
   *
   * @param message Human-readable description of the violation.
   * @param options Optional error configuration.
   */
  constructor(message: string, options: Omit<FluoErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'INVARIANT_ERROR' });
  }
}

/**
 * Abstract base class for errors that require a specific error code.
 */
export abstract class FluoCodeError extends FluoError {
  /**
   * Creates a code-specific error.
   *
   * @param message Human-readable error message.
   * @param code Programmatic error code.
   * @param options Optional error configuration.
   */
  constructor(message: string, code: string, options: Omit<FluoErrorOptions, 'code'> = {}) {
    super(message, { ...options, code });
  }
}

/**
 * Formats a DI token into a human-readable string for error messages.
 *
 * @param token The token to format.
 * @returns A string representation of the token.
 */
export function formatTokenName(token: unknown): string {
  if (typeof token === 'function' && 'name' in token && token.name) {
    return String(token.name);
  }

  if (typeof token === 'symbol') {
    return token.toString();
  }

  return String(token);
}
