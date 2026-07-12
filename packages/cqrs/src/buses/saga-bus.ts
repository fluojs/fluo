import { FluoError, Inject, InvariantError, type Token } from '@fluojs/core';
import type { OnApplicationBootstrap, OnApplicationShutdown, RuntimeCleanupRegistration } from '@fluojs/runtime';
import { APPLICATION_LOGGER, COMPILED_MODULES, RUNTIME_CLEANUP_REGISTRATION, RUNTIME_CONTAINER } from '@fluojs/runtime/internal';

import { CqrsBusBase } from '../discovery.js';
import { SagaExecutionError } from '../errors.js';
import { createIsolatedEvent } from '../event-clone.js';
import type { CqrsModuleOptions } from '../module.js';
import { CQRS_MODULE_OPTIONS } from '../tokens.js';
import type { CqrsDispatchContext, CqrsEventType, IEvent, ISaga, SagaDescriptor } from '../types.js';
import { discoverSagaDescriptors } from './saga-discovery.js';
import { drainPendingSagaDispatches } from './saga-drain.js';
import { enterSagaTopology } from './saga-topology.js';

const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 5000;

/** Private capability authorizing saga dispatch from an already active publish drain. */
export const CQRS_SAGA_DRAIN_AUTHORIZATION: unique symbol = Symbol('fluo.cqrs.sagaDrainAuthorization');

function isSaga(value: unknown): value is ISaga<IEvent> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as { handle?: unknown }).handle === 'function';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Runtime saga coordinator that discovers `@Saga()` providers and serializes execution per saga token.
 *
 * The service prevents re-entrant dispatch loops within the same explicit dispatch context and waits for
 * in-flight saga chains during shutdown so lifecycle guarantees remain predictable.
 */
@Inject(RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, CQRS_MODULE_OPTIONS, RUNTIME_CLEANUP_REGISTRATION)
export class CqrsSagaLifecycleService extends CqrsBusBase implements OnApplicationBootstrap, OnApplicationShutdown {
  private descriptorsByEvent = new Map<CqrsEventType, SagaDescriptor[]>();
  private discoveryPromise: Promise<void> | undefined;
  private discovered = false;
  private readonly executionChains = new Map<Token, Promise<void>>();
  private lifecycleState: 'created' | 'discovering' | 'ready' | 'stopping' | 'stopped' | 'failed' = 'created';
  private readonly pendingDispatches = new Set<Promise<void>>();
  private shutdownDrainTimeouts = 0;
  private unregisterShutdownStartCleanup: (() => void) | undefined;

  constructor(
    runtimeContainer: ConstructorParameters<typeof CqrsBusBase>[0],
    compiledModules: ConstructorParameters<typeof CqrsBusBase>[1],
    logger: ConstructorParameters<typeof CqrsBusBase>[2],
    private readonly moduleOptions: CqrsModuleOptions = {},
    registerRuntimeCleanup: RuntimeCleanupRegistration = () => () => undefined,
  ) {
    super(runtimeContainer, compiledModules, logger);

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

    await this.drainActiveSagaWork();

    this.executionChains.clear();
    this.handlerInstances.clear();
    this.descriptorsByEvent.clear();
    this.discovered = false;
    this.discoveryPromise = undefined;
    this.lifecycleState = 'stopped';
  }

  /**
   * Returns an internal runtime snapshot used by the CQRS event bus and diagnostics.
   *
   * @returns Current discovery state, in-flight execution count, lifecycle state, and discovered saga count.
   */
  getRuntimeSnapshot(): {
    discovered: boolean;
    inFlightSagaExecutions: number;
    lifecycleState: 'created' | 'discovering' | 'ready' | 'stopping' | 'stopped' | 'failed';
    sagasDiscovered: number;
    shutdownDrainTimeouts: number;
  } {
    return {
      discovered: this.discovered,
      inFlightSagaExecutions: this.pendingDispatches.size,
      lifecycleState: this.lifecycleState,
      sagasDiscovered: new Set(Array.from(this.descriptorsByEvent.values()).flatMap((descriptors) => descriptors.map((d) => d.token))).size,
      shutdownDrainTimeouts: this.shutdownDrainTimeouts,
    };
  }

  /**
   * Dispatches one event to every matching saga descriptor.
   *
   * @param event Event instance that may trigger one or more sagas.
   * @returns A promise that resolves once all matching saga chains for the event complete.
   */
  async dispatch<TEvent extends IEvent>(
    event: TEvent,
    context?: CqrsDispatchContext,
    drainAuthorization?: typeof CQRS_SAGA_DRAIN_AUTHORIZATION,
  ): Promise<void> {
    this.assertAcceptingNewWork(drainAuthorization);
    await this.ensureDiscovered();

    const descriptors = this.matchSagaDescriptors(event);

    if (descriptors.length === 0) {
      return;
    }

    await Promise.all(descriptors.map((descriptor) => this.dispatchWithOrdering(descriptor, event, context)));
  }

  private assertAcceptingNewWork(drainAuthorization: symbol | undefined): void {
    if (
      (this.lifecycleState === 'stopping' || this.lifecycleState === 'stopped')
      && drainAuthorization !== CQRS_SAGA_DRAIN_AUTHORIZATION
    ) {
      throw new InvariantError('CQRS saga bus cannot dispatch after shutdown has started.');
    }
  }

  private markApplicationShutdownStarted(): void {
    if (this.lifecycleState !== 'stopped') {
      this.lifecycleState = 'stopping';
    }
  }

  private matchSagaDescriptors(event: IEvent): SagaDescriptor[] {
    const descriptors: SagaDescriptor[] = [];

    for (const [eventType, eventDescriptors] of this.descriptorsByEvent.entries()) {
      if (event instanceof eventType) {
        descriptors.push(...eventDescriptors);
      }
    }

    return descriptors;
  }

  private async dispatchWithOrdering<TEvent extends IEvent>(descriptor: SagaDescriptor, event: TEvent, activeContext?: CqrsDispatchContext): Promise<void> {
    const topology = enterSagaTopology(activeContext, descriptor);

    if (topology.reentrantToken) {
      await this.invokeSaga(descriptor, event, topology.context);
      return;
    }

    const previous = this.executionChains.get(descriptor.token) ?? Promise.resolve();
    const current = previous.then(async () => {
      await this.invokeSaga(descriptor, event, topology.context);
    });

    this.executionChains.set(descriptor.token, current.catch(() => undefined));
    this.pendingDispatches.add(current);

    try {
      await current;
    } finally {
      this.pendingDispatches.delete(current);
    }
  }

  private async drainActiveSagaWork(): Promise<void> {
    const timeoutMs = this.resolveShutdownDrainTimeoutMs();
    const activeWorkCount = this.pendingDispatches.size;
    const drained = await drainPendingSagaDispatches(this.pendingDispatches, timeoutMs);

    if (!drained) {
      this.reportShutdownDrainTimeout(timeoutMs, activeWorkCount);
    }
  }

  private reportShutdownDrainTimeout(timeoutMs: number, activeWorkCount: number): void {
    this.shutdownDrainTimeouts += 1;
    this.logger.warn(
      `CQRS saga shutdown drain exceeded ${String(timeoutMs)}ms with ${String(activeWorkCount)} active saga task(s); continuing shutdown.`,
      'CqrsSagaLifecycleService',
    );
  }

  private resolveShutdownDrainTimeoutMs(): number {
    const timeoutMs = this.moduleOptions.shutdown?.drainTimeoutMs;

    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS;
    }

    return Math.floor(timeoutMs);
  }

  private async invokeSaga<TEvent extends IEvent>(descriptor: SagaDescriptor, event: TEvent, context: CqrsDispatchContext): Promise<void> {
    const instance = await this.resolveHandlerInstance(descriptor.token);

    if (!isSaga(instance)) {
      throw new InvariantError(`Saga ${descriptor.targetType.name} must implement handle(event).`);
    }

    try {
      await instance.handle(createIsolatedEvent(descriptor.eventType as CqrsEventType<TEvent>, event), context);
    } catch (error) {
      if (error instanceof FluoError) {
        throw error;
      }

      throw new SagaExecutionError(
        `Saga ${descriptor.targetType.name} failed while handling ${descriptor.eventType.name}: ${toErrorMessage(error)}`,
      );
    }
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
      this.descriptorsByEvent = this.discoverSagaDescriptors();
      this.handlerInstances.clear();

      for (const descriptors of this.descriptorsByEvent.values()) {
        for (const descriptor of descriptors) {
          await this.preloadHandlerInstance(descriptor.token);
        }
      }

      this.discovered = true;
    } finally {
      this.discoveryPromise = undefined;
    }
  }

  private discoverSagaDescriptors(): Map<CqrsEventType, SagaDescriptor[]> {
    return discoverSagaDescriptors(this.discoveryCandidates(), this.logger);
  }
}
