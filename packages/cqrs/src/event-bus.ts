import { Inject, InvariantError } from '@konekti/core';
import { EVENT_BUS as KONEKTI_EVENT_BUS, type EventBus } from '@konekti/event-bus';
import {
  APPLICATION_LOGGER,
  COMPILED_MODULES,
  RUNTIME_CONTAINER,
  type OnApplicationBootstrap,
} from '@konekti/runtime';

import { CqrsBusBase } from './discovery.js';
import { createIsolatedEvent } from './event-clone.js';
import { getEventHandlerMetadata } from './metadata.js';
import { CqrsSagaLifecycleService } from './saga-bus.js';
import type { CqrsEventBus, CqrsEventType, EventHandlerDescriptor, IEvent, IEventHandler } from './types.js';

function isEventHandler(value: unknown): value is IEventHandler<IEvent> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as { handle?: unknown }).handle === 'function';
}

@Inject([KONEKTI_EVENT_BUS, CqrsSagaLifecycleService, RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER])
export class CqrsEventBusService extends CqrsBusBase implements CqrsEventBus, OnApplicationBootstrap {
  private descriptors: EventHandlerDescriptor[] = [];
  private discoveryPromise: Promise<void> | undefined;
  private discovered = false;

  constructor(
    private readonly eventBus: EventBus,
    private readonly sagaService: CqrsSagaLifecycleService,
    runtimeContainer: ConstructorParameters<typeof CqrsBusBase>[0],
    compiledModules: ConstructorParameters<typeof CqrsBusBase>[1],
    logger: ConstructorParameters<typeof CqrsBusBase>[2],
  ) {
    super(runtimeContainer, compiledModules, logger);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureDiscovered();
  }

  async publish<TEvent extends IEvent>(event: TEvent): Promise<void> {
    await this.ensureDiscovered();

    for (const descriptor of this.matchEventDescriptors(event)) {
      const instance = await this.resolveHandlerInstance(descriptor.token);

      if (!isEventHandler(instance)) {
        throw new InvariantError(`Event handler ${descriptor.targetType.name} must implement handle(event).`);
      }

      await instance.handle(createIsolatedEvent(descriptor.eventType as CqrsEventType<TEvent>, event));
    }

    await this.sagaService.dispatch(event);
    await this.eventBus.publish(event);
  }

  async publishAll<TEvent extends IEvent>(events: readonly TEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  private matchEventDescriptors(event: IEvent): EventHandlerDescriptor[] {
    return this.descriptors.filter((descriptor) => event instanceof descriptor.eventType);
  }

  private async ensureDiscovered(): Promise<void> {
    if (this.discovered) {
      return;
    }

    if (this.discoveryPromise) {
      await this.discoveryPromise;
      return;
    }

    this.discoveryPromise = this.discoverHandlers();
    await this.discoveryPromise;
  }

  private async discoverHandlers(): Promise<void> {
    try {
      this.descriptors = this.discoverEventDescriptors();
      this.handlerInstances.clear();

      for (const descriptor of this.descriptors) {
        await this.preloadHandlerInstance(descriptor.token);
      }

      this.discovered = true;
    } finally {
      this.discoveryPromise = undefined;
    }
  }

  private discoverEventDescriptors(): EventHandlerDescriptor[] {
    const descriptors: EventHandlerDescriptor[] = [];
    const seenByTarget = new WeakMap<Function, Set<CqrsEventType>>();

    for (const candidate of this.discoveryCandidates()) {
      const metadata = getEventHandlerMetadata(candidate.targetType);

      if (!metadata) {
        continue;
      }

      if (candidate.scope !== 'singleton') {
        this.logger.warn(
          `${candidate.targetType.name} in module ${candidate.moduleName} declares @EventHandler() but is registered with ${candidate.scope} scope. Event handlers are registered only for singleton providers.`,
          'CqrsEventBusService',
        );
        continue;
      }

      const seenEventTypes = seenByTarget.get(candidate.targetType) ?? new Set<CqrsEventType>();

      if (seenEventTypes.has(metadata.eventType)) {
        continue;
      }

      seenEventTypes.add(metadata.eventType);
      seenByTarget.set(candidate.targetType, seenEventTypes);

      const alreadyRegistered = descriptors.some(
        (descriptor) => descriptor.eventType === metadata.eventType && descriptor.targetType === candidate.targetType,
      );

      if (!alreadyRegistered) {
        descriptors.push({
          eventType: metadata.eventType,
          moduleName: candidate.moduleName,
          targetType: candidate.targetType,
          token: candidate.token,
        });
      }
    }

    return descriptors;
  }
}
