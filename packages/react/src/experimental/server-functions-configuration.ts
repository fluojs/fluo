import { ReactServerFunctionConfigurationError } from './server-functions-errors.js';
import { isReactServerFunctionActionId } from './server-functions-reference.js';
import type {
  ReactServerFunctionHandler,
  ReactServerFunctionRegistryOptions,
} from './server-functions-types.js';

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_MAX_RESULT_BYTES = 1024 * 1024;
const DEFAULT_MAX_SERIALIZATION_DEPTH = 32;

/** Validated immutable configuration consumed by the Server Function request boundary. */
export type ReactServerFunctionRegistryConfiguration = {
  readonly actions: Readonly<Record<string, ReactServerFunctionHandler>>;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly maxBodyBytes: number;
  readonly maxResultBytes: number;
  readonly maxSerializationDepth: number;
};

function configurationError(message: string): never {
  throw new ReactServerFunctionConfigurationError(message);
}

function parsePositiveInteger(value: number | undefined, fallback: number, name: string): number {
  const parsed = value ?? fallback;
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : configurationError(`${name} must be a positive safe integer.`);
}

function parseSerializationDepth(value: number | undefined): number {
  const parsed = parsePositiveInteger(value, DEFAULT_MAX_SERIALIZATION_DEPTH, 'maxSerializationDepth');
  return parsed <= 128
    ? parsed
    : configurationError('maxSerializationDepth must not exceed 128.');
}

function normalizeOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch (error) {
    if (error instanceof TypeError) {
      return configurationError(`Server Function allowed origin "${origin}" is not a valid URL origin.`);
    }
    throw error;
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== origin) {
    return configurationError(`Server Function allowed origin "${origin}" must be an exact HTTP(S) origin.`);
  }
  return parsed.origin;
}

/**
 * Parses and snapshots caller-owned registry options before references or requests are handled.
 *
 * @param options Untrusted registry configuration supplied at the application boundary.
 * @returns Validated actions, origins, and transport limits.
 */
export function createReactServerFunctionRegistryConfiguration(
  options: ReactServerFunctionRegistryOptions,
): ReactServerFunctionRegistryConfiguration {
  const actions: Record<string, ReactServerFunctionHandler> = {};
  Object.setPrototypeOf(actions, null);

  for (const [actionId, handler] of Object.entries(options.actions)) {
    if (!isReactServerFunctionActionId(actionId)) {
      return configurationError(
        `Server Function action id "${actionId}" must match [A-Za-z0-9_-] and contain 1 to 128 characters.`,
      );
    }
    if (typeof handler !== 'function') {
      return configurationError(`Server Function action "${actionId}" must map to a handler function.`);
    }
    actions[actionId] = handler;
  }
  if (Object.keys(actions).length === 0) {
    return configurationError('Server Function registries must contain at least one action.');
  }

  const origins = new Set(options.allowedOrigins.map(normalizeOrigin));
  if (origins.size === 0) {
    return configurationError('Server Function registries must allow at least one exact HTTP(S) origin.');
  }

  return {
    actions: Object.freeze(actions),
    allowedOrigins: origins,
    maxBodyBytes: parsePositiveInteger(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, 'maxBodyBytes'),
    maxResultBytes: parsePositiveInteger(options.maxResultBytes, DEFAULT_MAX_RESULT_BYTES, 'maxResultBytes'),
    maxSerializationDepth: parseSerializationDepth(options.maxSerializationDepth),
  };
}
