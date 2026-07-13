import type { Token } from '@fluojs/core';
import type { ApplicationLogger } from '@fluojs/runtime';

import type { DiscoveryCandidate } from '../discovery.js';
import { getEventHandlerMetadata } from '../metadata.js';
import type { CqrsEventType, EventHandlerDescriptor } from '../types.js';

/**
 * Discovers singleton event-handler registrations by provider-token identity.
 *
 * @param candidates Provider registrations compiled from the application module graph.
 * @param logger Application logger used for non-singleton discovery warnings.
 * @returns Event-handler descriptors in discovery order.
 */
export function discoverEventHandlerDescriptors(
  candidates: readonly DiscoveryCandidate[],
  logger: ApplicationLogger,
): EventHandlerDescriptor[] {
  const descriptors: EventHandlerDescriptor[] = [];
  const seenEventTypesByToken = new Map<Token, Set<CqrsEventType>>();

  for (const candidate of candidates) {
    const metadata = getEventHandlerMetadata(candidate.targetType);

    if (!metadata) {
      continue;
    }

    if (candidate.scope !== 'singleton') {
      logger.warn(
        `${candidate.targetType.name} in module ${candidate.moduleName} declares @EventHandler() but is registered with ${candidate.scope} scope. Event handlers are registered only for singleton providers.`,
        'CqrsEventBusService',
      );
      continue;
    }

    const seenEventTypes = seenEventTypesByToken.get(candidate.token) ?? new Set<CqrsEventType>();

    if (seenEventTypes.has(metadata.eventType)) {
      continue;
    }

    seenEventTypes.add(metadata.eventType);
    seenEventTypesByToken.set(candidate.token, seenEventTypes);
    descriptors.push({
      eventType: metadata.eventType,
      moduleName: candidate.moduleName,
      targetType: candidate.targetType,
      token: candidate.token,
    });
  }

  return descriptors;
}
