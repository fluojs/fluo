import { HttpException, type RequestContext } from '@fluojs/http';

import {
  createReactServerFunctionRegistryConfiguration,
  type ReactServerFunctionRegistryConfiguration,
} from './server-functions-configuration.js';
import { ReactServerFunctionConfigurationError } from './server-functions-errors.js';
import { createReactServerFunctionReferenceSigner } from './server-functions-reference.js';
import {
  measureReactServerFunctionValue,
  parseReactServerFunctionArguments,
  parseReactServerFunctionValue,
} from './server-functions-serialization.js';
import {
  REACT_SERVER_FUNCTION_ERROR_CODES,
  REACT_SERVER_FUNCTION_REQUEST_HEADER,
  type ReactServerFunctionRegistry,
  type ReactServerFunctionRegistryOptions,
} from './server-functions-types.js';

type TransportErrorOptions = {
  readonly code: string;
  readonly message: string;
  readonly meta?: Record<string, unknown>;
  readonly status: number;
};

function getHeader(context: RequestContext, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [headerName, value] of Object.entries(context.request.headers)) {
    if (headerName.toLowerCase() === target && typeof value === 'string') {
      return value;
    }
  }
  return undefined;
}

function transportError(options: TransportErrorOptions): HttpException {
  return new HttpException(options.status, options.message, {
    code: options.code,
    ...(options.meta === undefined ? {} : { meta: options.meta }),
  });
}

function measureRequestBody(context: RequestContext): number | undefined {
  if (context.request.rawBody !== undefined) {
    return context.request.rawBody.byteLength;
  }
  try {
    const serialized = JSON.stringify(context.request.body);
    return serialized === undefined ? undefined : new TextEncoder().encode(serialized).byteLength;
  } catch (error) {
    if (error instanceof Error) {
      return undefined;
    }
    throw error;
  }
}

function validateTransport(context: RequestContext, configuration: ReactServerFunctionRegistryConfiguration): void {
  const bodySize = measureRequestBody(context);
  if (bodySize !== undefined && bodySize > configuration.maxBodyBytes) {
    throw transportError({
      code: REACT_SERVER_FUNCTION_ERROR_CODES.payloadTooLarge,
      message: 'Server Function request body exceeds the configured byte limit.',
      meta: { maxBodyBytes: configuration.maxBodyBytes },
      status: 413,
    });
  }

  const contentType = getHeader(context, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw transportError({
      code: REACT_SERVER_FUNCTION_ERROR_CODES.unsupportedMediaType,
      message: 'Server Function requests require Content-Type application/json.',
      status: 415,
    });
  }
  if (getHeader(context, REACT_SERVER_FUNCTION_REQUEST_HEADER) !== '1') {
    throw transportError({
      code: REACT_SERVER_FUNCTION_ERROR_CODES.csrfRejected,
      message: 'Server Function request marker is missing or invalid.',
      status: 403,
    });
  }
  const origin = getHeader(context, 'origin');
  if (origin === undefined || !configuration.allowedOrigins.has(origin)) {
    throw transportError({
      code: REACT_SERVER_FUNCTION_ERROR_CODES.originRejected,
      message: 'Server Function request origin is not allowed.',
      status: 403,
    });
  }
}

function isRequestRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseRequestBody(body: unknown): { readonly action: string; readonly args: unknown } {
  if (!isRequestRecord(body)) {
    throw transportError({
      code: REACT_SERVER_FUNCTION_ERROR_CODES.invalidRequest,
      message: 'Server Function request body must be a JSON object.',
      status: 400,
    });
  }
  const keys = Object.keys(body).sort();
  if (keys.length !== 2 || keys[0] !== 'action' || keys[1] !== 'args' || typeof body.action !== 'string') {
    throw transportError({
      code: REACT_SERVER_FUNCTION_ERROR_CODES.invalidRequest,
      message: 'Server Function request body must contain only string action and array args fields.',
      status: 400,
    });
  }
  return { action: body.action, args: body.args };
}

/**
 * Creates an experimental signed Server Function registry for an application-owned fluo POST route.
 *
 * @remarks
 * The returned registry does not register a router. Mount `invoke(context)` in an ordinary
 * `@Controller(...)` and `@Post(...)` method so fluo middleware, guards, interceptors, request
 * scopes, observers, and error serialization remain authoritative.
 *
 * @param options Explicit actions, allowed origins, Web Crypto provider, HMAC secret, and limits.
 * @returns A registry that issues signed references and invokes validated action calls.
 */
export function createReactServerFunctionRegistry(
  options: ReactServerFunctionRegistryOptions,
): ReactServerFunctionRegistry {
  const configuration = createReactServerFunctionRegistryConfiguration(options);
  const signer = createReactServerFunctionReferenceSigner(options.crypto, options.secret);

  return Object.freeze({
    async createReference(actionId) {
      if (!Object.hasOwn(configuration.actions, actionId)) {
        throw new ReactServerFunctionConfigurationError(
          `Cannot create a Server Function reference for unknown action "${actionId}".`,
        );
      }
      return signer.createReference(actionId);
    },
    async invoke(context) {
      validateTransport(context, configuration);
      const request = parseRequestBody(context.request.body);
      const actionId = await signer.verifyReference(request.action);
      const handler = actionId === undefined ? undefined : configuration.actions[actionId];
      if (handler === undefined) {
        throw transportError({
          code: REACT_SERVER_FUNCTION_ERROR_CODES.actionNotFound,
          message: 'Server Function action was not found.',
          status: 404,
        });
      }

      const args = parseReactServerFunctionArguments(request.args, configuration.maxSerializationDepth);
      if (!args.ok) {
        throw transportError({
          code: REACT_SERVER_FUNCTION_ERROR_CODES.argumentSerializationFailed,
          message: 'Server Function arguments are not safely serializable.',
          meta: { path: args.path, reason: args.reason },
          status: 400,
        });
      }

      const result = parseReactServerFunctionValue(
        await handler(args.value, context),
        configuration.maxSerializationDepth,
      );
      if (!result.ok) {
        throw transportError({
          code: REACT_SERVER_FUNCTION_ERROR_CODES.resultSerializationFailed,
          message: 'Server Function result is not safely serializable.',
          meta: { path: result.path, reason: result.reason },
          status: 500,
        });
      }
      const resultBytes = measureReactServerFunctionValue(result.value);
      if (resultBytes > configuration.maxResultBytes) {
        throw transportError({
          code: REACT_SERVER_FUNCTION_ERROR_CODES.resultTooLarge,
          message: 'Server Function result exceeds the configured byte limit.',
          meta: { maxResultBytes: configuration.maxResultBytes },
          status: 500,
        });
      }
      return { result: result.value };
    },
  });
}
