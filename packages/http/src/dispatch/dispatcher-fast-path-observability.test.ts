import { Container } from '@fluojs/di';
import { expect, it } from 'vitest';
import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  FAST_PATH_ELIGIBILITY_SYMBOL,
  Get,
  getDispatcherFastPathStats,
} from '../index.js';
import type { HandlerDescriptor } from '../types.js';

function requireDescriptor(descriptor: HandlerDescriptor | undefined): HandlerDescriptor {
  if (!descriptor) {
    throw new Error('Expected one handler descriptor.');
  }

  return descriptor;
}

it('exposes frozen eligibility snapshots without annotating shared handler descriptors', () => {
  // Given: one mapping observed through a configured dispatcher.
  @Controller('/eligibility-observability')
  class EligibilityObservabilityController {
    @Get('/')
    getValue() {
      return { ok: true };
    }
  }

  const root = new Container().register(EligibilityObservabilityController);
  const handlerMapping = createHandlerMapping([{ controllerToken: EligibilityObservabilityController }]);
  const dispatcher = createDispatcher({ handlerMapping, rootContainer: root });
  const sharedDescriptor = requireDescriptor(handlerMapping.descriptors[0]);

  // When: diagnostics request independent route and stats snapshots.
  const firstDescribedDescriptor = requireDescriptor(dispatcher.describeRoutes?.()[0]);
  const secondDescribedDescriptor = requireDescriptor(dispatcher.describeRoutes?.()[0]);
  const firstEligibility = Reflect.get(firstDescribedDescriptor, FAST_PATH_ELIGIBILITY_SYMBOL);
  const secondEligibility = Reflect.get(secondDescribedDescriptor, FAST_PATH_ELIGIBILITY_SYMBOL);
  const stats = getDispatcherFastPathStats(dispatcher);

  if (typeof firstEligibility !== 'object' || firstEligibility === null) {
    throw new Error('Expected fast-path eligibility metadata on described routes.');
  }
  if (typeof secondEligibility !== 'object' || secondEligibility === null) {
    throw new Error('Expected fast-path eligibility metadata on described routes.');
  }
  if (!stats) {
    throw new Error('Expected dispatcher fast-path statistics.');
  }

  // Then: shared mapping state stays untouched and every observable view is immutable.
  expect({
    describedEligibilityFrozen: Object.isFrozen(firstEligibility),
    describedSnapshotsAreIndependent: firstEligibility !== secondEligibility,
    sharedEligibility: Reflect.get(sharedDescriptor, FAST_PATH_ELIGIBILITY_SYMBOL),
    statsFrozen: Object.isFrozen(stats),
    statsRouteFrozen: Object.isFrozen(stats.routes[0]),
    statsRoutesFrozen: Object.isFrozen(stats.routes),
  }).toEqual({
    describedEligibilityFrozen: true,
    describedSnapshotsAreIndependent: true,
    sharedEligibility: undefined,
    statsFrozen: true,
    statsRouteFrozen: true,
    statsRoutesFrozen: true,
  });
});
