import type { Token } from '@fluojs/core';
import type { ApplicationLogger } from '@fluojs/runtime';

import type { DiscoveryCandidate } from '../discovery.js';
import { getSagaMetadata } from '../metadata.js';
import type { CqrsEventType, SagaDescriptor } from '../types.js';

/**
 * Discovers singleton saga registrations by provider-token identity.
 *
 * @param candidates Provider registrations compiled from the application module graph.
 * @param logger Application logger used for non-singleton discovery warnings.
 * @returns Saga descriptors grouped by event type in discovery order.
 */
export function discoverSagaDescriptors(
  candidates: readonly DiscoveryCandidate[],
  logger: ApplicationLogger,
): Map<CqrsEventType, SagaDescriptor[]> {
  const descriptorsByEvent = new Map<CqrsEventType, SagaDescriptor[]>();
  const seenEventTypesByToken = new Map<Token, Set<CqrsEventType>>();

  for (const candidate of candidates) {
    const metadata = getSagaMetadata(candidate.targetType);

    if (!metadata) {
      continue;
    }

    if (candidate.scope !== 'singleton') {
      logger.warn(
        `${candidate.targetType.name} in module ${candidate.moduleName} declares @Saga() but is registered with ${candidate.scope} scope. Sagas are registered only for singleton providers.`,
        'CqrsSagaLifecycleService',
      );
      continue;
    }

    const seenEventTypes = seenEventTypesByToken.get(candidate.token) ?? new Set<CqrsEventType>();

    for (const eventType of metadata.eventTypes) {
      if (seenEventTypes.has(eventType)) {
        continue;
      }

      seenEventTypes.add(eventType);
      const descriptors = descriptorsByEvent.get(eventType) ?? [];
      descriptors.push({
        eventType,
        moduleName: candidate.moduleName,
        targetType: candidate.targetType,
        token: candidate.token,
      });
      descriptorsByEvent.set(eventType, descriptors);
    }

    seenEventTypesByToken.set(candidate.token, seenEventTypes);
  }

  return descriptorsByEvent;
}
