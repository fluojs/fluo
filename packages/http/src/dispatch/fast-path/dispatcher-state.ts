import { getSecurityHeadersApplier } from '../../middleware/security-headers.js';
import type { HandlerDescriptor } from '../../types.js';
import type { CreateDispatcherOptions } from '../dispatcher.js';
import { createFastPathStats } from './debug-visibility.js';
import { compileFastPathEligibility, setHandlerFastPathEligibility } from './eligibility-checker.js';
import type { FastPathEligibility, FastPathStats } from './eligibility.js';

/** Dispatcher-owned execution decisions and immutable diagnostic snapshots. */
export interface DispatcherFastPathState {
  readonly stats: FastPathStats;
  describeRoutes(): readonly HandlerDescriptor[];
  getEligibility(descriptor: HandlerDescriptor): FastPathEligibility | undefined;
}

function cloneHandlerDescriptor(descriptor: HandlerDescriptor): HandlerDescriptor {
  return {
    ...descriptor,
    metadata: {
      ...descriptor.metadata,
      moduleMiddleware: [...descriptor.metadata.moduleMiddleware],
      pathParams: [...descriptor.metadata.pathParams],
    },
    route: {
      ...descriptor.route,
      guards: descriptor.route.guards ? [...descriptor.route.guards] : undefined,
      headers: descriptor.route.headers?.map((header) => ({ ...header })),
      interceptors: descriptor.route.interceptors ? [...descriptor.route.interceptors] : undefined,
      produces: descriptor.route.produces ? [...descriptor.route.produces] : undefined,
      redirect: descriptor.route.redirect ? { ...descriptor.route.redirect } : undefined,
    },
  };
}

/**
 * Compiles route eligibility owned by one dispatcher and rechecks mutable middleware.
 *
 * @param descriptors Routes registered with this dispatcher.
 * @param options Dispatcher features used to select an execution path.
 * @param adapter Adapter identifier included in diagnostics.
 * @returns Dispatcher-local route decisions and diagnostic snapshots.
 */
export function createDispatcherFastPathState(
  descriptors: readonly HandlerDescriptor[],
  options: CreateDispatcherOptions,
  adapter: string,
): DispatcherFastPathState {
  const eligibilities = new WeakMap<HandlerDescriptor, FastPathEligibility>();
  const compiledEligibilities: FastPathEligibility[] = [];

  for (const descriptor of descriptors) {
    const { eligibility } = compileFastPathEligibility(descriptor, options, adapter);
    eligibilities.set(descriptor, eligibility);
    compiledEligibilities.push(eligibility);
  }

  return Object.freeze({
    describeRoutes() {
      return descriptors.map((descriptor) => {
        const cloned = cloneHandlerDescriptor(descriptor);
        const eligibility = eligibilities.get(descriptor);

        if (eligibility) {
          setHandlerFastPathEligibility(cloned, eligibility);
          eligibilities.set(cloned, eligibility);
        }

        return cloned;
      });
    },
    getEligibility(descriptor: HandlerDescriptor) {
      const eligibility = eligibilities.get(descriptor);

      // Middleware objects remain mutable after bootstrap. Never execute a replaced
      // built-in handler through its original framework-only capability.
      if (eligibility?.executionPath === 'fast'
        && ((options.appMiddleware?.length ?? 0) > 1
          || options.appMiddleware?.some((definition) => getSecurityHeadersApplier(definition) === undefined))) {
        return compileFastPathEligibility(descriptor, options, adapter).eligibility;
      }

      return eligibility;
    },
    stats: createFastPathStats(compiledEligibilities),
  });
}
