import type { FrameworkRequest, RequestContext } from '../types.js';
import { getCompatibleHttpSharedState } from '../shared-state.js';

const REQUEST_ABORTED_BY_RESPONSE_STREAM = Symbol('fluo.http.requestAbortedByResponseStream');
const authoritativeProbes = getCompatibleHttpSharedState(
  Symbol.for('fluo.http.authoritative-abort-probes'),
  () => new WeakMap<FrameworkRequest, AuthoritativeAbortProbe>(),
);

interface AuthoritativeAbortProbe {
  probe: () => boolean;
  signalIsAuthoritativelyObserved: boolean;
}

/**
 * Registers an adapter probe that observes the same cancellation source as its
 * lazy signal. Ordinary requests with independent probes/signals are not marked.
 *
 * @param request The exact adapter request owning both cancellation surfaces.
 * @param probe Probe that observes the lazy signal's cancellation source.
 * @param options Whether the probe authoritatively observes the request signal.
 */
export function registerAuthoritativeAbortProbe(
  request: FrameworkRequest,
  probe: () => boolean,
  options: { readonly signalIsAuthoritativelyObserved?: boolean } = {},
): void {
  authoritativeProbes.set(request, {
    probe,
    signalIsAuthoritativelyObserved: options.signalIsAuthoritativelyObserved === true,
  });
}

/**
 * Reports whether the adapter-provided request abort probes have fired.
 *
 * @param request Adapter-normalized request to inspect.
 * @returns Whether transport cancellation has been observed.
 */
export function isRequestAborted(request: FrameworkRequest): boolean {
  const authoritativeProbe = authoritativeProbes.get(request);
  if (authoritativeProbe && request.isAborted === authoritativeProbe.probe) {
    return authoritativeProbe.probe.call(request)
      || (!authoritativeProbe.signalIsAuthoritativelyObserved && request.signal?.aborted === true);
  }
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
