import type { HandlerDescriptor } from '../../types.js';
import type { CreateDispatcherOptions } from '../dispatcher.js';
import { createFastPathStats } from './debug-visibility.js';
import { compileFastPathEligibility, setHandlerFastPathEligibility } from './eligibility-checker.js';
import type { FastPathEligibility, FastPathStats } from './eligibility.js';

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
      return eligibilities.get(descriptor);
    },
    stats: createFastPathStats(compiledEligibilities),
  });
}
