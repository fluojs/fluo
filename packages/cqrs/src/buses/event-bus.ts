import { Inject, InvariantError } from '@fluojs/core';
import { type EventBus, EVENT_BUS as FLUO_EVENT_BUS } from '@fluojs/event-bus';
import type { OnApplicationBootstrap, OnApplicationShutdown, RuntimeCleanupRegistration } from '@fluojs/runtime';
import { APPLICATION_LOGGER, COMPILED_MODULES, RUNTIME_CLEANUP_REGISTRATION, RUNTIME_CONTAINER } from '@fluojs/runtime/internal';

import { CqrsBusBase } from '../discovery.js';
import {
  createInternalCqrsDispatchContext,
  getInternalCqrsDispatchContextState,
} from '../dispatch-context.js';
import { createIsolatedEvent } from '../event-clone.js';
import type { CqrsModuleOptions } from '../module.js';
import { createCqrsPlatformStatusSnapshot } from '../status.js';
import { CQRS_MODULE_OPTIONS } from '../tokens.js';
import type { CqrsDispatchContext, CqrsEventBus, CqrsEventType, EventHandlerDescriptor, IEvent, IEventHandler } from '../types.js';
import { discoverEventHandlerDescriptors } from './event-handler-discovery.js';
import { CqrsPublishDrainTracker } from './publish-drain-tracker.js';
import { CQRS_SAGA_DRAIN_AUTHORIZATION, CqrsSagaLifecycleService } from './saga-bus.js';

const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 5000;

interface CqrsPublishContext {
  readonly context: CqrsDispatchContext;
  readonly drainToken: symbol;
}

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
@Inject(
  FLUO_EVENT_BUS,
  CqrsSagaLifecycleService,
  RUNTIME_CONTAINER,
  COMPILED_MODULES,
  APPLICATION_LOGGER,
  CQRS_MODULE_OPTIONS,
  RUNTIME_CLEANUP_REGISTRATION,
)
export class CqrsEventBusService extends CqrsBusBase implements CqrsEventBus, OnApplicationBootstrap, OnApplicationShutdown {
  private descriptors: EventHandlerDescriptor[] = [];
  private discoveryPromise: Promise<void> | undefined;
  private discovered = false;
  private readonly publishDrainTracker: CqrsPublishDrainTracker;
  private lifecycleState: 'created' | 'discovering' | 'ready' | 'stopping' | 'stopped' | 'failed' = 'created';
  private unregisterShutdownStartCleanup: (() => void) | undefined;

  constructor(
    private readonly eventBus: EventBus,
    private readonly sagaService: CqrsSagaLifecycleService,
    runtimeContainer: ConstructorParameters<typeof CqrsBusBase>[0],
    compiledModules: ConstructorParameters<typeof CqrsBusBase>[1],
    logger: ConstructorParameters<typeof CqrsBusBase>[2],
    private readonly moduleOptions: CqrsModuleOptions = {},
    registerRuntimeCleanup: RuntimeCleanupRegistration = () => () => undefined,
  ) {
    super(runtimeContainer, compiledModules, logger);
    this.publishDrainTracker = new CqrsPublishDrainTracker(logger);

    this.unregisterShutdownStartCleanup = registerRuntimeCleanup(() => {
      this.markApplicationShutdownStarted();
    });
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
    this.markApplicationShutdownStarted();
    this.unregisterShutdownStartCleanup?.();
    this.unregisterShutdownStartCleanup = undefined;

    if (this.publishDrainTracker.hasActivePipelines) {
      await this.publishDrainTracker.drain(this.resolveShutdownDrainTimeoutMs());
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
      shutdownDrainTimeouts: this.publishDrainTracker.shutdownDrainTimeouts,
    });
  }

  /**
   * Publishes one event to matching CQRS handlers, sagas, and the shared event bus.
   *
   * @param event Event instance to publish.
   * @param context Optional saga dispatch context to pass through nested CQRS calls.
   * @returns A promise that resolves once all local CQRS side effects and delegated publication complete.
   *
   * @throws {InvariantError} When a discovered provider does not implement `handle(event)`.
   */
  async publish<TEvent extends IEvent>(event: TEvent, context?: CqrsDispatchContext): Promise<void> {
    this.assertAcceptingNewWork('publish', context);
    const publishContext = this.createPublishContext(context);
    await this.publishDrainTracker.track(
      this.runPublishPipeline(event, publishContext.context),
      publishContext.drainToken,
    );
  }

  /**
   * Publishes a batch of events sequentially through the CQRS event pipeline.
   *
   * @param events Event instances to publish in order.
   * @param context Optional saga dispatch context to pass through nested CQRS calls.
   * @returns A promise that resolves once all events are published.
   */
  async publishAll<TEvent extends IEvent>(events: readonly TEvent[], context?: CqrsDispatchContext): Promise<void> {
    this.assertAcceptingNewWork('publishAll', context);
    const publishContext = this.createPublishContext(context);
    await this.publishDrainTracker.track(
      this.runPublishAllPipeline(events, publishContext.context),
      publishContext.drainToken,
    );
  }

  private async runPublishPipeline<TEvent extends IEvent>(event: TEvent, context: CqrsDispatchContext): Promise<void> {
    await this.ensureDiscovered();

    for (const descriptor of this.matchEventDescriptors(event)) {
      const instance = await this.resolveHandlerInstance(descriptor.token);

      if (!isEventHandler(instance)) {
        throw new InvariantError(`Event handler ${descriptor.targetType.name} must implement handle(event).`);
      }

      await instance.handle(createIsolatedEvent(descriptor.eventType as CqrsEventType<TEvent>, event), context);
    }

    await this.sagaService.dispatch(event, context, CQRS_SAGA_DRAIN_AUTHORIZATION);
    await this.eventBus.publish(event);
  }

  private async runPublishAllPipeline<TEvent extends IEvent>(events: readonly TEvent[], context: CqrsDispatchContext): Promise<void> {
    for (const event of events) {
      await this.runPublishPipeline(event, context);
    }
  }

  private assertAcceptingNewWork(operation: 'publish' | 'publishAll', context?: CqrsDispatchContext): void {
    if (this.lifecycleState === 'stopped') {
      throw new InvariantError(`CQRS event bus cannot ${operation} after shutdown has started.`);
    }

    if (this.lifecycleState === 'stopping') {
      const drainToken = getInternalCqrsDispatchContextState(context)?.publishDrainToken;

      if (!drainToken || !this.publishDrainTracker.isActive(drainToken)) {
        throw new InvariantError(`CQRS event bus cannot ${operation} after shutdown has started.`);
      }
    }
  }

  private markApplicationShutdownStarted(): void {
    if (this.lifecycleState !== 'stopped') {
      this.lifecycleState = 'stopping';
    }
  }

  private createPublishContext(context: CqrsDispatchContext | undefined): CqrsPublishContext {
    const internalState = getInternalCqrsDispatchContextState(context);
    const drainToken = internalState?.publishDrainToken ?? Symbol('fluo.cqrs.activePublishDrain');

    if (context && internalState?.publishDrainToken) {
      return { context, drainToken };
    }

    return {
      context: createInternalCqrsDispatchContext({
        publishDrainToken: drainToken,
        sagaTopology: internalState?.sagaTopology,
      }),
      drainToken,
    };
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
    return discoverEventHandlerDescriptors(this.discoveryCandidates(), this.logger);
  }
}
