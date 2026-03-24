import { Inject, InvariantError } from '@konekti/core';
import { EVENT_BUS as KONEKTI_EVENT_BUS, type EventBus } from '@konekti/event-bus';
import {
  APPLICATION_LOGGER,
  COMPILED_MODULES,
  RUNTIME_CONTAINER,
  type OnApplicationBootstrap,
} from '@konekti/runtime';

import { CqrsBusBase, createDuplicateHandlerMessage } from './discovery.js';
import { DuplicateEventHandlerError } from './errors.js';
import { getEventHandlerMetadata } from './metadata.js';
import type { CqrsEventBus, CqrsEventType, EventHandlerDescriptor, IEvent, IEventHandler } from './types.js';

function fallbackClone(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => fallbackClone(item));
  }

  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    const cloned: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(source)) {
      cloned[key] = fallbackClone(item);
    }

    return cloned;
  }

  return value;
}

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return fallbackClone(value) as T;
  }
}

function createIsolatedEvent<TEvent extends IEvent>(eventType: CqrsEventType<TEvent>, source: unknown): TEvent {
  const clonedPayload = cloneValue(source);

  if (typeof clonedPayload !== 'object' || clonedPayload === null) {
    return clonedPayload as TEvent;
  }

  return Object.assign(Object.create(eventType.prototype) as object, clonedPayload) as TEvent;
}

function isEventHandler(value: unknown): value is IEventHandler<IEvent> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as { handle?: unknown }).handle === 'function';
}

@Inject([KONEKTI_EVENT_BUS, RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER])
export class CqrsEventBusService extends CqrsBusBase implements CqrsEventBus, OnApplicationBootstrap {
  private descriptors = new Map<CqrsEventType, EventHandlerDescriptor>();
  private discoveryPromise: Promise<void> | undefined;
  private discovered = false;

  constructor(
    private readonly eventBus: EventBus,
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
    await this.eventBus.publish(event);

    for (const descriptor of this.matchEventDescriptors(event)) {
      const instance = await this.resolveHandlerInstance(descriptor.token);

      if (!isEventHandler(instance)) {
        throw new InvariantError(`Event handler ${descriptor.targetType.name} must implement handle(event).`);
      }

      await instance.handle(createIsolatedEvent(descriptor.eventType as CqrsEventType<TEvent>, event));
    }
  }

  async publishAll<TEvent extends IEvent>(events: readonly TEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  private matchEventDescriptors(event: IEvent): EventHandlerDescriptor[] {
    return Array.from(this.descriptors.values()).filter((descriptor) => event instanceof descriptor.eventType);
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

      for (const descriptor of this.descriptors.values()) {
        await this.preloadHandlerInstance(descriptor.token);
      }

      this.discovered = true;
    } finally {
      this.discoveryPromise = undefined;
    }
  }

  private discoverEventDescriptors(): Map<CqrsEventType, EventHandlerDescriptor> {
    const descriptors = new Map<CqrsEventType, EventHandlerDescriptor>();
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

      const existing = descriptors.get(metadata.eventType);

      if (existing && existing.targetType !== candidate.targetType) {
        throw new DuplicateEventHandlerError(
          createDuplicateHandlerMessage('event', metadata.eventType, existing, {
            moduleName: candidate.moduleName,
            targetType: candidate.targetType,
          }),
        );
      }

      if (!existing) {
        descriptors.set(metadata.eventType, {
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
