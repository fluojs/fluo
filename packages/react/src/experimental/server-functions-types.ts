import type { MaybePromise } from '@fluojs/core';
import type { RequestContext } from '@fluojs/http';

/** Header required on experimental Server Function POST requests to force a non-simple request. */
export const REACT_SERVER_FUNCTION_REQUEST_HEADER = 'x-fluo-react-action';

/** Stable error codes emitted by the experimental Server Function transport boundary. */
export const REACT_SERVER_FUNCTION_ERROR_CODES = {
  actionNotFound: 'REACT_SERVER_FUNCTION_ACTION_NOT_FOUND',
  argumentSerializationFailed: 'REACT_SERVER_FUNCTION_ARGUMENT_SERIALIZATION_FAILED',
  csrfRejected: 'REACT_SERVER_FUNCTION_CSRF_REJECTED',
  invalidRequest: 'REACT_SERVER_FUNCTION_INVALID_REQUEST',
  originRejected: 'REACT_SERVER_FUNCTION_ORIGIN_REJECTED',
  payloadTooLarge: 'REACT_SERVER_FUNCTION_PAYLOAD_TOO_LARGE',
  resultSerializationFailed: 'REACT_SERVER_FUNCTION_RESULT_SERIALIZATION_FAILED',
  resultTooLarge: 'REACT_SERVER_FUNCTION_RESULT_TOO_LARGE',
  unsupportedMediaType: 'REACT_SERVER_FUNCTION_UNSUPPORTED_MEDIA_TYPE',
} as const;

/** Machine-readable code emitted by the experimental Server Function transport. */
export type ReactServerFunctionErrorCode =
  (typeof REACT_SERVER_FUNCTION_ERROR_CODES)[keyof typeof REACT_SERVER_FUNCTION_ERROR_CODES];

/** JSON-compatible value accepted as a Server Function argument or result. */
export type ReactServerFunctionValue =
  | null
  | boolean
  | number
  | string
  | readonly ReactServerFunctionValue[]
  | { readonly [key: string]: ReactServerFunctionValue };

/** Opaque, integrity-protected reference sent to a Server Function client. */
export type ReactServerFunctionReference = {
  /** Versioned signed reference value included in the action request body. */
  readonly value: string;
};

/** Server-side action executed after transport and identity validation. */
export type ReactServerFunctionHandler = (
  args: readonly ReactServerFunctionValue[],
  context: RequestContext,
) => MaybePromise<ReactServerFunctionValue>;

/** Options for creating an integrity-protected Server Function registry. */
export type ReactServerFunctionRegistryOptions = {
  /** Stable action ids mapped to server-only handlers. */
  readonly actions: Readonly<Record<string, ReactServerFunctionHandler>>;
  /** Exact HTTP(S) origins allowed to invoke the action endpoint. */
  readonly allowedOrigins: readonly string[];
  /** Runtime Web Crypto provider used for HMAC-SHA-256 reference integrity. */
  readonly crypto: Pick<Crypto, 'subtle'>;
  /** Maximum accepted request body size in bytes. Defaults to 64 KiB. */
  readonly maxBodyBytes?: number;
  /** Maximum serialized action result size in bytes. Defaults to 1 MiB. */
  readonly maxResultBytes?: number;
  /** Maximum nested argument or result depth. Defaults to 32. */
  readonly maxSerializationDepth?: number;
  /** Application-owned HMAC secret containing at least 32 bytes. */
  readonly secret: Uint8Array;
};

/** Successful value returned from a Server Function endpoint handler. */
export type ReactServerFunctionResponse = {
  /** Validated JSON-compatible action result. */
  readonly result: ReactServerFunctionValue;
};

/** Registry mounted by an application-owned ordinary fluo HTTP POST controller. */
export type ReactServerFunctionRegistry = {
  /**
   * Creates an integrity-protected client reference for one registered action.
   *
   * @param actionId Stable registered action id.
   * @returns An opaque reference suitable for client transport.
   */
  readonly createReference: (actionId: string) => Promise<ReactServerFunctionReference>;
  /**
   * Validates and invokes one action from the active fluo request context.
   *
   * @param context Existing request context supplied to an ordinary HTTP controller method.
   * @returns A JSON-compatible action response for normal dispatcher serialization.
   */
  readonly invoke: (context: RequestContext) => Promise<ReactServerFunctionResponse>;
};

/** Minimal application-owned fetch seam used by the experimental client callable. */
export type ReactServerFunctionFetch = (input: string, init: RequestInit) => Promise<Response>;

/** Options for creating one client-side callable Server Function reference. */
export type ReactServerFunctionClientOptions = {
  /** Explicit fluo HTTP endpoint that owns Server Function POST dispatch. */
  readonly endpoint: string;
  /** Application-owned fetch implementation used to perform the HTTP request. */
  readonly fetch: ReactServerFunctionFetch;
  /** Maximum accepted response body size in bytes. Defaults to 1 MiB. */
  readonly maxResponseBytes?: number;
  /** Maximum nested argument or result depth. Defaults to 32. */
  readonly maxSerializationDepth?: number;
  /** Signed reference issued by the matching server registry. */
  readonly reference: ReactServerFunctionReference;
};

/** Callable client proxy that transports serializable arguments to one explicit action endpoint. */
export type ReactServerFunctionClient = (
  ...args: readonly ReactServerFunctionValue[]
) => Promise<ReactServerFunctionValue>;
