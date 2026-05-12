import { Inject, InvariantError } from '@fluojs/core';
import { EVENT_BUS as FLUO_EVENT_BUS, type EventBus } from '@fluojs/event-bus';
import type { OnApplicationShutdown, OnApplicationBootstrap } from '@fluojs/runtime';
import { APPLICATION_LOGGER, COMPILED_MODULES, RUNTIME_CONTAINER } from '@fluojs/runtime/internal';

import { CqrsBusBase } from '../discovery.js';
import { createIsolatedEvent } from '../event-clone.js';
import { getEventHandlerMetadata } from '../metadata.js';
import { CQRS_MODULE_OPTIONS } from '../tokens.js';
import { createCqrsPlatformStatusSnapshot } from '../status.js';
import type { CqrsModuleOptions } from '../module.js';
import type { CqrsEventBus, CqrsEventType, EventHandlerDescriptor, IEvent, IEventHandler } from '../types.js';
import { CqrsSagaLifecycleService } from './saga-bus.js';

const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 5000;

function isEventHandler(value: unknown): value is IEventHandler<IEvent> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as { handle?: unknown }).handle === 'function';
}

/**
 * CQRS-facing event bus that dispatches local event handlers, sagas, and the shared event transport.
 *
 * This service keeps CQRS event handlers singleton-only, fans events into saga orchestration,
 * and delegates the final publication step to `@fluojs/event-bus`.
 */
@Inject(FLUO_EVENT_BUS, CqrsSagaLifecycleService, RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, CQRS_MODULE_OPTIONS)
export class CqrsEventBusService extends CqrsBusBase implements CqrsEventBus, OnApplicationBootstrap, OnApplicationShutdown {
  private descriptors: EventHandlerDescriptor[] = [];
  private discoveryPromise: Promise<void> | undefined;
  private discovered = false;
  private readonly activePublishPipelines = new Set<Promise<void>>();
  private shutdownDrainTimeouts = 0;
  private lifecycleState: 'created' | 'discovering' | 'ready' | 'stopping' | 'stopped' | 'failed' = 'created';

  constructor(
    private readonly eventBus: EventBus,
    private readonly sagaService: CqrsSagaLifecycleService,
    runtimeContainer: ConstructorParameters<typeof CqrsBusBase>[0],
    compiledModules: ConstructorParameters<typeof CqrsBusBase>[1],
    logger: ConstructorParameters<typeof CqrsBusBase>[2],
    private readonly moduleOptions: CqrsModuleOptions = {},
  ) {
    super(runtimeContainer, compiledModules, logger);
  }

  async onApplicationBootstrap(): Promise<void> {
    this.lifecycleState = 'discovering';

    try {
      await this.ensureDiscovered();
      this.lifecycleState = 'ready';
    } catch (error) {
      this.lifecycleState = 'failed';
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.lifecycleState = 'stopping';

    if (this.activePublishPipelines.size > 0) {
      await this.drainActivePublishPipelines();
    }

    this.lifecycleState = 'stopped';
  }

  /**
   * Creates a CQRS runtime status snapshot that includes local handler and saga state.
   *
   * @returns A structured snapshot describing CQRS event-handler discovery and saga lifecycle state.
   */
  createPlatformStatusSnapshot() {
    const sagaSnapshot = this.sagaService.getRuntimeSnapshot();

    return createCqrsPlatformStatusSnapshot({
      eventHandlersDiscovered: this.descriptors.length,
      inFlightSagaExecutions: sagaSnapshot.inFlightSagaExecutions,
      lifecycleState: this.lifecycleState,
      sagaLifecycleState: sagaSnapshot.lifecycleState,
      sagaShutdownDrainTimeouts: sagaSnapshot.shutdownDrainTimeouts,
      sagasDiscovered: sagaSnapshot.sagasDiscovered,
      shutdownDrainTimeoutMs: this.resolveShutdownDrainTimeoutMs(),
      shutdownDrainTimeouts: this.shutdownDrainTimeouts,
    });
  }

  /**
   * Publishes one event to matching CQRS handlers, sagas, and the shared event bus.
   *
   * @param event Event instance to publish.
   * @returns A promise that resolves once all local CQRS side effects and delegated publication complete.
   *
   * @throws {InvariantError} When a discovered provider does not implement `handle(event)`.
   */
  async publish<TEvent extends IEvent>(event: TEvent): Promise<void> {
    if (this.lifecycleState === 'stopping' || this.lifecycleState === 'stopped') {
      this.logger.warn(
        `Event publication ignored because the CQRS event bus is ${this.lifecycleState}.`,
        'CqrsEventBusService',
      );
      return;
    }

    await this.trackPublishPipeline(this.runPublishPipeline(event));
  }

  /**
   * Publishes a batch of events sequentially through the CQRS event pipeline.
   *
   * @param events Event instances to publish in order.
   * @returns A promise that resolves once all events are published.
   */
  async publishAll<TEvent extends IEvent>(events: readonly TEvent[]): Promise<void> {
    if (this.lifecycleState === 'stopping' || this.lifecycleState === 'stopped') {
      this.logger.warn(
        `Event publication ignored because the CQRS event bus is ${this.lifecycleState}.`,
        'CqrsEventBusService',
      );
      return;
    }

    await this.trackPublishPipeline(this.runPublishAllPipeline(events));
  }

  private async runPublishPipeline<TEvent extends IEvent>(event: TEvent): Promise<void> {
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

  private async runPublishAllPipeline<TEvent extends IEvent>(events: readonly TEvent[]): Promise<void> {
    for (const event of events) {
      await this.runPublishPipeline(event);
    }
  }

  private async trackPublishPipeline(pipeline: Promise<void>): Promise<void> {
    this.activePublishPipelines.add(pipeline);

    try {
      await pipeline;
    } finally {
      this.activePublishPipelines.delete(pipeline);
    }
  }

  private async drainActivePublishPipelines(): Promise<void> {
    const activePipelines = Array.from(this.activePublishPipelines);
    const timeoutMs = this.resolveShutdownDrainTimeoutMs();
    const drained = await this.awaitShutdownDrain(activePipelines, timeoutMs);

    if (!drained) {
      this.shutdownDrainTimeouts += 1;
      this.logger.warn(
        `CQRS event shutdown drain exceeded ${String(timeoutMs)}ms with ${String(activePipelines.length)} active publish pipeline(s); continuing shutdown.`,
        'CqrsEventBusService',
      );
    }
  }

  private async awaitShutdownDrain(activePipelines: Promise<void>[], timeoutMs: number): Promise<boolean> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timeoutId = setTimeout(() => resolve(false), timeoutMs);
    });

    const drain = Promise.allSettled(activePipelines).then(() => true);

    try {
      return await Promise.race([drain, timeout]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private resolveShutdownDrainTimeoutMs(): number {
    const timeoutMs = this.moduleOptions.shutdown?.drainTimeoutMs;

    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS;
    }

    return Math.floor(timeoutMs);
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

      const alreadyRegistered = descriptors.some(
        (descriptor) => descriptor.eventType === metadata.eventType && descriptor.token === candidate.token,
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
