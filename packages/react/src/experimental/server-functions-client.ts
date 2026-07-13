import {
  ReactServerFunctionClientError,
  ReactServerFunctionConfigurationError,
} from './server-functions-errors.js';
import {
  parseReactServerFunctionArguments,
  parseReactServerFunctionValue,
} from './server-functions-serialization.js';
import {
  REACT_SERVER_FUNCTION_ERROR_CODES,
  REACT_SERVER_FUNCTION_REQUEST_HEADER,
  type ReactServerFunctionClient,
  type ReactServerFunctionClientOptions,
} from './server-functions-types.js';

const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_MAX_SERIALIZATION_DEPTH = 32;

function parsePositiveInteger(value: number | undefined, fallback: number, name: string): number {
  const parsed = value ?? fallback;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ReactServerFunctionConfigurationError(`${name} must be a positive safe integer.`);
  }
  return parsed;
}

function parseJson(text: string, status: number): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ReactServerFunctionClientError('Server Function response was not valid JSON.', status, text);
    }
    throw error;
  }
}

function isResponseRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Creates a client callable that posts signed Server Function invocations to one explicit endpoint.
 *
 * @remarks
 * The callable sends `Content-Type: application/json`, the non-simple request marker, and
 * `credentials: 'same-origin'`. Browsers still own the `Origin` header; the matching server
 * registry rejects missing or unapproved origins.
 *
 * @param options Explicit endpoint, signed reference, fetch transport, and response limits.
 * @returns An async callable accepting only the documented JSON-compatible value subset.
 */
export function createReactServerFunctionClient(
  options: ReactServerFunctionClientOptions,
): ReactServerFunctionClient {
  if (options.endpoint.trim().length === 0) {
    throw new ReactServerFunctionConfigurationError('Server Function client endpoints must not be empty.');
  }
  if (options.reference.value.length === 0) {
    throw new ReactServerFunctionConfigurationError('Server Function client references must not be empty.');
  }
  const maxResponseBytes = parsePositiveInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    'maxResponseBytes',
  );
  const maxSerializationDepth = parsePositiveInteger(
    options.maxSerializationDepth,
    DEFAULT_MAX_SERIALIZATION_DEPTH,
    'maxSerializationDepth',
  );
  if (maxSerializationDepth > 128) {
    throw new ReactServerFunctionConfigurationError('maxSerializationDepth must not exceed 128.');
  }

  return async (...args) => {
    const parsedArgs = parseReactServerFunctionArguments(args, maxSerializationDepth);
    if (!parsedArgs.ok) {
      throw new ReactServerFunctionClientError(
        `${REACT_SERVER_FUNCTION_ERROR_CODES.argumentSerializationFailed}: ${parsedArgs.path} ${parsedArgs.reason}`,
        0,
      );
    }

    const response = await options.fetch(options.endpoint, {
      body: JSON.stringify({ action: options.reference.value, args: parsedArgs.value }),
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        [REACT_SERVER_FUNCTION_REQUEST_HEADER]: '1',
      },
      method: 'POST',
    });
    const responseText = await response.text();
    if (new TextEncoder().encode(responseText).byteLength > maxResponseBytes) {
      throw new ReactServerFunctionClientError('Server Function response exceeds the configured byte limit.', response.status);
    }
    const responseBody = parseJson(responseText, response.status);
    if (!response.ok) {
      throw new ReactServerFunctionClientError('Server Function request failed.', response.status, responseBody);
    }
    if (!isResponseRecord(responseBody) || !Object.hasOwn(responseBody, 'result')) {
      throw new ReactServerFunctionClientError('Server Function response is missing a result.', response.status, responseBody);
    }
    const result = parseReactServerFunctionValue(responseBody.result, maxSerializationDepth);
    if (!result.ok) {
      throw new ReactServerFunctionClientError(
        `Server Function response is not safely serializable: ${result.path} ${result.reason}`,
        response.status,
        responseBody,
      );
    }
    return result.value;
  };
}
