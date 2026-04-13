import { AsyncLocalStorage } from 'node:async_hooks';

import { Inject, InvariantError, FluoError, type Token } from '@fluojs/core';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@fluojs/runtime';
import { APPLICATION_LOGGER, COMPILED_MODULES, RUNTIME_CONTAINER } from '@fluojs/runtime/internal';

import { CqrsBusBase } from '../discovery.js';
import { SagaExecutionError, SagaTopologyError } from '../errors.js';
import { createIsolatedEvent } from '../event-clone.js';
import { getSagaMetadata } from '../metadata.js';
import type { CqrsEventType, IEvent, ISaga, SagaDescriptor } from '../types.js';

const MAX_NESTED_SAGA_DEPTH = 32;

interface SagaDispatchContext {
  activeRoutes: Array<{ eventType: CqrsEventType; token: Token }>;
  depth: number;
  path: string[];
}

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
 * The service prevents re-entrant dispatch loops within the same async context and waits for
 * in-flight saga chains during shutdown so lifecycle guarantees remain predictable.
 */
@Inject(RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER)
export class CqrsSagaLifecycleService extends CqrsBusBase implements OnApplicationBootstrap, OnApplicationShutdown {
  private descriptorsByEvent = new Map<CqrsEventType, SagaDescriptor[]>();
  private discoveryPromise: Promise<void> | undefined;
  private discovered = false;
  private readonly executionChains = new Map<Token, Promise<void>>();
  private lifecycleState: 'created' | 'discovering' | 'ready' | 'stopping' | 'stopped' | 'failed' = 'created';
  private readonly pendingDispatches = new Set<Promise<void>>();
  private readonly dispatchContext = new AsyncLocalStorage<SagaDispatchContext>();

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

    while (this.pendingDispatches.size > 0) {
      await Promise.allSettled(Array.from(this.pendingDispatches));
    }

    await Promise.allSettled(this.executionChains.values());

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
  } {
    return {
      discovered: this.discovered,
      inFlightSagaExecutions: this.pendingDispatches.size,
      lifecycleState: this.lifecycleState,
      sagasDiscovered: new Set(Array.from(this.descriptorsByEvent.values()).flatMap((descriptors) => descriptors.map((d) => d.token))).size,
    };
  }

  /**
   * Dispatches one event to every matching saga descriptor.
   *
   * @param event Event instance that may trigger one or more sagas.
   * @returns A promise that resolves once all matching saga chains for the event complete.
   */
  async dispatch<TEvent extends IEvent>(event: TEvent): Promise<void> {
    await this.ensureDiscovered();

    const descriptors = this.matchSagaDescriptors(event);

    if (descriptors.length === 0) {
      return;
    }

    await Promise.all(descriptors.map((descriptor) => this.dispatchWithOrdering(descriptor, event)));
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

  private async dispatchWithOrdering<TEvent extends IEvent>(descriptor: SagaDescriptor, event: TEvent): Promise<void> {
    const activeContext = this.dispatchContext.getStore();

    const routeLabel = `${descriptor.targetType.name}(${descriptor.eventType.name})`;
    const isActiveRoute = activeContext?.activeRoutes.some(
      (route) => route.token === descriptor.token && route.eventType === descriptor.eventType,
    );
    const isActiveToken = activeContext?.activeRoutes.some((route) => route.token === descriptor.token) ?? false;

    if (isActiveRoute) {
      throw new SagaTopologyError(
        `Saga ${descriptor.targetType.name} re-entered an unsafe cycle while handling ${descriptor.eventType.name}. `
          + `Active saga path: ${[...(activeContext?.path ?? []), routeLabel].join(' -> ')}.`,
      );
    }

    if ((activeContext?.depth ?? 0) >= MAX_NESTED_SAGA_DEPTH) {
      throw new SagaTopologyError(
        `Saga ${descriptor.targetType.name} exceeded the maximum nested saga depth of ${MAX_NESTED_SAGA_DEPTH} while handling ${descriptor.eventType.name}. `
          + 'Keep in-process saga graphs acyclic and externally bounded.',
      );
    }

    if (isActiveToken) {
      await this.runInDispatchContext(activeContext, descriptor, routeLabel, async () => {
        await this.invokeSaga(descriptor, event);
      });
      return;
    }

    const previous = this.executionChains.get(descriptor.token) ?? Promise.resolve();
    const current = previous.then(async () => {
      await this.runInDispatchContext(activeContext, descriptor, routeLabel, async () => {
        await this.invokeSaga(descriptor, event);
      });
    });

    this.executionChains.set(descriptor.token, current.catch(() => undefined));
    this.pendingDispatches.add(current);

    try {
      await current;
    } finally {
      this.pendingDispatches.delete(current);
    }
  }

  private async runInDispatchContext(
    activeContext: SagaDispatchContext | undefined,
    descriptor: SagaDescriptor,
    routeLabel: string,
    callback: () => Promise<void>,
  ): Promise<void> {
    const nextContext: SagaDispatchContext = {
      activeRoutes: [...(activeContext?.activeRoutes ?? []), { eventType: descriptor.eventType, token: descriptor.token }],
      depth: (activeContext?.depth ?? 0) + 1,
      path: [...(activeContext?.path ?? []), routeLabel],
    };

    await this.dispatchContext.run(nextContext, callback);
  }

  private async invokeSaga<TEvent extends IEvent>(descriptor: SagaDescriptor, event: TEvent): Promise<void> {
    const instance = await this.resolveHandlerInstance(descriptor.token);

    if (!isSaga(instance)) {
      throw new InvariantError(`Saga ${descriptor.targetType.name} must implement handle(event).`);
    }

    try {
      await instance.handle(createIsolatedEvent(descriptor.eventType as CqrsEventType<TEvent>, event));
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
    const descriptorsByEvent = new Map<CqrsEventType, SagaDescriptor[]>();
    const seenByTarget = new WeakMap<Function, Set<CqrsEventType>>();

    for (const candidate of this.discoveryCandidates()) {
      const metadata = getSagaMetadata(candidate.targetType);

      if (!metadata) {
        continue;
      }

      if (candidate.scope !== 'singleton') {
        this.logger.warn(
          `${candidate.targetType.name} in module ${candidate.moduleName} declares @Saga() but is registered with ${candidate.scope} scope. Sagas are registered only for singleton providers.`,
          'CqrsSagaLifecycleService',
        );
        continue;
      }

      const seenEventTypes = seenByTarget.get(candidate.targetType) ?? new Set<CqrsEventType>();

      for (const eventType of metadata.eventTypes) {
        if (seenEventTypes.has(eventType)) {
          continue;
        }

        seenEventTypes.add(eventType);

        const descriptors = descriptorsByEvent.get(eventType) ?? [];

        if (!descriptors.some((descriptor) => descriptor.targetType === candidate.targetType)) {
          descriptors.push({
            eventType,
            moduleName: candidate.moduleName,
            targetType: candidate.targetType,
            token: candidate.token,
          });

          descriptorsByEvent.set(eventType, descriptors);
        }
      }

      seenByTarget.set(candidate.targetType, seenEventTypes);
    }

    return descriptorsByEvent;
  }
}
