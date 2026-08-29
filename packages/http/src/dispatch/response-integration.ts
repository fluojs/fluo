import type {
  FrameworkRequest,
  FrameworkResponse,
  HandlerDescriptor,
  RequestContext,
} from '../types.js';

/** Shared response-entry brand recognized by the HTTP success-response policy. */
export const FRAMEWORK_RESPONSE_WRITER = Symbol.for('fluo.http.responseWriter');

/** Request-local metadata key for response-value finalization before response writing. */
export const FRAMEWORK_RESPONSE_VALUE_FINALIZER = Symbol.for('fluo.http.responseValueFinalizer');

/** Context supplied when an integration writes a successful framework response. */
export type FrameworkResponseWriterContext = {
  readonly applySuccessResponseMetadata: () => void;
  readonly handler: HandlerDescriptor;
  readonly request: FrameworkRequest;
  readonly requestContext: RequestContext;
  readonly response: FrameworkResponse;
};

/** Writer installed by an HTTP integration on one response entry. */
export type FrameworkResponseWriter = (
  context: FrameworkResponseWriterContext,
) => ReturnType<FrameworkResponse['send']> | void;

/** Context supplied when an integration finalizes a handler result before response writing. */
export type FrameworkResponseValueFinalizerContext = {
  readonly handler: HandlerDescriptor;
  readonly request: FrameworkRequest;
  readonly requestContext: RequestContext;
  readonly response: FrameworkResponse;
  readonly value: unknown;
};

/**
 * Request-local transformation applied before the HTTP policy selects a response writer.
 *
 * Finalizers may resolve asynchronously. The dispatcher awaits their results and
 * routes thrown errors and rejections through its normal error policy.
 */
export type FrameworkResponseValueFinalizer = (
  context: FrameworkResponseValueFinalizerContext,
) => unknown | Promise<unknown>;

/**
 * Brands a response entry with an integration-owned writer.
 *
 * @param entry Response entry returned by an HTTP handler.
 * @param writer Writer invoked by the shared success-response policy.
 * @returns The branded response entry.
 */
export function registerFrameworkResponseWriter<Entry extends object>(
  entry: Entry,
  writer: FrameworkResponseWriter,
): Entry {
  Object.defineProperty(entry, FRAMEWORK_RESPONSE_WRITER, {
    enumerable: false,
    value: writer,
  });

  return entry;
}

/**
 * Registers a request-local handler-result finalizer for an HTTP integration.
 *
 * @param context Active request context whose metadata carries the finalizer.
 * @param finalizer Transformation applied before response-writer selection.
 *
 * @remarks
 * Multiple registrations compose in registration order. Each later finalizer
 * receives the previous finalizer's resolved value, and any thrown error or
 * rejection is handled by the dispatcher's existing error policy.
 */
export function registerFrameworkResponseValueFinalizer(
  context: Pick<RequestContext, 'metadata'>,
  finalizer: FrameworkResponseValueFinalizer,
): void {
  const existingFinalizer = context.metadata[FRAMEWORK_RESPONSE_VALUE_FINALIZER];

  if (typeof existingFinalizer !== 'function') {
    context.metadata[FRAMEWORK_RESPONSE_VALUE_FINALIZER] = finalizer;
    return;
  }

  const previousFinalizer = existingFinalizer as FrameworkResponseValueFinalizer;
  context.metadata[FRAMEWORK_RESPONSE_VALUE_FINALIZER] = async (
    finalizerContext: FrameworkResponseValueFinalizerContext,
  ) => (
    finalizer({
      ...finalizerContext,
      value: await previousFinalizer(finalizerContext),
    })
  );
}
