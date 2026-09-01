import type { FrameworkRequest, RequestContext } from '../types.js';

const REQUEST_ABORTED_BY_RESPONSE_STREAM = Symbol('fluo.http.requestAbortedByResponseStream');

/**
 * Reports whether the adapter-provided request abort probes have fired.
 *
 * @param request Adapter-normalized request to inspect.
 * @returns Whether transport cancellation has been observed.
 */
export function isRequestAborted(request: FrameworkRequest): boolean {
  return request.isAborted?.() === true || request.signal?.aborted === true;
}

/**
 * Reports whether a request context was cancelled by transport or response-stream closure.
 *
 * @param context Request context to inspect.
 * @returns Whether cancellation has been observed.
 */
export function isRequestContextAborted(context: RequestContext): boolean {
  return isRequestAborted(context.request)
    || context.metadata[REQUEST_ABORTED_BY_RESPONSE_STREAM] === true;
}

/**
 * Marks a request context as cancelled by a response-stream disconnect.
 *
 * @param context Request context whose stream closed unexpectedly.
 */
export function markRequestContextAborted(context: RequestContext): void {
  context.metadata[REQUEST_ABORTED_BY_RESPONSE_STREAM] = true;
}
